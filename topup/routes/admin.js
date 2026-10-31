// routes/admin.js — full admin panel API (auth + orders + stock + settings)
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db/connection');

function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key=?').get(key);
  return row ? row.value : '';
}
function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value);
}
function jwtSecret() {
  return getSetting('jwt_secret') || 'fallback_dev_secret_change_me';
}

// ---------- auth middleware ----------
function requireAuth(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ ok: false, error: 'Not authenticated' });
  try {
    req.admin = jwt.verify(token, jwtSecret());
    next();
  } catch {
    res.status(401).json({ ok: false, error: 'Invalid or expired token' });
  }
}

// ---------- POST /admin/api/login ----------
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  const admin = db.prepare('SELECT * FROM admins WHERE username=?').get(username);
  if (!admin || !bcrypt.compareSync(password || '', admin.password_hash)) {
    return res.status(401).json({ ok: false, error: 'Invalid username or password' });
  }
  const token = jwt.sign({ id: admin.id, username: admin.username, role: admin.role }, jwtSecret(), { expiresIn: '12h' });
  res.json({ ok: true, token, admin: { username: admin.username, role: admin.role } });
});

// ---------- POST /admin/api/change-password ----------
router.post('/change-password', requireAuth, (req, res) => {
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ ok: false, error: 'Password must be at least 6 characters' });
  }
  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE admins SET password_hash=? WHERE id=?').run(hash, req.admin.id);
  res.json({ ok: true });
});

// ---------- GET /admin/api/dashboard ----------
router.get('/dashboard', requireAuth, (req, res) => {
  const totalOrders = db.prepare('SELECT COUNT(*) c FROM orders').get().c;
  const pending = db.prepare("SELECT COUNT(*) c FROM orders WHERE status IN ('pending','scanned')").get().c;
  const paidToday = db
    .prepare("SELECT COUNT(*) c, COALESCE(SUM(amount),0) rev FROM orders WHERE status IN ('paid','delivering','completed') AND date(created_at)=date('now')")
    .get();
  const revenueTotal = db.prepare("SELECT COALESCE(SUM(amount),0) r FROM orders WHERE status IN ('paid','delivering','completed')").get().r;
  const byStatus = db.prepare('SELECT status, COUNT(*) c FROM orders GROUP BY status').all();
  const recentOrders = db.prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT 10').all();
  res.json({
    ok: true,
    stats: { totalOrders, pending, ordersToday: paidToday.c, revenueToday: paidToday.rev, revenueTotal, byStatus },
    recentOrders,
  });
});

// ---------- GET /admin/api/orders (filterable) ----------
router.get('/orders', requireAuth, (req, res) => {
  const { status, game, q } = req.query;
  let sql = 'SELECT * FROM orders WHERE 1=1';
  const params = [];
  if (status) { sql += ' AND status=?'; params.push(status); }
  if (game) { sql += ' AND game_code=?'; params.push(game); }
  if (q) { sql += ' AND (order_code LIKE ? OR player_id LIKE ?)'; params.push(`%${q}%`, `%${q}%`); }
  sql += ' ORDER BY created_at DESC LIMIT 200';
  const orders = db.prepare(sql).all(...params);
  res.json({ ok: true, orders });
});

// ---------- PATCH /admin/api/orders/:code/status ----------
router.patch('/orders/:code/status', requireAuth, (req, res) => {
  const { status, note } = req.body;
  const allowed = ['pending', 'scanned', 'paid', 'delivering', 'completed', 'failed', 'expired', 'cancelled'];
  if (!allowed.includes(status)) return res.status(400).json({ ok: false, error: 'Invalid status' });

  const order = db.prepare('SELECT * FROM orders WHERE order_code=?').get(req.params.code);
  if (!order) return res.status(404).json({ ok: false, error: 'Order not found' });

  const extra = status === 'paid' ? ", paid_at=datetime('now')" : status === 'completed' ? ", completed_at=datetime('now')" : '';
  db.prepare(`UPDATE orders SET status=?, admin_note=COALESCE(?, admin_note) ${extra} WHERE order_code=?`).run(status, note || null, req.params.code);

  // decrement stock only when actually completed (diamonds delivered)
  if (status === 'completed' && order.package_id) {
    db.prepare('UPDATE packages SET stock = MAX(stock - 1, 0) WHERE id=?').run(order.package_id);
  }

  const updated = db.prepare('SELECT * FROM orders WHERE order_code=?').get(req.params.code);
  res.json({ ok: true, order: updated });
});

// ---------- GAMES ----------
router.get('/games', requireAuth, (req, res) => {
  res.json({ ok: true, games: db.prepare('SELECT * FROM games').all() });
});

// ---------- PACKAGES / STOCK ----------
router.get('/packages', requireAuth, (req, res) => {
  const rows = db
    .prepare(
      `SELECT p.*, g.code as game_code, g.name as game_name
       FROM packages p JOIN games g ON g.id = p.game_id
       ORDER BY g.code, p.sort_order`
    )
    .all();
  res.json({ ok: true, packages: rows });
});

router.post('/packages', requireAuth, (req, res) => {
  const { game_id, name, price, cost, stock, sort_order } = req.body;
  if (!game_id || !name || price == null) return res.status(400).json({ ok: false, error: 'Missing fields' });
  const info = db
    .prepare('INSERT INTO packages (game_id,name,price,cost,stock,sort_order) VALUES (?,?,?,?,?,?)')
    .run(game_id, name, price, cost || 0, stock ?? 0, sort_order || 0);
  res.json({ ok: true, id: info.lastInsertRowid });
});

router.patch('/packages/:id', requireAuth, (req, res) => {
  const fields = ['name', 'price', 'cost', 'stock', 'active', 'sort_order'];
  const updates = [];
  const params = [];
  for (const f of fields) {
    if (req.body[f] !== undefined) { updates.push(`${f}=?`); params.push(req.body[f]); }
  }
  if (!updates.length) return res.status(400).json({ ok: false, error: 'No fields to update' });
  params.push(req.params.id);
  db.prepare(`UPDATE packages SET ${updates.join(', ')} WHERE id=?`).run(...params);
  res.json({ ok: true });
});

// quick stock add (restock button)
router.post('/packages/:id/restock', requireAuth, (req, res) => {
  const amount = Number(req.body.amount || 0);
  db.prepare('UPDATE packages SET stock = stock + ? WHERE id=?').run(amount, req.params.id);
  const pkg = db.prepare('SELECT * FROM packages WHERE id=?').get(req.params.id);
  res.json({ ok: true, package: pkg });
});

router.delete('/packages/:id', requireAuth, (req, res) => {
  db.prepare('UPDATE packages SET active=0 WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- SETTINGS ----------
router.get('/settings', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  for (const r of rows) {
    if (r.key === 'jwt_secret') continue; // never expose
    settings[r.key] = r.value;
  }
  res.json({ ok: true, settings });
});

router.post('/settings', requireAuth, (req, res) => {
  const allowedKeys = [
    'shop_name', 'bakong_account_id', 'merchant_name', 'merchant_city',
    'bakong_api_token', 'telegram_bot_token', 'telegram_admin_chat_id',
  ];
  for (const [k, v] of Object.entries(req.body || {})) {
    if (allowedKeys.includes(k)) setSetting(k, String(v));
  }
  res.json({ ok: true });
});

// restart telegram bot after token/settings change
router.post('/telegram/restart', requireAuth, (req, res) => {
  try {
    delete require.cache[require.resolve('../telegram/bot')];
    const { initBot } = require('../telegram/bot');
    initBot();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = { router, requireAuth };
