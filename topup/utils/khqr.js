// utils/khqr.js
// Builds a KHQR (Cambodia Bakong EMVCo-based QR) payload string, computes its MD5
// (used by Bakong's "check transaction by MD5" API for auto-verification), and
// renders it to a PNG QR image.
//
// NOTE: To make payment truly "auto-confirm", you need:
//   1) A real Bakong merchant/individual account id (settings.bakong_account_id)
//   2) A Bakong Open API developer token (settings.bakong_api_token) from
//      https://api-bakong.nbc.gov.kh — used in poller.js to poll
//      "check_transaction_by_md5" until the customer actually pays.
// Without those two real credentials this still generates a scannable KHQR,
// but auto-confirmation will not fire (admin can still confirm manually
// from the admin panel or Telegram bot).

const crypto = require('crypto');
const QRCode = require('qrcode');

function tlv(id, value) {
  const len = String(value.length).padStart(2, '0');
  return `${id}${len}${value}`;
}

function crc16(payload) {
  // CRC-16/CCITT-FALSE as required by EMVCo QR spec
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) {
      if ((crc & 0x8000) !== 0) crc = ((crc << 1) ^ 0x1021) & 0xffff;
      else crc = (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/**
 * Build a KHQR string for a dynamic (one-time) transaction.
 * @param {Object} opts
 * @param {string} opts.accountId - Bakong account id, e.g. "someone@devb"
 * @param {string} opts.merchantName
 * @param {string} opts.merchantCity
 * @param {number} opts.amount - amount in `currency`
 * @param {string} opts.currency - 'USD' or 'KHR'
 * @param {string} opts.billNumber - your internal order code, used as reference
 */
function buildKHQR({ accountId, merchantName, merchantCity, amount, currency = 'USD', billNumber }) {
  const currencyCode = currency === 'USD' ? '840' : '116'; // ISO 4217 numeric
  const amountStr = Number(amount).toFixed(2);

  const merchantAccountInfo =
    tlv('00', 'KHQR-P2M') + // bakong domain tag (simplified individual/merchant tag)
    tlv('01', accountId);

  let payload =
    tlv('00', '01') +                       // Payload Format Indicator
    tlv('01', '12') +                       // Point of Initiation (12 = dynamic/one-time)
    tlv('29', merchantAccountInfo) +        // Merchant account info (Bakong)
    tlv('52', '5999') +                     // Merchant category code (generic)
    tlv('53', currencyCode) +               // Transaction currency
    tlv('54', amountStr) +                  // Transaction amount
    tlv('58', 'KH') +                       // Country code
    tlv('59', (merchantName || 'MERCHANT').substring(0, 25)) +
    tlv('60', (merchantCity || 'Phnom Penh').substring(0, 15)) +
    tlv('62', tlv('01', (billNumber || '').substring(0, 25))); // additional data - bill number

  payload += '6304'; // CRC tag + fixed length, value appended after computing
  const crc = crc16(payload);
  const khqrString = payload + crc;

  const md5 = crypto.createHash('md5').update(khqrString).digest('hex');
  return { khqrString, md5 };
}

async function khqrToPngDataUrl(khqrString) {
  return QRCode.toDataURL(khqrString, { margin: 1, width: 400 });
}

module.exports = { buildKHQR, khqrToPngDataUrl, crc16 };
