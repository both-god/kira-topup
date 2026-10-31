// routes/api.js — public-facing API used by the storefront pages
const express = require('express');
const router = express.Router();
const db = require('../db/connection');
const { createOrderRecord } = require('../utils/orders');
const { khqrToPngDataUrl } = require('../utils/khqr');
const { startPolling } = require('../utils/poller');

// GET /api/games  -> active games
router.get('/games', (req, res) => {
  const games = db.prepare('SELECT id, code, name, needs_zone, image FROM games WHERE active=1').all();
  res.json({ ok: true, games });
});

// GET /api/packages/:gameCode -> active packages for a game
router.get('/packages/:gameCode', (req, res) => {
  const game = db.prepare('SELECT * FROM games WHERE code=?').get(req.params.gameCode);
  if (!game) return res.status(404).json({ ok: false, error: 'Game not found' });
  const pkgs = db
    .prepare('SELECT id, name, price, stock FROM packages WHERE game_id=? AND active=1 ORDER BY sort_order')
    .all(game.id);
  res.json({ ok: true, game, packages: pkgs.map((p) => ({ ...p, in_stock: p.stock > 0 })) });
});

// POST /api/orders -> { gameCode, packageId, playerId, zoneId }
router.post('/orders', async (req, res) => {
  try {
    const { gameCode, packageId, playerId, zoneId } = req.body;
    if (!gameCode || !packageId || !playerId) {
      return res.status(400).json({ ok: false, error: 'Missing required fields' });
    }
    const game = db.prepare('SELECT * FROM games WHERE code=?').get(gameCode);
    if (!game) return res.status(404).json({ ok: false, error: 'Game not found' });
    if (game.needs_zone && !zoneId) {
      return res.status(400).json({ ok: false, error: 'Zone/Server ID required for this game' });
    }
    const pkg = db.prepare('SELECT * FROM packages WHERE id=? AND game_id=? AND active=1').get(packageId, game.id);
    if (!pkg) return res.status(404).json({ ok: false, error: 'Package not found' });
    if (pkg.stock <= 0) return res.status(409).json({ ok: false, error: 'Package out of stock' });

    const order = createOrderRecord({ gameCode, pkg, playerId, zoneId, source: 'web' });
    const qrDataUrl = await khqrToPngDataUrl(order.khqr_string);

    // Forward to Telegram admin + start auto-payment polling
    try {
      const { forwardOrderToAdmin, forwardPaidUpdateToAdmin } = require('../telegram/bot');
      forwardOrderToAdmin(order);
      startPolling(order.order_code, (paidOrder) => forwardPaidUpdateToAdmin(paidOrder));
    } catch (e) {
      console.warn('[api] telegram forward skipped:', e.message);
    }

    res.json({ ok: true, order: sanitize(order), qr: qrDataUrl });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/orders/:code -> poll status (used by checkout page)
router.get('/orders/:code', (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE order_code=?').get(req.params.code);
  if (!order) return res.status(404).json({ ok: false, error: 'Order not found' });
  res.json({ ok: true, order: sanitize(order) });
});

function sanitize(order) {
  const { khqr_string, khqr_md5, ...rest } = order;
  return rest;
}

module.exports = router;
