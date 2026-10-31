// telegram/bot.js
// Two-way Telegram integration:
//  1) FORWARD: every new website order is pushed to the admin group/channel
//     with inline Approve / Reject / Mark-Delivered buttons.
//  2) BOT TOPUP: customers can also order directly by chatting with the bot
//     (/topup command), which creates an order the same way the website does
//     and returns them a KHQR to scan, right inside Telegram.

const TelegramBot = require('node-telegram-bot-api');
const db = require('../db/connection');
const { buildKHQR } = require('../utils/khqr');
const { genOrderCode, createOrderRecord } = require('../utils/orders');
const { startPolling } = require('../utils/poller');

let bot = null;

function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key=?').get(key);
  return row ? row.value : '';
}

function initBot() {
  const token = getSetting('telegram_bot_token');
  if (!token) {
    console.log('[telegram] No bot token configured yet — skipping bot startup. Set it in Admin > Settings.');
    return null;
  }
  if (bot) return bot; // already running

  bot = new TelegramBot(token, { polling: true });
  console.log('[telegram] Bot started (polling mode)');

  // ---------- Customer flow: /topup ----------
  const session = new Map(); // chatId -> wizard state

  bot.onText(/\/start|\/topup/, (msg) => {
    const chatId = msg.chat.id;
    session.set(chatId, { step: 'game' });
    bot.sendMessage(chatId, 'ជ្រើសរើសហ្គេមដែលអ្នកចង់ចាក់ទឹកប្រាក់ (Choose a game):', {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔷 Mobile Legends', callback_data: 'game:mlbb' }],
          [{ text: '🔥 Free Fire', callback_data: 'game:freefire' }],
        ],
      },
    });
  });

  bot.on('callback_query', async (q) => {
    const chatId = q.message.chat.id;
    const data = q.data;

    // ----- admin approve/reject/deliver buttons -----
    if (data.startsWith('admin:')) {
      const [, action, orderCode] = data.split(':');
      const order = db.prepare('SELECT * FROM orders WHERE order_code=?').get(orderCode);
      if (!order) return bot.answerCallbackQuery(q.id, { text: 'Order not found' });

      if (action === 'approve') {
        db.prepare("UPDATE orders SET status='delivering' WHERE order_code=?").run(orderCode);
        await bot.editMessageText(q.message.text + `\n\n✅ APPROVED by admin — delivering now.`, {
          chat_id: chatId,
          message_id: q.message.message_id,
        });
      } else if (action === 'reject') {
        db.prepare("UPDATE orders SET status='failed' WHERE order_code=?").run(orderCode);
        await bot.editMessageText(q.message.text + `\n\n❌ REJECTED by admin.`, {
          chat_id: chatId,
          message_id: q.message.message_id,
        });
      } else if (action === 'delivered') {
        db.prepare("UPDATE orders SET status='completed', completed_at=datetime('now') WHERE order_code=?").run(orderCode);
        await bot.editMessageText(q.message.text + `\n\n📦 COMPLETED — diamonds delivered.`, {
          chat_id: chatId,
          message_id: q.message.message_id,
        });
        if (order.customer_chat_id) {
          bot.sendMessage(order.customer_chat_id, `🎉 Order ${orderCode} completed! Your diamonds have been delivered. Thank you!`);
        }
      }
      return bot.answerCallbackQuery(q.id, { text: 'Updated' });
    }

    // ----- customer wizard -----
    const state = session.get(chatId) || { step: 'game' };

    if (data.startsWith('game:')) {
      const gameCode = data.split(':')[1];
      const game = db.prepare('SELECT * FROM games WHERE code=?').get(gameCode);
      const pkgs = db.prepare('SELECT * FROM packages WHERE game_id=? AND active=1 ORDER BY sort_order').all(game.id);
      state.game = game;
      state.step = 'package';
      session.set(chatId, state);
      bot.sendMessage(chatId, `Packages for ${game.name}:`, {
        reply_markup: {
          inline_keyboard: pkgs.map((p) => [{ text: `${p.name} — $${p.price}`, callback_data: `pkg:${p.id}` }]),
        },
      });
    } else if (data.startsWith('pkg:')) {
      const pkgId = Number(data.split(':')[1]);
      const pkg = db.prepare('SELECT * FROM packages WHERE id=?').get(pkgId);
      state.pkg = pkg;
      state.step = 'player_id';
      session.set(chatId, state);
      bot.sendMessage(chatId, 'សូមផ្ញើ Player ID របស់អ្នក (send your Player ID):');
    }
    bot.answerCallbackQuery(q.id);
  });

  bot.on('message', async (msg) => {
    if (!msg.text || msg.text.startsWith('/')) return;
    const chatId = msg.chat.id;
    const state = session.get(chatId);
    if (!state) return;

    if (state.step === 'player_id') {
      state.playerId = msg.text.trim();
      if (state.game.needs_zone) {
        state.step = 'zone_id';
        session.set(chatId, state);
        return bot.sendMessage(chatId, 'សូមផ្ញើ Zone/Server ID (send your Zone/Server ID):');
      }
      state.step = 'confirm';
      session.set(chatId, state);
      return finalizeBotOrder(chatId, state);
    }
    if (state.step === 'zone_id') {
      state.zoneId = msg.text.trim();
      state.step = 'confirm';
      session.set(chatId, state);
      return finalizeBotOrder(chatId, state);
    }
  });

  async function finalizeBotOrder(chatId, state) {
    const order = createOrderRecord({
      gameCode: state.game.code,
      pkg: state.pkg,
      playerId: state.playerId,
      zoneId: state.zoneId || null,
      source: 'telegram',
      customerChatId: String(chatId),
    });
    await sendQrToChat(chatId, order);
    forwardOrderToAdmin(order);
    startPolling(order.order_code, (paidOrder) => {
      bot.sendMessage(chatId, `✅ Payment received for order ${paidOrder.order_code}! We're processing your top-up now.`);
      forwardPaidUpdateToAdmin(paidOrder);
    });
    session.delete(chatId);
  }

  async function sendQrToChat(chatId, order) {
    const { khqrToPngDataUrl } = require('../utils/khqr');
    const dataUrl = await khqrToPngDataUrl(order.khqr_string);
    const buffer = Buffer.from(dataUrl.split(',')[1], 'base64');
    await bot.sendPhoto(chatId, buffer, {
      caption: `🧾 Order: ${order.order_code}\n🎮 ${order.package_name}\n💵 $${order.amount.toFixed(2)}\n\nScan this KHQR with your banking app to pay. This message will auto-update once payment is detected.`,
    });
  }

  return bot;
}

// ---------- called by API routes when a website order is created ----------
function forwardOrderToAdmin(order) {
  if (!bot) return;
  const adminChatId = getSetting('telegram_admin_chat_id');
  if (!adminChatId) return;

  const text =
    `🆕 NEW ORDER (${order.source})\n` +
    `🧾 Code: ${order.order_code}\n` +
    `🎮 Game: ${order.game_code.toUpperCase()}\n` +
    `📦 Package: ${order.package_name}\n` +
    `🆔 Player ID: ${order.player_id}${order.zone_id ? ' | Zone: ' + order.zone_id : ''}\n` +
    `💵 Amount: $${order.amount.toFixed(2)}\n` +
    `📌 Status: ${order.status}`;

  bot
    .sendMessage(adminChatId, text, {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ Approve', callback_data: `admin:approve:${order.order_code}` },
            { text: '❌ Reject', callback_data: `admin:reject:${order.order_code}` },
          ],
          [{ text: '📦 Mark Delivered', callback_data: `admin:delivered:${order.order_code}` }],
        ],
      },
    })
    .then((sent) => {
      db.prepare('UPDATE orders SET telegram_msg_id=? WHERE order_code=?').run(String(sent.message_id), order.order_code);
    })
    .catch((e) => console.error('[telegram] forwardOrderToAdmin failed:', e.message));
}

function forwardPaidUpdateToAdmin(order) {
  if (!bot) return;
  const adminChatId = getSetting('telegram_admin_chat_id');
  if (!adminChatId) return;
  bot.sendMessage(adminChatId, `💰 Order ${order.order_code} has been PAID (auto-verified). Please deliver the top-up.`);
}

module.exports = { initBot, forwardOrderToAdmin, forwardPaidUpdateToAdmin, getBot: () => bot };
