# Lydalin Topup — Full-Stack Game Top-up Store

A complete, working full-stack store for **Mobile Legends** and **Free Fire** diamond top-ups, built from your original page designs. Includes:

- 🛒 Storefront (home, MLBB, Free Fire) with dynamic packages & live stock, in your blue/white Khmer design
- 💳 Real KHQR (Bakong) QR code generation per order, with an auto-payment poller against Bakong's Open API
- 🤖 Telegram bot: every website order is forwarded to your admin group with Approve / Reject / Mark-Delivered buttons, **and** customers can order directly by chatting with the bot (`/topup`)
- 🖥️ Full admin panel: dashboard stats, order management, package & stock management, settings (Bakong + Telegram config), password change
- 🗄️ SQLite database (file-based, zero setup) with admins, games, packages/stock, orders, settings tables

## 1. Install & run

```bash
npm install
npm start
```

The first run creates `db/store.db` automatically and seeds:
- Default admin: **username `admin` / password `admin123`** — change this immediately in Admin → Settings → Change Password.
- MLBB and Free Fire packages (from your original price lists).

Then open:
- Storefront: `http://localhost:3000/`
- Admin panel: `http://localhost:3000/admin/`

## 2. Turn on real KHQR auto-payment verification

The store already generates a real, scannable KHQR code for every order. To make payments **auto-confirm** (no manual click needed):

1. Get a free developer token at https://api-bakong.nbc.gov.kh
2. In **Admin → Settings**, fill in:
   - `Bakong account id` — your real Bakong ID (e.g. `yourname@devb`), this is what receives the money
   - `Bakong Open API token` — the token from step 1
3. Save. New orders will now be polled automatically every few seconds; the moment Bakong confirms the transfer, the order flips to `paid` on its own, the customer's status badge updates live, and the order is forwarded to your Telegram group as "PAID — please deliver".

Without a token, KHQR codes still work for customers to scan and pay — you (or your staff) just confirm payment manually from **Admin → Orders** or via the Telegram Approve button.

## 3. Turn on the Telegram bot (order forwarding + bot ordering)

1. Message **@BotFather** on Telegram, `/newbot`, copy the token.
2. In **Admin → Settings → Telegram Bot**, paste the token, save, click **Restart Bot**.
3. Add your bot to your admin group/channel, send any message, then find the chat id (e.g. via `https://api.telegram.org/bot<token>/getUpdates` or a "get chat id" bot) and paste it into `Admin group/channel chat id`, save.
4. From now on:
   - Every web order is posted to that group with ✅ Approve / ❌ Reject / 📦 Mark Delivered buttons.
   - Customers can also message your bot directly and type `/topup` to order a game top-up entirely inside Telegram — it walks them through game → package → player ID → KHQR, exactly like the website.

## 4. Managing stock & packages

**Admin → Packages / Stock** lets you:
- Add new packages per game
- Edit price/cost inline
- **Restock**: add units to a package's available stock
- Stock is only decremented when you mark an order **Completed** (i.e. diamonds actually delivered), so pending/unpaid orders never lock up your stock.

## 5. Project structure

```
server.js            entrypoint
db/init.js            schema + seed data (admins, games, packages, settings)
db/connection.js       shared sqlite connection
routes/api.js           public storefront API (games, packages, orders)
routes/admin.js         admin API (auth, dashboard, orders, packages, settings)
telegram/bot.js         Telegram bot: forwarding + in-chat ordering wizard
utils/khqr.js            KHQR (EMVCo) string builder + QR image renderer
utils/poller.js          Bakong auto-payment status poller
utils/orders.js          shared order-creation logic (web + Telegram both use this)
public/                 storefront (index.html, mlbb.html, freefire.html, game.js, style.css)
admin/                  admin panel (login.html, index.html, app.js)
```

## 6. Database

SQLite, file at `db/store.db` — no external database server needed. Tables: `admins`, `games`, `packages`, `orders`, `settings`. To fully reset, stop the server and delete `db/store.db*`, then restart.

## 7. Deploying

Any Node.js host works (VPS, Render, Railway, etc.) — just run `npm install && npm start`, keep `db/store.db` on persistent disk, and set your Bakong/Telegram credentials from the admin panel after first deploy. Put a real domain + HTTPS in front of it (e.g. via Nginx or the platform's built-in TLS) before going live, since the admin panel handles login credentials.

## 8. Security notes before going live

- Change the default admin password immediately.
- The JWT secret is auto-generated per install (stored in `settings`) — do not commit `db/store.db` to a public repo.
- Consider adding rate limiting (e.g. `express-rate-limit`) on `/admin/api/login` and `/api/orders` for production.
