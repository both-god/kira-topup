// game.js — shared logic for mlbb.html / freefire.html
// expects a global GAME_CODE and NEEDS_ZONE set by the page before this script loads

let selectedPackage = null;
let isPaymentSelected = false;
let pollTimer = null;

const menuOverlay = document.getElementById('menuOverlay');
document.getElementById('openMenuBtn').onclick = () => menuOverlay.classList.add('active');
document.getElementById('closeMenuBtn').onclick = () => menuOverlay.classList.remove('active');
menuOverlay.onclick = (e) => { if (e.target === menuOverlay) menuOverlay.classList.remove('active'); };

const termsModal = document.getElementById('termsModal');
function openTermsModal(){ menuOverlay.classList.remove('active'); termsModal.classList.add('active'); }
function closeTermsModal(){ termsModal.classList.remove('active'); }
termsModal.onclick = (e) => { if (e.target === termsModal) closeTermsModal(); };

const zoneWrapEl = document.getElementById('zoneWrap');
if (NEEDS_ZONE && zoneWrapEl) zoneWrapEl.style.display = 'block';

async function loadPackages(){
  const res = await fetch(`/api/packages/${GAME_CODE}`);
  const data = await res.json();
  const grid = document.getElementById('packageGrid');
  grid.innerHTML = data.packages.map(p => `
    <div class="package-item ${p.in_stock ? '' : 'out-of-stock'}" data-id="${p.id}" data-price="${p.price}" data-name="${p.name}" onclick="selectPackage(this)">
      ${!p.in_stock ? '<span class="stock-tag">OUT OF STOCK</span>' : ''}
      <div class="package-name"><i class="fa-solid fa-gem" style="color:var(--accent-blue);"></i> ${p.name}</div>
      <div class="package-price">$${p.price.toFixed(2)}</div>
    </div>`).join('');
}
loadPackages();

function selectPackage(el){
  if (el.classList.contains('out-of-stock')) return;
  document.querySelectorAll('.package-item').forEach(i => i.classList.remove('selected'));
  el.classList.add('selected');
  selectedPackage = { id: el.dataset.id, name: el.dataset.name, price: parseFloat(el.dataset.price) };
  updateSummary();
}

function selectPaymentMethod(){
  const box = document.getElementById('khqrPaymentBox');
  isPaymentSelected = !isPaymentSelected;
  box.classList.toggle('selected', isPaymentSelected);
  document.getElementById('khqrRadio').checked = isPaymentSelected;
}

function updateSummary(){
  document.getElementById('sumPlayerId').innerText = document.getElementById('playerId').value.trim() || '-';
  if (NEEDS_ZONE) document.getElementById('sumZoneId').innerText = document.getElementById('zoneId').value.trim() || '-';
  document.getElementById('sumProduct').innerText = selectedPackage ? selectedPackage.name : '-';
  document.getElementById('sumPrice').innerText = selectedPackage ? `$${selectedPackage.price.toFixed(2)}` : '$0.00';
}
document.getElementById('playerId').addEventListener('input', updateSummary);
if (NEEDS_ZONE) document.getElementById('zoneId').addEventListener('input', updateSummary);

async function processTopup(){
  const playerId = document.getElementById('playerId').value.trim();
  const zoneId = NEEDS_ZONE ? document.getElementById('zoneId').value.trim() : null;
  const agree = document.getElementById('agreeTerms').checked;

  if (!playerId) return alert('❌ សូមបញ្ចូល Player ID!');
  if (NEEDS_ZONE && !zoneId) return alert('❌ សូមបញ្ចូល Zone/Server ID!');
  if (!selectedPackage) return alert('❌ សូមជ្រើសរើសកញ្ចប់ Diamonds!');
  if (!isPaymentSelected) return alert('❌ សូមជ្រើសរើសវិធីទូទាត់ KHQR!');
  if (!agree) return alert('❌ សូមយល់ព្រមតាមលក្ខខណ្ឌសិន!');

  const payBtn = document.getElementById('payBtn');
  payBtn.disabled = true;
  payBtn.innerText = 'កំពុងបង្កើត QR...';

  try {
    const res = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameCode: GAME_CODE, packageId: selectedPackage.id, playerId, zoneId }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    openQrModal(data.order, data.qr);
  } catch (e) {
    alert('❌ ' + e.message);
  } finally {
    payBtn.disabled = false;
    payBtn.innerText = 'ទូទាត់ប្រាក់ឥឡូវ';
  }
}

function openQrModal(order, qrDataUrl){
  document.getElementById('qrImg').src = qrDataUrl;
  document.getElementById('qrOrderCode').innerText = order.order_code;
  document.getElementById('qrAmount').innerText = `$${order.amount.toFixed(2)}`;
  document.getElementById('qrProduct').innerText = order.package_name;
  setStatus(order.status);
  document.getElementById('qrModal').classList.add('active');

  clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    const res = await fetch(`/api/orders/${order.order_code}`);
    const data = await res.json();
    if (!data.ok) return;
    setStatus(data.order.status);
    if (['completed','failed','expired','cancelled'].includes(data.order.status)) {
      clearInterval(pollTimer);
    }
  }, 3000);
}

function setStatus(status){
  const badge = document.getElementById('statusBadge');
  const map = {
    pending: ['fa-regular fa-clock', 'pending'],
    scanned: ['fa-solid fa-expand', 'scanned'],
    paid: ['fa-solid fa-circle-check', 'paid — verifying'],
    delivering: ['fa-solid fa-spinner spinner', 'delivering'],
    completed: ['fa-solid fa-circle-check', 'completed'],
    failed: ['fa-solid fa-circle-xmark', 'failed'],
    expired: ['fa-solid fa-hourglass-end', 'expired'],
    cancelled: ['fa-solid fa-ban', 'cancelled'],
  };
  const [icon, label] = map[status] || map.pending;
  badge.className = `status-badge status-${status}`;
  badge.innerHTML = `<i class="${icon}"></i> <span>${label}</span>`;
}

function closeQrModal(){
  document.getElementById('qrModal').classList.remove('active');
  clearInterval(pollTimer);
}
