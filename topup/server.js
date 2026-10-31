// server.js
require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');

require('./db/init'); // ensure schema + seed run first

const app = express();
app.use(cors());
app.use(express.json());

// ---------- Public storefront (adapted from your uploaded HTML designs) ----------
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Admin panel static files ----------
app.use('/admin', express.static(path.join(__dirname, 'admin')));

// ---------- APIs ----------
app.use('/api', require('./routes/api'));
const { router: adminRouter } = require('./routes/admin');
app.use('/admin/api', adminRouter);

app.get('/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🚀 Lydalin Topup running at http://localhost:${PORT}`);
  console.log(`   Storefront:  http://localhost:${PORT}/`);
  console.log(`   Admin panel: http://localhost:${PORT}/admin/  (default admin / admin123 — change immediately)`);

  // Start Telegram bot if a token is already configured
  try {
    const { initBot } = require('./telegram/bot');
    initBot();
  } catch (e) {
    console.warn('[telegram] not started:', e.message);
  }
});
