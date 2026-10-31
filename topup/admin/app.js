// admin/app.js
const token = localStorage.getItem('admin_token');
if (!token) location.href = '/admin/login.html';

function authHeaders(json = true) {
  const h = { Authorization: `Bearer ${token}` };
  if (json) h['Content-Type'] = 'application/json';
  return h;
}
function logout() { localStorage.removeItem('admin_token'); location.href = '/admin/login.html'; }

async function api(path, opts = {}) {
  const res = await fetch(path, { ...opts, headers: authHeaders(!!opts.body) });
  if (res.status === 401) { logout(); throw new Error('Session expired'); }
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// ---------- tab switching ----------
document.querySelectorAll('.nav-item[data-tab]').forEach((item) => {
  item.addEventListener('click', () => switchTab(item.dataset.tab));
});
function switchTab(tab) {
  document.querySelectorAll('.nav-item[data-tab]').forEach((i) => i.classList.toggle('active', i.dataset.tab === tab));
  document.querySelectorAll('[id^="tab-"]').forEach((el) => el.classList.add('hidden'));
  document.getElementById(`tab-${tab}`).classList.remove('hidden');
  document.getElementById('pageTitle').innerText = tab[0].toUpperCase() + tab.slice(1);
  if (tab === 'dashboard') loadDashboard();
  if (tab === 'orders') loadOrders();
  if (tab === 'packages') loadPackages();
  if (tab === 'settings') loadSettings();
}

// ---------- dashboard ----------
async function loadDashboard() {
  const { stats, recentOrders } = await api('/admin/api/dashboard');
  document.getElementById('statCards').innerHTML = `
    <div class="stat-card"><div class="label">Total Orders</div><div class="value">${stats.totalOrders}</div></div>
    <div class="stat-card"><div class="label">Pending</div><div class="value">${stats.pending}</div></div>
    <div class="stat-card"><div class="label">Orders Today</div><div class="value">${stats.ordersToday}</div></div>
    <div class="stat-card"><div class="label">Revenue Today</div><div class="value">$${stats.revenueToday.toFixed(2)}</div></div>
    <div class="stat-card"><div class="label">Total Revenue</div><div class="value">$${stats.revenueTotal.toFixed(2)}</div></div>
  `;
  const tbody = document.querySelector('#recentTable tbody');
  tbody.innerHTML = recentOrders
    .map((o) => `<tr><td>${o.order_code}</td><td>${o.game_code}</td><td>${o.package_name}</td><td>${o.player_id}</td><td>$${o.amount.toFixed(2)}</td><td><span class="badge b-${o.status}">${o.status}</span></td><td>${o.created_at}</td></tr>`)
    .join('');
}

// ---------- orders ----------
const STATUS_OPTIONS = ['pending', 'scanned', 'paid', 'delivering', 'completed', 'failed', 'expired', 'cancelled'];
async function loadOrders() {
  const status = document.getElementById('fStatus').value;
  const game = document.getElementById('fGame').value;
  const q = document.getElementById('fQ').value;
  const params = new URLSearchParams({ ...(status && { status }), ...(game && { game }), ...(q && { q }) });
  const { orders } = await api(`/admin/api/orders?${params}`);
  const tbody = document.querySelector('#ordersTable tbody');
  tbody.innerHTML = orders
    .map(
      (o) => `<tr>
      <td>${o.order_code}</td><td>${o.source}</td><td>${o.game_code}</td><td>${o.package_name}</td>
      <td>${o.player_id}${o.zone_id ? ' / ' + o.zone_id : ''}</td><td>$${o.amount.toFixed(2)}</td>
      <td><span class="badge b-${o.status}">${o.status}</span></td><td>${o.created_at}</td>
      <td>
        <select class="status-select" onchange="updateStatus('${o.order_code}', this.value)">
          ${STATUS_OPTIONS.map((s) => `<option value="${s}" ${s === o.status ? 'selected' : ''}>${s}</option>`).join('')}
        </select>
      </td>
    </tr>`
    )
    .join('');
}
async function updateStatus(code, status) {
  await api(`/admin/api/orders/${code}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
  loadOrders();
}

// ---------- packages / stock ----------
async function loadPackages() {
  const { packages } = await api('/admin/api/packages');
  const tbody = document.querySelector('#packagesTable tbody');
  tbody.innerHTML = packages
    .map(
      (p) => `<tr>
      <td>${p.game_code}</td><td>${p.name}</td>
      <td><input value="${p.price}" style="width:70px;background:var(--bg);color:#fff;border:1px solid rgba(0,180,216,.3);border-radius:6px;padding:4px;" onchange="editPackage(${p.id},'price',this.value)"></td>
      <td><input value="${p.cost}" style="width:70px;background:var(--bg);color:#fff;border:1px solid rgba(0,180,216,.3);border-radius:6px;padding:4px;" onchange="editPackage(${p.id},'cost',this.value)"></td>
      <td>${p.stock} <button class="btn btn-sm" onclick="restock(${p.id})">+Restock</button></td>
      <td><input type="checkbox" ${p.active ? 'checked' : ''} onchange="editPackage(${p.id},'active',this.checked?1:0)"></td>
      <td><button class="btn btn-sm btn-red" onclick="deactivatePackage(${p.id})">Remove</button></td>
    </tr>`
    )
    .join('');
}
async function addPackage() {
  const game_id = Number(document.getElementById('npGame').value);
  const name = document.getElementById('npName').value.trim();
  const price = parseFloat(document.getElementById('npPrice').value);
  const cost = parseFloat(document.getElementById('npCost').value || 0);
  const stock = parseInt(document.getElementById('npStock').value || 0, 10);
  if (!name || isNaN(price)) return alert('Please fill package name and price');
  await api('/admin/api/packages', { method: 'POST', body: JSON.stringify({ game_id, name, price, cost, stock }) });
  document.getElementById('npName').value = '';
  document.getElementById('npPrice').value = '';
  document.getElementById('npCost').value = '';
  document.getElementById('npStock').value = '';
  loadPackages();
}
async function editPackage(id, field, value) {
  await api(`/admin/api/packages/${id}`, { method: 'PATCH', body: JSON.stringify({ [field]: value }) });
  loadPackages();
}
async function restock(id) {
  const amount = prompt('How many units to add to stock?');
  if (!amount) return;
  await api(`/admin/api/packages/${id}/restock`, { method: 'POST', body: JSON.stringify({ amount: parseInt(amount, 10) }) });
  loadPackages();
}
async function deactivatePackage(id) {
  if (!confirm('Remove this package from the storefront?')) return;
  await api(`/admin/api/packages/${id}`, { method: 'DELETE' });
  loadPackages();
}

// ---------- settings ----------
async function loadSettings() {
  const { settings } = await api('/admin/api/settings');
  document.getElementById('sShopName').value = settings.shop_name || '';
  document.getElementById('sBakongId').value = settings.bakong_account_id || '';
  document.getElementById('sMerchantName').value = settings.merchant_name || '';
  document.getElementById('sMerchantCity').value = settings.merchant_city || '';
  document.getElementById('sBakongToken').value = settings.bakong_api_token || '';
  document.getElementById('sTgToken').value = settings.telegram_bot_token || '';
  document.getElementById('sTgChat').value = settings.telegram_admin_chat_id || '';
}
async function saveSettings() {
  await api('/admin/api/settings', {
    method: 'POST',
    body: JSON.stringify({
      shop_name: document.getElementById('sShopName').value,
      bakong_account_id: document.getElementById('sBakongId').value,
      merchant_name: document.getElementById('sMerchantName').value,
      merchant_city: document.getElementById('sMerchantCity').value,
      bakong_api_token: document.getElementById('sBakongToken').value,
      telegram_bot_token: document.getElementById('sTgToken').value,
      telegram_admin_chat_id: document.getElementById('sTgChat').value,
    }),
  });
  alert('Settings saved.');
}
async function restartBot() {
  await api('/admin/api/telegram/restart', { method: 'POST', body: '{}' });
  alert('Telegram bot restarted with the latest token.');
}
async function changePassword() {
  const newPassword = document.getElementById('newPass').value;
  if (!newPassword) return;
  await api('/admin/api/change-password', { method: 'POST', body: JSON.stringify({ newPassword }) });
  document.getElementById('newPass').value = '';
  alert('Password updated.');
}

loadDashboard();
