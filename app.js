/* =========================================================
   ระบบสต็อกสินค้า QR
   - เก็บข้อมูลใน localStorage (ไม่ต้องมีเซิร์ฟเวอร์/ฐานข้อมูล)
   - สร้าง QR code ติดสินค้า และสแกนด้วยกล้องเพื่อดูข้อมูล/ตัดสต็อก
   ========================================================= */

// ---------- ที่เก็บข้อมูล ----------
const DB_KEY = 'qr_stock_products';
const LOG_KEY = 'qr_stock_logs';
const LOW_STOCK = 5; // จำนวนที่ถือว่า "ใกล้หมด"

let products = JSON.parse(localStorage.getItem(DB_KEY) || '[]');
let logs = JSON.parse(localStorage.getItem(LOG_KEY) || '[]');

function saveProducts() { localStorage.setItem(DB_KEY, JSON.stringify(products)); }
function saveLogs() { localStorage.setItem(LOG_KEY, JSON.stringify(logs)); }

function findBySku(sku) {
  return products.find(p => p.sku.toLowerCase() === String(sku).trim().toLowerCase());
}

function addLog(type, product, qty) {
  logs.unshift({
    time: new Date().toISOString(),
    type,                 // 'in' | 'out' | 'create' | 'edit' | 'delete'
    sku: product.sku,
    name: product.name,
    qty,
    balance: product.qty,
    unit: product.unit,
  });
  if (logs.length > 500) logs.length = 500; // เก็บล่าสุด 500 รายการพอ
  saveLogs();
}

// ---------- ยูทิลิตี้ ----------
const $ = sel => document.querySelector(sel);

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => (t.hidden = true), 2200);
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtTime(iso) {
  return new Date(iso).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' });
}

function genSku() {
  let n = 1, sku;
  do { sku = 'P' + String(n).padStart(4, '0'); n++; } while (findBySku(sku));
  return sku;
}

// ---------- สลับแท็บ ----------
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-page').forEach(p =>
    p.classList.toggle('active', p.id === 'tab-' + tab));
  if (tab !== 'scan') stopScanner(); // ออกจากแท็บสแกนแล้วปิดกล้องให้
  if (tab === 'list') renderList();
  if (tab === 'history') renderHistory();
}

// ---------- สรุปยอดบนหัวเว็บ ----------
function renderSummary() {
  const totalItems = products.length;
  const totalQty = products.reduce((s, p) => s + p.qty, 0);
  $('#total-summary').textContent = `สินค้า ${totalItems} รายการ • รวม ${totalQty.toLocaleString()} ชิ้น`;
}

/* =========================================================
   เพิ่ม / แก้ไขสินค้า
   ========================================================= */
$('#btn-gen-sku').addEventListener('click', () => { $('#f-sku').value = genSku(); });

$('#product-form').addEventListener('submit', e => {
  e.preventDefault();
  const editingId = $('#f-editing-id').value;
  const sku = $('#f-sku').value.trim();
  const name = $('#f-name').value.trim();
  if (!sku || !name) return;

  const dup = findBySku(sku);
  if (dup && dup.id !== editingId) {
    toast('❌ รหัสสินค้า "' + sku + '" มีอยู่แล้ว');
    return;
  }

  const data = {
    sku,
    name,
    qty: Math.max(0, parseInt($('#f-qty').value, 10) || 0),
    unit: $('#f-unit').value.trim() || 'ชิ้น',
    category: $('#f-category').value.trim(),
    price: parseFloat($('#f-price').value) || 0,
    note: $('#f-note').value.trim(),
  };

  if (editingId) {
    const p = products.find(x => x.id === editingId);
    Object.assign(p, data, { updatedAt: new Date().toISOString() });
    saveProducts();
    addLog('edit', p, 0);
    toast('✅ แก้ไขสินค้าเรียบร้อย');
    resetForm();
    switchTab('list');
  } else {
    const p = {
      id: 'id' + Date.now() + Math.random().toString(36).slice(2, 6),
      ...data,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    products.push(p);
    saveProducts();
    addLog('create', p, p.qty);
    toast('✅ เพิ่มสินค้าเรียบร้อย');
    resetForm();
    showQrModal(p); // เพิ่มเสร็จโชว์ QR ให้เอาไปติดสินค้าเลย
  }
  renderSummary();
  renderList();
});

function resetForm() {
  $('#product-form').reset();
  $('#f-editing-id').value = '';
  $('#f-qty').value = 0;
  $('#f-price').value = 0;
  $('#f-unit').value = 'ชิ้น';
  $('#form-title').textContent = 'เพิ่มสินค้าใหม่';
  $('#btn-save').textContent = '💾 บันทึกสินค้า';
  $('#btn-cancel-edit').hidden = true;
}

$('#btn-cancel-edit').addEventListener('click', () => { resetForm(); switchTab('list'); });

function startEdit(id) {
  const p = products.find(x => x.id === id);
  if (!p) return;
  $('#f-editing-id').value = p.id;
  $('#f-sku').value = p.sku;
  $('#f-name').value = p.name;
  $('#f-qty').value = p.qty;
  $('#f-unit').value = p.unit;
  $('#f-category').value = p.category;
  $('#f-price').value = p.price;
  $('#f-note').value = p.note;
  $('#form-title').textContent = 'แก้ไขสินค้า: ' + p.name;
  $('#btn-save').textContent = '💾 บันทึกการแก้ไข';
  $('#btn-cancel-edit').hidden = false;
  switchTab('add');
}

function deleteProduct(id) {
  const p = products.find(x => x.id === id);
  if (!p) return;
  if (!confirm(`ลบสินค้า "${p.name}" (${p.sku}) ?`)) return;
  products = products.filter(x => x.id !== id);
  saveProducts();
  addLog('delete', p, 0);
  toast('🗑 ลบสินค้าแล้ว');
  renderSummary();
  renderList();
}

/* =========================================================
   รายการสินค้า
   ========================================================= */
$('#search-box').addEventListener('input', renderList);

function renderList() {
  const q = $('#search-box').value.trim().toLowerCase();
  const list = products.filter(p =>
    !q || p.name.toLowerCase().includes(q) ||
    p.sku.toLowerCase().includes(q) ||
    (p.category || '').toLowerCase().includes(q)
  );

  const box = $('#product-list');
  if (!list.length) {
    box.innerHTML = `<p class="empty-msg">${products.length ? 'ไม่พบสินค้าที่ค้นหา' : 'ยังไม่มีสินค้า — ไปที่แท็บ "เพิ่มสินค้า" เพื่อเริ่มต้น'}</p>`;
    return;
  }

  box.innerHTML = list.map(p => `
    <div class="product-item">
      <div class="product-info">
        <div class="name">${esc(p.name)}</div>
        <div class="meta">${esc(p.sku)}${p.category ? ' • ' + esc(p.category) : ''}${p.price ? ' • ' + p.price.toLocaleString() + ' บาท' : ''}</div>
      </div>
      <span class="qty-badge ${p.qty <= LOW_STOCK ? 'low' : ''}">${p.qty.toLocaleString()} ${esc(p.unit)}</span>
      <div class="product-actions">
        <button class="btn small success" data-act="in" data-id="${p.id}">+ รับเข้า</button>
        <button class="btn small warning" data-act="out" data-id="${p.id}">− เบิกออก</button>
        <button class="btn small" data-act="qr" data-id="${p.id}">QR</button>
        <button class="btn small" data-act="edit" data-id="${p.id}">✏</button>
        <button class="btn small danger" data-act="del" data-id="${p.id}">🗑</button>
      </div>
    </div>
  `).join('');
}

$('#product-list').addEventListener('click', e => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const { act, id } = btn.dataset;
  const p = products.find(x => x.id === id);
  if (!p) return;
  if (act === 'qr') showQrModal(p);
  else if (act === 'edit') startEdit(id);
  else if (act === 'del') deleteProduct(id);
  else if (act === 'in' || act === 'out') openMoveModal(p, act);
});

/* =========================================================
   รับเข้า / เบิกออก
   ========================================================= */
let moveTarget = null; // { product, type }

function openMoveModal(p, type) {
  moveTarget = { product: p, type };
  $('#move-modal-title').textContent = (type === 'in' ? '📥 รับสินค้าเข้า' : '📤 เบิกสินค้าออก');
  $('#move-modal-info').textContent = `${p.name} (${p.sku}) — คงเหลือ ${p.qty} ${p.unit}`;
  $('#move-qty').value = 1;
  $('#move-qty').max = type === 'out' ? p.qty : '';
  $('#move-modal').hidden = false;
  $('#move-qty').focus();
}

$('#btn-confirm-move').addEventListener('click', () => {
  if (!moveTarget) return;
  const { product: p, type } = moveTarget;
  const n = parseInt($('#move-qty').value, 10);
  if (!n || n <= 0) { toast('❌ กรุณาใส่จำนวนให้ถูกต้อง'); return; }
  if (type === 'out' && n > p.qty) { toast(`❌ สต็อกมีแค่ ${p.qty} ${p.unit} เบิกเกินไม่ได้`); return; }

  p.qty += (type === 'in' ? n : -n);
  p.updatedAt = new Date().toISOString();
  saveProducts();
  addLog(type, p, n);
  toast(type === 'in' ? `✅ รับเข้า ${n} ${p.unit}` : `✅ เบิกออก ${n} ${p.unit}`);
  $('#move-modal').hidden = true;
  moveTarget = null;
  renderSummary();
  renderList();
});

/* =========================================================
   QR Code: สร้าง / ดาวน์โหลด / พิมพ์
   ========================================================= */
let qrModalProduct = null;

function showQrModal(p) {
  qrModalProduct = p;
  $('#qr-modal-name').textContent = p.name;
  $('#qr-modal-sku').textContent = 'รหัสสินค้า: ' + p.sku;
  const box = $('#qr-code-box');
  box.innerHTML = '';
  new QRCode(box, { text: p.sku, width: 200, height: 200, correctLevel: QRCode.CorrectLevel.M });
  $('#qr-modal').hidden = false;
}

function getQrDataUrl() {
  const img = $('#qr-code-box img');
  const canvas = $('#qr-code-box canvas');
  if (img && img.src) return img.src;
  if (canvas) return canvas.toDataURL('image/png');
  return null;
}

$('#btn-download-qr').addEventListener('click', () => {
  const url = getQrDataUrl();
  if (!url || !qrModalProduct) return;
  const a = document.createElement('a');
  a.href = url;
  a.download = `QR_${qrModalProduct.sku}.png`;
  a.click();
});

$('#btn-print-qr').addEventListener('click', () => {
  const url = getQrDataUrl();
  if (!url || !qrModalProduct) return;
  const w = window.open('', '_blank');
  w.document.write(`
    <html><head><title>QR ${esc(qrModalProduct.sku)}</title></head>
    <body style="text-align:center;font-family:sans-serif;padding:30px">
      <h2 style="margin-bottom:4px">${esc(qrModalProduct.name)}</h2>
      <p style="margin-top:0;color:#555">${esc(qrModalProduct.sku)}</p>
      <img src="${url}" style="width:220px;height:220px">
      <script>window.onload = () => { window.print(); }<\/script>
    </body></html>`);
  w.document.close();
});

/* =========================================================
   สแกน QR ด้วยกล้อง
   ========================================================= */
let scanner = null;
let scanning = false;

$('#btn-start-scan').addEventListener('click', startScanner);
$('#btn-stop-scan').addEventListener('click', stopScanner);

// กรอบสแกนกว้างหน่อย เพื่อให้อ่านบาร์โค้ดแนวนอนได้ง่าย
const SCAN_CONFIG = { fps: 10, qrbox: { width: 280, height: 180 } };

// รองรับทั้ง QR code และบาร์โค้ดที่ใช้กับสินค้าทั่วไป
const SCAN_FORMATS = [
  Html5QrcodeSupportedFormats.QR_CODE,
  Html5QrcodeSupportedFormats.EAN_13,    // บาร์โค้ดสินค้าไทย/สากล (13 หลัก)
  Html5QrcodeSupportedFormats.EAN_8,
  Html5QrcodeSupportedFormats.UPC_A,
  Html5QrcodeSupportedFormats.UPC_E,
  Html5QrcodeSupportedFormats.CODE_128,
  Html5QrcodeSupportedFormats.CODE_39,
  Html5QrcodeSupportedFormats.ITF,
  Html5QrcodeSupportedFormats.CODABAR,
];

async function startScanner() {
  if (scanning) return;
  scanner = scanner || new Html5Qrcode('qr-reader', {
    formatsToSupport: SCAN_FORMATS,
    // ใช้ตัวอ่านบาร์โค้ดของเบราว์เซอร์โดยตรงถ้ามี (เร็วและแม่นกว่า)
    experimentalFeatures: { useBarCodeDetectorIfSupported: true },
    verbose: false,
  });
  try {
    // ลองใช้กล้องหลังก่อน (มือถือ)
    await scanner.start({ facingMode: 'environment' }, SCAN_CONFIG, onScanSuccess, () => {});
  } catch (err1) {
    // ถ้าไม่ได้ ให้หากล้องทั้งหมดในเครื่องแล้วใช้ตัวแรก (โน้ตบุ๊ก/PC)
    try {
      const cams = await Html5Qrcode.getCameras();
      if (!cams || !cams.length) throw err1;
      await scanner.start(cams[0].id, SCAN_CONFIG, onScanSuccess, () => {});
    } catch (err2) {
      console.error('เปิดกล้องไม่สำเร็จ:', err2);
      toast('❌ เปิดกล้องไม่ได้: ' + (err2.message || err2) + ' — ต้องอนุญาตกล้อง และเปิดผ่าน localhost หรือ https');
      return;
    }
  }
  scanning = true;
  $('#btn-start-scan').hidden = true;
  $('#btn-stop-scan').hidden = false;
}

async function stopScanner() {
  if (!scanning || !scanner) return;
  try { await scanner.stop(); scanner.clear(); } catch (e) { /* กล้องปิดไปแล้ว */ }
  scanning = false;
  $('#btn-start-scan').hidden = false;
  $('#btn-stop-scan').hidden = true;
}

// หยุดภาพชั่วคราวระหว่างเปิด popup แล้วค่อยสแกนต่อเมื่อปิด
function pauseScanner() { try { if (scanning) scanner.pause(true); } catch (e) {} }
function resumeScanner() { try { if (scanning) scanner.resume(); } catch (e) {} }

// เสียงบี๊บตอนอ่าน QR สำเร็จ
function beep() {
  try {
    beep.ctx = beep.ctx || new (window.AudioContext || window.webkitAudioContext)();
    const o = beep.ctx.createOscillator();
    const g = beep.ctx.createGain();
    o.connect(g); g.connect(beep.ctx.destination);
    o.frequency.value = 1200;
    g.gain.value = 0.15;
    o.start();
    o.stop(beep.ctx.currentTime + 0.15);
  } catch (e) {}
}

let lastScanTime = 0;
function onScanSuccess(decodedText) {
  // กันสแกนซ้ำรัวๆ จากเฟรมติดกัน
  const now = Date.now();
  if (now - lastScanTime < 1200) return;
  lastScanTime = now;

  beep();
  if (navigator.vibrate) navigator.vibrate(120);
  pauseScanner();
  showScanModal(findBySku(decodedText), decodedText);
}

/* ---------- popup ผลการสแกน ---------- */
function showScanModal(p, rawText) {
  const body = $('#scan-modal-body');

  if (p) {
    // ✅ เจอสินค้าในระบบ → เด้งหน้าเพิ่มสต็อกทันที
    const low = p.qty <= LOW_STOCK;
    body.innerHTML = `
      <div class="verify-banner">✅ ระบบตรวจสอบแล้ว</div>
      <h3>📥 เพิ่มสต็อก: ${esc(p.name)}</h3>
      <p class="sku-text">รหัส: ${esc(p.sku)}${p.category ? ' • ' + esc(p.category) : ''}${p.price ? ' • ' + p.price.toLocaleString() + ' บาท' : ''}</p>
      <div class="qty-big ${low ? 'low' : ''}">คงเหลือ ${p.qty.toLocaleString()} ${esc(p.unit)}</div>
      ${low ? '<div style="color:#dc2626;font-size:.85rem;margin-bottom:6px">⚠ สินค้าใกล้หมด</div>' : ''}
      <label style="text-align:left">จำนวนที่ต้องการเพิ่ม/เบิก
        <input type="number" id="scan-qty" min="1" step="1" value="1">
      </label>
      <div class="btn-row center">
        <button class="btn success" style="flex:1" onclick="stockFromScan('${p.id}','in')">✔ เพิ่มสต็อกเข้า</button>
      </div>
      <div class="btn-row center">
        <button class="btn warning" onclick="stockFromScan('${p.id}','out')">📤 เบิกออก</button>
        <button class="btn" onclick="closeScanModal()">📷 สแกนต่อ</button>
      </div>`;
    setTimeout(() => { const q = $('#scan-qty'); if (q) { q.focus(); q.select(); } }, 50);
  } else {
    // ⚠ ยังไม่มีในระบบ → ให้ระบุว่าคืออะไร + จำนวน แล้วบันทึกได้ทันที
    body.innerHTML = `
      <div class="verify-banner warn">✅ ระบบตรวจสอบแล้ว — ยังไม่มีสินค้านี้ในระบบ</div>
      <p class="sku-text" style="word-break:break-all">รหัสที่สแกนได้: <b>${esc(rawText)}</b></p>
      <label style="text-align:left">สินค้านี้คืออะไร? *
        <input type="text" id="scan-new-name" placeholder="เช่น กระดาษ A4 80 แกรม">
      </label>
      <div class="grid2">
        <label style="text-align:left">จำนวน
          <input type="number" id="scan-new-qty" min="0" step="1" value="1">
        </label>
        <label style="text-align:left">หน่วย
          <input type="text" id="scan-new-unit" value="ชิ้น">
        </label>
      </div>
      <div class="btn-row center">
        <button class="btn primary" onclick="saveFromScan(this.dataset.sku)" data-sku="${esc(rawText)}">💾 บันทึกเข้าระบบ</button>
        <button class="btn" onclick="closeScanModal()">📷 สแกนต่อ</button>
      </div>`;
  }

  $('#scan-modal').hidden = false;
  if (!p) setTimeout(() => $('#scan-new-name')?.focus(), 50);
}

window.closeScanModal = () => {
  $('#scan-modal').hidden = true;
  resumeScanner();
};

// เพิ่ม/เบิกสต็อกจาก popup สแกน
window.stockFromScan = (id, type) => {
  const p = products.find(x => x.id === id);
  if (!p) return;
  const n = parseInt($('#scan-qty').value, 10);
  if (!n || n <= 0) { toast('❌ กรุณาใส่จำนวนให้ถูกต้อง'); return; }
  if (type === 'out' && n > p.qty) { toast(`❌ สต็อกมีแค่ ${p.qty} ${p.unit} เบิกเกินไม่ได้`); return; }

  p.qty += (type === 'in' ? n : -n);
  p.updatedAt = new Date().toISOString();
  saveProducts();
  addLog(type, p, n);
  toast(type === 'in' ? `✅ เพิ่มสต็อก ${n} ${p.unit} (เหลือ ${p.qty})` : `✅ เบิกออก ${n} ${p.unit} (เหลือ ${p.qty})`);
  renderSummary();
  renderList();
  showScanModal(p); // รีเฟรชตัวเลขใน popup
};

// บันทึกสินค้าใหม่จาก popup สแกน (ระบุว่าคืออะไร)
window.saveFromScan = (sku) => {
  const name = $('#scan-new-name').value.trim();
  if (!name) { toast('❌ กรุณาระบุชื่อสินค้า'); $('#scan-new-name').focus(); return; }
  const qty = Math.max(0, parseInt($('#scan-new-qty').value, 10) || 0);
  const unit = $('#scan-new-unit').value.trim() || 'ชิ้น';

  const p = {
    id: 'id' + Date.now() + Math.random().toString(36).slice(2, 6),
    sku: String(sku).trim(),
    name, qty, unit,
    category: '', price: 0, note: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  products.push(p);
  saveProducts();
  addLog('create', p, p.qty);
  toast('✅ บันทึกสินค้าใหม่เรียบร้อย');
  renderSummary();
  renderList();
  showScanModal(p); // เปลี่ยน popup เป็นหน้าสินค้าที่เพิ่งบันทึก
};

/* =========================================================
   ประวัติ
   ========================================================= */
const LOG_LABEL = {
  in: ['📥 รับเข้า', 'move-in'],
  out: ['📤 เบิกออก', 'move-out'],
  create: ['🆕 เพิ่มสินค้า', 'move-in'],
  edit: ['✏ แก้ไขข้อมูล', ''],
  delete: ['🗑 ลบสินค้า', 'move-out'],
};

function renderHistory() {
  const box = $('#history-list');
  if (!logs.length) {
    box.innerHTML = '<p class="empty-msg">ยังไม่มีประวัติ</p>';
    return;
  }
  box.innerHTML = logs.map(l => {
    const [label, cls] = LOG_LABEL[l.type] || [l.type, ''];
    const qtyPart = (l.type === 'in' || l.type === 'out' || l.type === 'create')
      ? ` <span class="${cls}">${l.type === 'out' ? '−' : '+'}${l.qty} ${esc(l.unit || '')}</span> (เหลือ ${l.balance})`
      : '';
    return `
      <div class="history-item">
        <div>${label} — <b>${esc(l.name)}</b> (${esc(l.sku)})${qtyPart}</div>
        <div class="time">${fmtTime(l.time)}</div>
      </div>`;
  }).join('');
}

$('#btn-clear-history').addEventListener('click', () => {
  if (!logs.length) return;
  if (!confirm('ล้างประวัติทั้งหมด?')) return;
  logs = [];
  saveLogs();
  renderHistory();
  toast('ล้างประวัติแล้ว');
});

/* =========================================================
   Modal ปิด
   ========================================================= */
document.querySelectorAll('.modal').forEach(m => {
  m.addEventListener('click', e => {
    if (e.target === m || e.target.hasAttribute('data-close')) {
      m.hidden = true;
      if (m.id === 'scan-modal') resumeScanner(); // ปิด popup แล้วสแกนต่อได้เลย
    }
  });
});

// ---------- เริ่มต้น ----------
renderSummary();
renderList();
