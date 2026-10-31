// utils/orders.js
const db = require('../db/connection');
const { buildKHQR } = require('./khqr');

function genOrderCode() {
  const d = new Date();
  const ymd = d.toISOString().slice(0, 10).replace(/-/g, '');
  const seq = db.prepare("SELECT COUNT(*) c FROM orders WHERE order_code LIKE ?").get(`LDN-${ymd}-%`).c + 1;
  return `LDN-${ymd}-${String(seq).padStart(4, '0')}`;
}

function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key=?').get(key);
  return row ? row.value : '';
}

/**
 * Creates a pending order + generates its KHQR. Does NOT check/decrement
 * stock here beyond a soft check — stock is fully decremented on delivery
 * confirmation to avoid holding stock for abandoned/unpaid orders.
 */
function createOrderRecord({ gameCode, pkg, playerId, zoneId, source = 'web', customerChatId = null }) {
  if (pkg.stock <= 0) {
    const err = new Error('Package out of stock');
    err.code = 'OUT_OF_STOCK';
    throw err;
  }

  const orderCode = genOrderCode();
  const accountId = getSetting('bakong_account_id');
  const merchantName = getSetting('merchant_name');
  const merchantCity = getSetting('merchant_city');

  const { khqrString, md5 } = buildKHQR({
    accountId,
    merchantName,
    merchantCity,
    amount: pkg.price,
    currency: 'USD',
    billNumber: orderCode,
  });

  db.prepare(
    `INSERT INTO orders
      (order_code, game_code, package_id, package_name, player_id, zone_id, amount, khqr_string, khqr_md5, status, source, customer_chat_id)
     VALUES (?,?,?,?,?,?,?,?,?, 'pending', ?, ?)`
  ).run(orderCode, gameCode, pkg.id, pkg.name, playerId, zoneId, pkg.price, khqrString, md5, source, customerChatId);

  return db.prepare('SELECT * FROM orders WHERE order_code=?').get(orderCode);
}

module.exports = { genOrderCode, createOrderRecord };
