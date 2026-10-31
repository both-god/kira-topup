// utils/poller.js
// Polls Bakong's Open API to auto-detect when a KHQR has actually been paid.
// Docs: https://api-bakong.nbc.gov.kh (requires a free developer token).
// If no token is configured in settings, polling is skipped and orders must
// be confirmed manually from the admin panel or via the Telegram bot buttons.

const db = require('../db/connection');

const BAKONG_CHECK_URL = 'https://api-bakong.nbc.gov.kh/v1/check_transaction_by_md5';
const ACTIVE_TIMERS = new Map(); // order_code -> interval handle

function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key=?').get(key);
  return row ? row.value : '';
}

async function checkOnce(md5) {
  const token = getSetting('bakong_api_token');
  if (!token) return { ok: false, reason: 'no_token' };
  try {
    const res = await fetch(BAKONG_CHECK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ md5 }),
    });
    const data = await res.json();
    // Bakong returns responseCode 0 + data when the transaction is found/paid
    const paid = res.ok && data && (data.responseCode === 0 || data.status === 'success');
    return { ok: true, paid, raw: data };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

/**
 * Start polling an order's KHQR MD5 every `intervalMs` until paid, expired
 * (after `timeoutMs`), or externally cleared.
 * @param {string} orderCode
 * @param {function} onPaid - called once when payment is confirmed
 */
function startPolling(orderCode, onPaid, { intervalMs = 4000, timeoutMs = 10 * 60 * 1000 } = {}) {
  if (ACTIVE_TIMERS.has(orderCode)) return; // already polling
  const startedAt = Date.now();

  const handle = setInterval(async () => {
    const order = db.prepare('SELECT * FROM orders WHERE order_code=?').get(orderCode);
    if (!order || ['paid', 'completed', 'failed', 'cancelled', 'expired'].includes(order.status)) {
      stopPolling(orderCode);
      return;
    }
    if (Date.now() - startedAt > timeoutMs) {
      db.prepare("UPDATE orders SET status='expired' WHERE order_code=? AND status='pending'").run(orderCode);
      stopPolling(orderCode);
      return;
    }
    const result = await checkOnce(order.khqr_md5);
    if (result.ok && result.paid) {
      db.prepare("UPDATE orders SET status='paid', paid_at=datetime('now') WHERE order_code=?").run(orderCode);
      stopPolling(orderCode);
      if (onPaid) onPaid(order);
    }
  }, intervalMs);

  ACTIVE_TIMERS.set(orderCode, handle);
}

function stopPolling(orderCode) {
  const h = ACTIVE_TIMERS.get(orderCode);
  if (h) clearInterval(h);
  ACTIVE_TIMERS.delete(orderCode);
}

module.exports = { startPolling, stopPolling, checkOnce };
