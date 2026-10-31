// db/init.js — creates schema + seeds default admin, games, packages, settings
const path = require('path');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, 'store.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin', -- admin | staff
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,        -- 'mlbb' | 'freefire'
  name TEXT NOT NULL,
  needs_zone INTEGER DEFAULT 0,     -- 1 = requires Zone/Server ID (MLBB)
  image TEXT,
  active INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS packages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  name TEXT NOT NULL,               -- '86 Diamonds'
  price REAL NOT NULL,              -- sell price USD
  cost REAL DEFAULT 0,              -- admin cost price USD (for profit reports)
  stock INTEGER DEFAULT 999,        -- available stock/quota for this package
  active INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_code TEXT UNIQUE NOT NULL,      -- e.g. LDN-20260816-0001
  game_code TEXT NOT NULL,
  package_id INTEGER REFERENCES packages(id),
  package_name TEXT NOT NULL,
  player_id TEXT NOT NULL,
  zone_id TEXT,
  amount REAL NOT NULL,
  currency TEXT DEFAULT 'USD',
  khqr_string TEXT,
  khqr_md5 TEXT,
  status TEXT DEFAULT 'pending',    -- pending | scanned | paid | delivering | completed | failed | expired | cancelled
  source TEXT DEFAULT 'web',        -- web | telegram
  customer_chat_id TEXT,            -- telegram chat id if ordered via bot
  admin_note TEXT,
  telegram_msg_id TEXT,             -- message id posted to admin group for approve/reject
  created_at TEXT DEFAULT (datetime('now')),
  paid_at TEXT,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_code ON orders(order_code);
`);

// ---- seed default admin ----
const adminCount = db.prepare('SELECT COUNT(*) c FROM admins').get().c;
if (adminCount === 0) {
  const hash = bcrypt.hashSync('admin123', 10);
  db.prepare('INSERT INTO admins (username, password_hash, role) VALUES (?,?,?)')
    .run('admin', hash, 'owner');
  console.log('Seeded default admin -> username: admin / password: admin123 (CHANGE THIS IMMEDIATELY)');
}

// ---- seed games ----
const games = [
  { code: 'mlbb', name: 'Mobile Legends: Bang Bang', needs_zone: 1, image: 'ml.jpg' },
  { code: 'freefire', name: 'Free Fire', needs_zone: 0, image: 'ff.jpg' },
];
const getGame = db.prepare('SELECT id FROM games WHERE code = ?');
const insGame = db.prepare('INSERT INTO games (code,name,needs_zone,image) VALUES (?,?,?,?)');
for (const g of games) {
  if (!getGame.get(g.code)) insGame.run(g.code, g.name, g.needs_zone, g.image);
}

// ---- seed packages (from your existing mlbb.html / freefire.html) ----
const mlbbId = getGame.get('mlbb').id;
const ffId = getGame.get('freefire').id;

const pkgCount = db.prepare('SELECT COUNT(*) c FROM packages').get().c;
if (pkgCount === 0) {
  const insPkg = db.prepare(
    'INSERT INTO packages (game_id,name,price,cost,stock,sort_order) VALUES (?,?,?,?,?,?)'
  );
  const mlbbPkgs = [
    ['86 Diamonds', 1.25, 1.05, 500],
    ['172 Diamonds', 2.50, 2.15, 500],
    ['257 Diamonds', 3.70, 3.20, 500],
    ['706 Diamonds', 9.80, 8.60, 300],
    ['2195 Diamonds', 29.50, 26.50, 100],
    ['Weekly Diamond Pass', 1.99, 1.70, 999],
  ];
  const ffPkgs = [
    ['100 Diamonds', 1.00, 0.85, 500],
    ['310 Diamonds', 3.00, 2.60, 500],
    ['520 Diamonds', 5.00, 4.35, 500],
    ['1060 Diamonds', 10.00, 8.70, 300],
    ['2180 Diamonds', 20.00, 17.50, 100],
    ['Weekly Membership', 1.99, 1.70, 999],
  ];
  mlbbPkgs.forEach((p, i) => insPkg.run(mlbbId, p[0], p[1], p[2], p[3], i));
  ffPkgs.forEach((p, i) => insPkg.run(ffId, p[0], p[1], p[2], p[3], i));
  console.log('Seeded MLBB + Free Fire packages');
}

// ---- seed settings ----
const defaults = {
  shop_name: 'Lydalin Topup',
  bakong_account_id: 'your_bakong_id@devb',     // Bakong merchant account id (KHQR)
  merchant_name: 'LYDALIN SHOP',
  merchant_city: 'Phnom Penh',
  bakong_api_token: '',                          // Bakong Open API bearer token, for auto-verify polling
  telegram_bot_token: '',
  telegram_admin_chat_id: '',                    // group/channel id that receives new-order alerts
  jwt_secret: require('crypto').randomBytes(32).toString('hex'),
};
const getSet = db.prepare('SELECT value FROM settings WHERE key=?');
const insSet = db.prepare('INSERT INTO settings (key,value) VALUES (?,?)');
for (const [k, v] of Object.entries(defaults)) {
  if (!getSet.get(k)) insSet.run(k, v);
}

console.log('Database ready at', DB_PATH);
module.exports = db;
