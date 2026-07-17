/* =========================================================
   ระบบสต็อกสินค้า (สแกน QR / บาร์โค้ด)
   =========================================================
   ภาพรวมการทำงานของแอปนี้:
   1. ข้อมูลสินค้าทั้งหมดเก็บใน localStorage ของเบราว์เซอร์
      (localStorage = ที่เก็บข้อมูลถาวรในเครื่อง ปิดเบราว์เซอร์แล้วข้อมูลไม่หาย)
   2. ใช้ไลบรารี html5-qrcode เปิดกล้องอ่าน QR code / บาร์โค้ด
   3. ใช้ไลบรารี qrcodejs สร้างภาพ QR code สำหรับพิมพ์ไปติดสินค้า
   4. เมื่อสแกนสำเร็จ จะเด้ง popup "ระบบตรวจสอบแล้ว"
      ให้เพิ่มสต็อก/เบิกออก หรือลงทะเบียนสินค้าใหม่ได้ทันที
   ========================================================= */

/* =========================================================
   ส่วนที่ 1 : ค่าคงที่ และการโหลด/บันทึกข้อมูล
   ========================================================= */

// ชื่อ "กุญแจ" ที่ใช้เก็บข้อมูลใน localStorage (เหมือนชื่อไฟล์)
const DB_KEY = 'qr_stock_products'; // เก็บรายการสินค้าทั้งหมด
const LOG_KEY = 'qr_stock_logs';    // เก็บประวัติการรับเข้า/เบิกออก

// ถ้าสินค้าเหลือน้อยกว่าหรือเท่ากับค่านี้ จะขึ้นเตือนสีแดงว่า "ใกล้หมด"
const LOW_STOCK = 5;

// โหลดข้อมูลเก่าจาก localStorage ตอนเปิดหน้าเว็บ
// JSON.parse = แปลงข้อความ JSON กลับเป็น array/object ที่ JavaScript ใช้ได้
// ถ้ายังไม่เคยมีข้อมูล (ค่าเป็น null) ให้ใช้ '[]' คือ array ว่างแทน
let products = JSON.parse(localStorage.getItem(DB_KEY) || '[]');
let logs = JSON.parse(localStorage.getItem(LOG_KEY) || '[]');

// บันทึกข้อมูลลง localStorage
// JSON.stringify = แปลง array/object เป็นข้อความ เพราะ localStorage เก็บได้แต่ข้อความ
function saveProducts() { localStorage.setItem(DB_KEY, JSON.stringify(products)); }
function saveLogs() { localStorage.setItem(LOG_KEY, JSON.stringify(logs)); }

// ค้นหาสินค้าจากรหัส SKU (ตัดช่องว่างหัวท้าย + ไม่สนตัวพิมพ์เล็ก/ใหญ่)
// คืนค่า object สินค้าถ้าเจอ หรือ undefined ถ้าไม่เจอ
function findBySku(sku) {
  return products.find(p => p.sku.toLowerCase() === String(sku).trim().toLowerCase());
}

// บันทึกประวัติการเคลื่อนไหว 1 รายการ (เก็บรายการใหม่สุดไว้บนสุดด้วย unshift)
// type มีได้ 5 แบบ: 'in'=รับเข้า, 'out'=เบิกออก, 'create'=เพิ่มสินค้า,
//                   'edit'=แก้ไขข้อมูล, 'delete'=ลบสินค้า
function addLog(type, product, qty) {
  logs.unshift({
    time: new Date().toISOString(), // เวลาปัจจุบันแบบมาตรฐาน ISO เช่น "2026-07-17T10:30:00Z"
    type,
    sku: product.sku,
    name: product.name,
    qty,                  // จำนวนที่เคลื่อนไหวในครั้งนี้
    balance: product.qty, // ยอดคงเหลือหลังทำรายการ
    unit: product.unit,
  });
  // เก็บแค่ 500 รายการล่าสุดพอ กัน localStorage บวมเกินไป
  if (logs.length > 500) logs.length = 500;
  saveLogs();
}

/* =========================================================
   ส่วนที่ 2 : ฟังก์ชันช่วยเหลือทั่วไป (utility)
   ========================================================= */

// ตัวย่อของ document.querySelector จะได้พิมพ์สั้นๆ เช่น $('#f-name')
const $ = sel => document.querySelector(sel);

// แสดงข้อความแจ้งเตือนเล็กๆ ลอยขึ้นด้านล่างจอ แล้วหายเองใน 2.2 วินาที
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(t._timer); // ถ้ามี toast เก่ากำลังนับถอยหลังอยู่ ให้ยกเลิกก่อน
  t._timer = setTimeout(() => (t.hidden = true), 2200);
}

// ป้องกัน XSS : แปลงอักขระพิเศษของ HTML (< > " ' &) เป็นรหัสปลอดภัย
// จำเป็นเพราะเราเอาข้อความที่ผู้ใช้พิมพ์ (ชื่อสินค้า ฯลฯ) ไปใส่ใน innerHTML
// ถ้าไม่แปลง คนพิมพ์ <script> ลงชื่อสินค้าได้ = อันตราย
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// แปลงเวลา ISO เป็นรูปแบบไทยอ่านง่าย เช่น "17/7/69 14:30"
function fmtTime(iso) {
  return new Date(iso).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' });
}

// สร้างรหัสสินค้าอัตโนมัติ P0001, P0002, ... โดยวนหาเลขแรกที่ยังไม่ถูกใช้
function genSku() {
  let n = 1, sku;
  do { sku = 'P' + String(n).padStart(4, '0'); n++; } while (findBySku(sku));
  return sku;
}

/* =========================================================
   ส่วนที่ 3 : ระบบสลับแท็บ (สแกน / รายการ / เพิ่ม / ประวัติ)
   ========================================================= */

// ผูก event ให้ปุ่มแท็บทุกปุ่ม : กดแล้วเรียก switchTab ตามชื่อใน data-tab
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

function switchTab(tab) {
  // ใส่/ถอด class "active" ให้ปุ่มแท็บ (ปุ่มที่ active จะมีขีดสีน้ำเงินใต้ปุ่ม)
  document.querySelectorAll('.tab-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === tab));
  // แสดงเฉพาะหน้า (section) ของแท็บที่เลือก ที่เหลือซ่อนด้วย CSS
  document.querySelectorAll('.tab-page').forEach(p =>
    p.classList.toggle('active', p.id === 'tab-' + tab));

  if (tab !== 'scan') stopScanner(); // ออกจากแท็บสแกน = ปิดกล้องให้อัตโนมัติ ประหยัดแบต
  if (tab === 'list') renderList();       // เข้าหน้ารายการ = วาดรายการใหม่ให้ข้อมูลสด
  if (tab === 'history') renderHistory(); // เข้าหน้าประวัติ = วาดประวัติใหม่
}

/* =========================================================
   ส่วนที่ 4 : สรุปยอดรวมบนแถบหัวเว็บ
   ========================================================= */

function renderSummary() {
  const totalItems = products.length; // จำนวนชนิดสินค้า
  // reduce = วนบวกจำนวนคงเหลือของทุกสินค้ารวมกัน (เริ่มนับจาก 0)
  const totalQty = products.reduce((s, p) => s + p.qty, 0);
  $('#total-summary').textContent = `สินค้า ${totalItems} รายการ • รวม ${totalQty.toLocaleString()} ชิ้น`;
}

/* =========================================================
   ส่วนที่ 5 : ฟอร์มเพิ่ม / แก้ไขสินค้า
   =========================================================
   ฟอร์มเดียวใช้ 2 หน้าที่:
   - ถ้าช่องซ่อน #f-editing-id "ว่าง"  = โหมดเพิ่มสินค้าใหม่
   - ถ้าช่องซ่อน #f-editing-id "มีค่า" = โหมดแก้ไขสินค้าตัวนั้น
   ========================================================= */

// ปุ่ม "สุ่มรหัส" : เติมรหัส SKU อัตโนมัติให้ในช่อง
$('#btn-gen-sku').addEventListener('click', () => { $('#f-sku').value = genSku(); });

// เมื่อกดปุ่มบันทึก (submit ฟอร์ม)
$('#product-form').addEventListener('submit', e => {
  e.preventDefault(); // กันหน้าเว็บรีโหลด (พฤติกรรมปกติของ form submit)

  const editingId = $('#f-editing-id').value; // มีค่า = กำลังแก้ไข
  const sku = $('#f-sku').value.trim();
  const name = $('#f-name').value.trim();
  if (!sku || !name) return; // กันเหนียว (ปกติ required ใน HTML ดักให้แล้ว)

  // กันรหัสซ้ำ : ถ้ามีสินค้าอื่นใช้ SKU นี้อยู่แล้ว ไม่ให้บันทึก
  const dup = findBySku(sku);
  if (dup && dup.id !== editingId) {
    toast('❌ รหัสสินค้า "' + sku + '" มีอยู่แล้ว');
    return;
  }

  // รวบรวมค่าจากทุกช่องในฟอร์มมาเป็น object เดียว
  const data = {
    sku,
    name,
    qty: Math.max(0, parseInt($('#f-qty').value, 10) || 0), // แปลงเป็นเลขจำนวนเต็ม ห้ามติดลบ
    unit: $('#f-unit').value.trim() || 'ชิ้น',              // ถ้าไม่กรอกใช้ "ชิ้น"
    category: $('#f-category').value.trim(),
    price: parseFloat($('#f-price').value) || 0,
    note: $('#f-note').value.trim(),
  };

  if (editingId) {
    // ----- โหมดแก้ไข : หาสินค้าตัวเดิมแล้วอัปเดตค่าทับ -----
    const p = products.find(x => x.id === editingId);
    Object.assign(p, data, { updatedAt: new Date().toISOString() });
    saveProducts();
    addLog('edit', p, 0);
    toast('✅ แก้ไขสินค้าเรียบร้อย');
    resetForm();
    switchTab('list'); // แก้เสร็จพากลับหน้ารายการ
  } else {
    // ----- โหมดเพิ่มใหม่ : สร้าง object สินค้าพร้อม id ไม่ซ้ำใคร -----
    const p = {
      // id ภายในระบบ สร้างจากเวลาปัจจุบัน + ตัวอักษรสุ่ม แทบเป็นไปไม่ได้ที่จะซ้ำ
      id: 'id' + Date.now() + Math.random().toString(36).slice(2, 6),
      ...data, // กระจายทุกค่าจาก data เข้ามา (spread operator)
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    products.push(p);
    saveProducts();
    addLog('create', p, p.qty);
    toast('✅ เพิ่มสินค้าเรียบร้อย');
    resetForm();
    showQrModal(p); // เพิ่มเสร็จเปิด QR ให้เลย จะได้พิมพ์ไปติดสินค้า
  }
  renderSummary();
  renderList();
});

// ล้างฟอร์มกลับสู่สภาพเริ่มต้น (โหมดเพิ่มสินค้าใหม่)
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

// เริ่มแก้ไขสินค้า : เอาข้อมูลเดิมทั้งหมดไปเติมในฟอร์ม แล้วสลับไปแท็บฟอร์ม
function startEdit(id) {
  const p = products.find(x => x.id === id);
  if (!p) return;
  $('#f-editing-id').value = p.id; // ตัวบอกว่าเป็น "โหมดแก้ไข"
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

// ลบสินค้า (มี confirm ถามยืนยันก่อน กันกดพลาด)
function deleteProduct(id) {
  const p = products.find(x => x.id === id);
  if (!p) return;
  if (!confirm(`ลบสินค้า "${p.name}" (${p.sku}) ?`)) return;
  products = products.filter(x => x.id !== id); // เก็บทุกตัวที่ "ไม่ใช่" ตัวที่จะลบ
  saveProducts();
  addLog('delete', p, 0);
  toast('🗑 ลบสินค้าแล้ว');
  renderSummary();
  renderList();
}

/* =========================================================
   ส่วนที่ 6 : หน้ารายการสินค้า + ช่องค้นหา
   ========================================================= */

// พิมพ์ในช่องค้นหาเมื่อไหร่ วาดรายการใหม่ทันที (กรองแบบ real-time)
$('#search-box').addEventListener('input', renderList);

function renderList() {
  const q = $('#search-box').value.trim().toLowerCase(); // คำค้น (ตัวเล็กทั้งหมด)

  // กรอง: ถ้าไม่มีคำค้นเอาทุกตัว / ถ้ามี เอาตัวที่ชื่อ หรือ SKU หรือหมวดหมู่ มีคำนั้น
  const list = products.filter(p =>
    !q || p.name.toLowerCase().includes(q) ||
    p.sku.toLowerCase().includes(q) ||
    (p.category || '').toLowerCase().includes(q)
  );

  const box = $('#product-list');
  if (!list.length) {
    // ไม่มีอะไรให้แสดง : แยกข้อความ 2 กรณี (ยังไม่มีสินค้าเลย / ค้นหาไม่เจอ)
    box.innerHTML = `<p class="empty-msg">${products.length ? 'ไม่พบสินค้าที่ค้นหา' : 'ยังไม่มีสินค้า — ไปที่แท็บ "เพิ่มสินค้า" เพื่อเริ่มต้น'}</p>`;
    return;
  }

  // สร้าง HTML ของสินค้าทีละตัวด้วย .map แล้วต่อกันเป็นก้อนเดียวด้วย .join
  // ทุกข้อความที่มาจากผู้ใช้ต้องผ่าน esc() เสมอ กันโค้ดแปลกปลอม
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

// เทคนิค "event delegation" : ผูก click ไว้ที่กล่องแม่อันเดียว
// แทนที่จะผูกทีละปุ่ม (ซึ่งจะหลุดทุกครั้งที่วาดรายการใหม่)
// แล้วดูจาก data-act ว่าปุ่มที่ถูกกดคือปุ่มอะไร
$('#product-list').addEventListener('click', e => {
  const btn = e.target.closest('button[data-act]'); // หาปุ่มที่ใกล้จุดที่กดที่สุด
  if (!btn) return; // กดโดนที่ว่างๆ ไม่ใช่ปุ่ม = ไม่ทำอะไร
  const { act, id } = btn.dataset;
  const p = products.find(x => x.id === id);
  if (!p) return;
  if (act === 'qr') showQrModal(p);
  else if (act === 'edit') startEdit(id);
  else if (act === 'del') deleteProduct(id);
  else if (act === 'in' || act === 'out') openMoveModal(p, act);
});

/* =========================================================
   ส่วนที่ 7 : หน้าต่างรับเข้า / เบิกออก (จากหน้ารายการสินค้า)
   ========================================================= */

// จำไว้ว่ากำลังทำรายการกับสินค้าตัวไหน ทิศทางไหน (in/out)
let moveTarget = null;

function openMoveModal(p, type) {
  moveTarget = { product: p, type };
  $('#move-modal-title').textContent = (type === 'in' ? '📥 รับสินค้าเข้า' : '📤 เบิกสินค้าออก');
  $('#move-modal-info').textContent = `${p.name} (${p.sku}) — คงเหลือ ${p.qty} ${p.unit}`;
  $('#move-qty').value = 1;
  $('#move-qty').max = type === 'out' ? p.qty : ''; // เบิกออกได้ไม่เกินที่มี
  $('#move-modal').hidden = false;
  $('#move-qty').focus(); // เอาเคอร์เซอร์ไปรอที่ช่องจำนวนเลย
}

$('#btn-confirm-move').addEventListener('click', () => {
  if (!moveTarget) return;
  const { product: p, type } = moveTarget;
  const n = parseInt($('#move-qty').value, 10);

  // ตรวจความถูกต้องก่อนทำรายการจริง
  if (!n || n <= 0) { toast('❌ กรุณาใส่จำนวนให้ถูกต้อง'); return; }
  if (type === 'out' && n > p.qty) { toast(`❌ สต็อกมีแค่ ${p.qty} ${p.unit} เบิกเกินไม่ได้`); return; }

  p.qty += (type === 'in' ? n : -n); // รับเข้า = บวก, เบิกออก = ลบ
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
   ส่วนที่ 8 : QR Code — สร้าง / ดาวน์โหลด / พิมพ์
   ========================================================= */

let qrModalProduct = null; // สินค้าที่กำลังโชว์ QR อยู่ใน modal

// เปิดหน้าต่างแสดง QR ของสินค้า
function showQrModal(p) {
  qrModalProduct = p;
  $('#qr-modal-name').textContent = p.name;
  $('#qr-modal-sku').textContent = 'รหัสสินค้า: ' + p.sku;
  const box = $('#qr-code-box');
  box.innerHTML = ''; // ล้าง QR อันเก่าทิ้งก่อน (ถ้าเปิดค้างจากสินค้าตัวอื่น)
  // ให้ไลบรารี qrcodejs วาด QR ลงในกล่อง โดยข้อมูลข้างใน QR คือ "รหัส SKU"
  // เวลาสแกน เราจะได้ SKU กลับมา แล้วเอาไปหาสินค้าในระบบ
  new QRCode(box, { text: p.sku, width: 200, height: 200, correctLevel: QRCode.CorrectLevel.M });
  $('#qr-modal').hidden = false;
}

// ดึงภาพ QR ออกมาเป็นข้อมูลรูป (data URL) เพื่อเอาไปดาวน์โหลด/พิมพ์
// qrcodejs จะสร้างทั้ง <img> และ <canvas> แล้วแต่เบราว์เซอร์ เช็คทั้งคู่
function getQrDataUrl() {
  const img = $('#qr-code-box img');
  const canvas = $('#qr-code-box canvas');
  if (img && img.src) return img.src;
  if (canvas) return canvas.toDataURL('image/png');
  return null;
}

// ดาวน์โหลด QR เป็นไฟล์ PNG : สร้างลิงก์ <a download> ชั่วคราวแล้วสั่งกดเอง
$('#btn-download-qr').addEventListener('click', () => {
  const url = getQrDataUrl();
  if (!url || !qrModalProduct) return;
  const a = document.createElement('a');
  a.href = url;
  a.download = `QR_${qrModalProduct.sku}.png`; // ชื่อไฟล์ที่จะได้
  a.click();
});

// พิมพ์ QR : เปิดหน้าต่างใหม่ ใส่ชื่อ+รหัส+ภาพ QR แล้วสั่งพิมพ์อัตโนมัติ
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
   ส่วนที่ 9 : กล้องสแกน QR / บาร์โค้ด
   =========================================================
   ตัวแปรสถานะของกล้อง:
   - scanner  : ตัวอ่านจากไลบรารี html5-qrcode (สร้างครั้งเดียวใช้ตลอด)
   - scanning : true = กล้องกำลังเปิดสแกนอยู่
   - cameras  : รายชื่อกล้องทุกตัวในเครื่อง (มือถือมักมี 2 ตัว หน้า/หลัง)
   - camIndex : ตอนนี้ใช้กล้องตัวที่เท่าไหร่ในรายชื่อ
   - torchOn  : ไฟแฟลชเปิดอยู่ไหม
   ========================================================= */

let scanner = null;
let scanning = false;
let cameras = [];
let camIndex = 0;
let torchOn = false;

// ผูกปุ่มควบคุมกล้องทั้ง 4 ปุ่ม
$('#btn-start-scan').addEventListener('click', startScanner);
$('#btn-stop-scan').addEventListener('click', stopScanner);
$('#btn-switch-cam').addEventListener('click', switchCamera);
$('#btn-torch').addEventListener('click', toggleTorch);

// ค่าตั้งของตัวสแกน:
// fps = อ่านภาพกี่ครั้งต่อวินาที (10 กำลังดี ไม่กินเครื่องเกินไป)
// qrbox = ขนาดพื้นที่ตรงกลางที่ใช้ถอดรหัสจริง (กว้าง 280 สูง 180
//         ทำเป็นแนวนอนเพื่อให้อ่าน "บาร์โค้ด" ที่เป็นแถบยาวๆ ได้ง่าย)
const SCAN_CONFIG = { fps: 10, qrbox: { width: 280, height: 180 } };

// ประเภทรหัสที่รองรับ : QR + บาร์โค้ดยอดนิยมที่ใช้กับสินค้าจริง
const SCAN_FORMATS = [
  Html5QrcodeSupportedFormats.QR_CODE,
  Html5QrcodeSupportedFormats.EAN_13,   // บาร์โค้ดสินค้าไทย/สากล 13 หลัก (เจอบ่อยสุด)
  Html5QrcodeSupportedFormats.EAN_8,    // แบบสั้น 8 หลัก (ของชิ้นเล็ก)
  Html5QrcodeSupportedFormats.UPC_A,    // บาร์โค้ดฝั่งอเมริกา
  Html5QrcodeSupportedFormats.UPC_E,
  Html5QrcodeSupportedFormats.CODE_128, // ใช้ในคลังสินค้า/ขนส่ง
  Html5QrcodeSupportedFormats.CODE_39,
  Html5QrcodeSupportedFormats.ITF,
  Html5QrcodeSupportedFormats.CODABAR,
];

// ---------- เปิดกล้องเริ่มสแกน ----------
async function startScanner() {
  if (scanning) return; // เปิดอยู่แล้วไม่ต้องเปิดซ้ำ

  // สร้างตัวอ่านครั้งแรกครั้งเดียว (ครั้งถัดไปใช้ตัวเดิม)
  scanner = scanner || new Html5Qrcode('qr-reader', {
    formatsToSupport: SCAN_FORMATS,
    // ถ้าเบราว์เซอร์มีตัวอ่านบาร์โค้ดในตัว (BarcodeDetector) ให้ใช้เลย เร็ว+แม่นกว่า
    experimentalFeatures: { useBarCodeDetectorIfSupported: true },
    verbose: false,
  });

  try {
    // ขอรายชื่อกล้องทั้งหมด (ขั้นตอนนี้เบราว์เซอร์จะเด้งขออนุญาตใช้กล้อง)
    cameras = await Html5Qrcode.getCameras();
    if (!cameras || !cameras.length) throw new Error('ไม่พบกล้องในเครื่องนี้');

    // เลือกกล้อง "หลัง" ก่อนถ้าหาเจอ (ดูจากชื่อกล้องว่ามีคำว่า back/rear/หลัง)
    // เพราะการสแกนของใช้กล้องหลังสะดวกที่สุด / ถ้าไม่เจอใช้ตัวแรกไป
    const backIdx = cameras.findIndex(c => /back|rear|environment|หลัง/i.test(c.label || ''));
    camIndex = backIdx >= 0 ? backIdx : 0;

    // สั่งเปิดกล้องตัวที่เลือก แล้วเริ่มอ่านรหัส
    // - เจอรหัสเมื่อไหร่ จะเรียก onScanSuccess ให้เอง
    // - เฟรมที่อ่านไม่เจอ (คนยังเล็งไม่ตรง) ปล่อยผ่าน ไม่ต้องทำอะไร
    await scanner.start(cameras[camIndex].id, SCAN_CONFIG, onScanSuccess, () => {});
  } catch (err) {
    console.error('เปิดกล้องไม่สำเร็จ:', err);
    toast('❌ เปิดกล้องไม่ได้: ' + (err.message || err) + ' — ต้องอนุญาตกล้อง และเปิดผ่าน localhost หรือ https');
    return;
  }

  // เปิดสำเร็จ : ปรับหน้าจอเข้าสู่โหมดสแกน
  scanning = true;
  torchOn = false;
  $('#btn-start-scan').hidden = true;
  $('#btn-stop-scan').hidden = false;
  $('#scan-frame').hidden = false;                    // โชว์กรอบเล็งเป้า
  $('#btn-switch-cam').hidden = cameras.length < 2;   // มีกล้องเดียว = ไม่ต้องมีปุ่มสลับ
  $('#btn-torch').hidden = false;
  $('#btn-torch').textContent = '🔦 เปิดแฟลช';
}

// ---------- ปิดกล้อง ----------
async function stopScanner() {
  if (!scanning || !scanner) return;
  try {
    await scanner.stop();  // หยุดกล้อง (ไฟแฟลชจะดับตามอัตโนมัติ)
    scanner.clear();       // ล้างภาพค้างในกล่องวิดีโอ
  } catch (e) { /* กล้องปิดไปก่อนแล้ว ไม่เป็นไร */ }

  // คืนหน้าจอกลับสภาพเดิม : ซ่อนปุ่มที่ใช้ได้เฉพาะตอนกล้องเปิด
  scanning = false;
  torchOn = false;
  $('#btn-start-scan').hidden = false;
  $('#btn-stop-scan').hidden = true;
  $('#btn-switch-cam').hidden = true;
  $('#btn-torch').hidden = true;
  $('#scan-frame').hidden = true;
}

// ---------- สลับกล้อง (หน้า <-> หลัง) ----------
async function switchCamera() {
  if (!scanning || cameras.length < 2) return;

  // วนไปกล้องตัวถัดไป : % (หารเอาเศษ) ทำให้พอถึงตัวสุดท้ายแล้ววนกลับตัวแรก
  camIndex = (camIndex + 1) % cameras.length;
  torchOn = false; // เปลี่ยนกล้อง = แฟลชดับ รีเซ็ตสถานะปุ่มด้วย
  $('#btn-torch').textContent = '🔦 เปิดแฟลช';

  try {
    await scanner.stop(); // ต้องหยุดกล้องตัวเดิมก่อน ถึงจะเปิดตัวใหม่ได้
    await scanner.start(cameras[camIndex].id, SCAN_CONFIG, onScanSuccess, () => {});
    // บอกผู้ใช้ว่าสลับไปตัวไหนแล้ว (บางเครื่องชื่อกล้องว่าง เลยมีชื่อสำรองให้)
    toast('🔄 ' + (cameras[camIndex].label || ('กล้องตัวที่ ' + (camIndex + 1))));
  } catch (err) {
    console.error('สลับกล้องไม่สำเร็จ:', err);
    toast('❌ สลับกล้องไม่สำเร็จ');
    // เปิดตัวใหม่ไม่ขึ้น = ตอนนี้ไม่มีกล้องทำงานอยู่เลย รีเซ็ตหน้าจอกลับ
    scanning = false;
    stopScanner();
  }
}

// ---------- เปิด/ปิดไฟแฟลช (torch) ----------
// หมายเหตุ: ใช้ได้เฉพาะกล้องที่มีไฟแฟลชจริงๆ (ปกติคือกล้องหลังของมือถือ)
// กล้องหน้า/เว็บแคมคอมพิวเตอร์ไม่มีแฟลช จะขึ้นข้อความบอกแทน
async function toggleTorch() {
  if (!scanning || !scanner) return;
  try {
    // ถามความสามารถของกล้องที่กำลังใช้อยู่ ว่ารองรับ torch ไหม
    const caps = scanner.getRunningTrackCapabilities();
    if (!caps || !caps.torch) {
      toast('❌ กล้องตัวนี้ไม่มีไฟแฟลช');
      return;
    }
    // สั่งเปิด/ปิดแฟลชผ่าน video constraints
    torchOn = !torchOn;
    await scanner.applyVideoConstraints({ advanced: [{ torch: torchOn }] });
    $('#btn-torch').textContent = torchOn ? '🔦 ปิดแฟลช' : '🔦 เปิดแฟลช';
    toast(torchOn ? '🔦 เปิดแฟลชแล้ว' : '🔦 ปิดแฟลชแล้ว');
  } catch (err) {
    console.error('สั่งแฟลชไม่สำเร็จ:', err);
    torchOn = false;
    $('#btn-torch').textContent = '🔦 เปิดแฟลช';
    toast('❌ เปิดแฟลชไม่สำเร็จ');
  }
}

// ---------- พัก/สแกนต่อ ----------
// ระหว่าง popup ผลสแกนเปิดอยู่ เรา "พัก" กล้อง (ภาพค้าง) กันมันอ่านซ้ำรัวๆ
// พอปิด popup ค่อยสั่งสแกนต่อ
function pauseScanner() { try { if (scanning) scanner.pause(true); } catch (e) {} }
function resumeScanner() { try { if (scanning) scanner.resume(); } catch (e) {} }

// ---------- เสียง "บี๊บ" ตอนอ่านสำเร็จ ----------
// ใช้ Web Audio API สร้างเสียงสั้นๆ เอง ไม่ต้องมีไฟล์เสียง
function beep() {
  try {
    // สร้าง AudioContext ครั้งแรกครั้งเดียวแล้วเก็บไว้ใช้ซ้ำ
    beep.ctx = beep.ctx || new (window.AudioContext || window.webkitAudioContext)();
    const o = beep.ctx.createOscillator(); // ตัวกำเนิดคลื่นเสียง
    const g = beep.ctx.createGain();       // ตัวคุมความดัง
    o.connect(g); g.connect(beep.ctx.destination);
    o.frequency.value = 1200; // ความถี่สูงหน่อย ให้เสียงแหลมแบบเครื่องคิดเงิน
    g.gain.value = 0.15;      // เบาๆ พอได้ยิน
    o.start();
    o.stop(beep.ctx.currentTime + 0.15); // ดังแค่ 0.15 วินาที
  } catch (e) { /* บางเครื่องไม่ให้เล่นเสียง ก็ข้ามไป */ }
}

// ---------- เมื่ออ่านรหัสสำเร็จ ----------
let lastScanTime = 0; // เวลาที่อ่านสำเร็จครั้งล่าสุด (ใช้กันอ่านซ้ำ)

function onScanSuccess(decodedText) {
  // กล้องอ่านได้ ~10 เฟรม/วินาที ถ้าไม่กันไว้ รหัสเดียวจะเด้งซ้ำหลายสิบครั้ง
  // จึงรับการอ่านใหม่เฉพาะเมื่อห่างจากครั้งก่อนเกิน 1.2 วินาที
  const now = Date.now();
  if (now - lastScanTime < 1200) return;
  lastScanTime = now;

  beep();                                    // ส่งเสียงยืนยัน
  if (navigator.vibrate) navigator.vibrate(120); // มือถือสั่นเบาๆ ด้วย (ถ้ารองรับ)
  pauseScanner();                            // พักกล้องระหว่าง popup เปิด

  // decodedText = ข้อความที่อ่านได้จาก QR/บาร์โค้ด (ก็คือรหัส SKU)
  // เอาไปหาว่าตรงกับสินค้าตัวไหน แล้วเปิด popup ผลลัพธ์
  showScanModal(findBySku(decodedText), decodedText);
}

/* =========================================================
   ส่วนที่ 10 : popup ผลการสแกน ("ระบบตรวจสอบแล้ว")
   =========================================================
   มี 2 หน้าตา ขึ้นกับว่ารหัสที่สแกนมีในระบบไหม:
   - เจอสินค้า     -> หน้าเพิ่มสต็อก (ใส่จำนวน กดเพิ่ม/เบิกได้เลย)
   - ไม่เจอสินค้า  -> ฟอร์มสั้นๆ ให้ระบุว่าสินค้านี้คืออะไร แล้วบันทึกเข้าระบบ
   ========================================================= */

function showScanModal(p, rawText) {
  const body = $('#scan-modal-body');

  if (p) {
    // ----- ✅ เจอสินค้าในระบบ : เด้งหน้าเพิ่มสต็อกทันที -----
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
    // รอให้ popup วาดเสร็จก่อน แล้วโฟกัส+เลือกตัวเลขในช่องจำนวนให้เลย
    // ผู้ใช้พิมพ์เลขใหม่ทับได้ทันทีไม่ต้องลบเอง
    setTimeout(() => { const q = $('#scan-qty'); if (q) { q.focus(); q.select(); } }, 50);
  } else {
    // ----- ⚠ ไม่เจอในระบบ : ให้ระบุว่าสินค้านี้คืออะไร -----
    // รหัสที่สแกนได้ (เช่นบาร์โค้ดจากโรงงาน) จะถูกใช้เป็น SKU ให้อัตโนมัติ
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
    setTimeout(() => $('#scan-new-name')?.focus(), 50);
  }

  $('#scan-modal').hidden = false;
}

// ปิด popup แล้วปลุกกล้องให้สแกนต่อทันที
// (ประกาศแบบ window.xxx เพราะถูกเรียกจาก onclick ที่เขียนใน HTML string)
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
  showScanModal(p); // วาด popup ใหม่ ให้ตัวเลขคงเหลืออัปเดตทันตา
};

// บันทึกสินค้าใหม่จาก popup สแกน (กรณีสแกนเจอรหัสที่ยังไม่มีในระบบ)
window.saveFromScan = (sku) => {
  const name = $('#scan-new-name').value.trim();
  if (!name) { toast('❌ กรุณาระบุชื่อสินค้า'); $('#scan-new-name').focus(); return; }
  const qty = Math.max(0, parseInt($('#scan-new-qty').value, 10) || 0);
  const unit = $('#scan-new-unit').value.trim() || 'ชิ้น';

  const p = {
    id: 'id' + Date.now() + Math.random().toString(36).slice(2, 6),
    sku: String(sku).trim(), // รหัสที่สแกนได้ กลายเป็น SKU ของสินค้าตัวนี้
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
  showScanModal(p); // เปลี่ยน popup เป็นหน้าเพิ่มสต็อกของสินค้าที่เพิ่งบันทึก
};

/* =========================================================
   ส่วนที่ 11 : หน้าประวัติการเคลื่อนไหว
   ========================================================= */

// ตารางแปลง type ของ log -> [ข้อความที่แสดง, ชื่อ class สี]
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
    // แสดงจำนวน +/- เฉพาะรายการที่ตัวเลขเปลี่ยน (รับเข้า/เบิกออก/เพิ่มสินค้า)
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
   ส่วนที่ 12 : กติกากลางของ modal ทุกตัว
   =========================================================
   กดปุ่ม ✕ (มี data-close) หรือกดฉากหลังมืดๆ = ปิด modal
   ถ้าเป็น popup สแกน ปิดแล้วต้องปลุกกล้องสแกนต่อด้วย
   ========================================================= */

document.querySelectorAll('.modal').forEach(m => {
  m.addEventListener('click', e => {
    // e.target === m หมายถึงกดโดนฉากหลังโดยตรง (ไม่ใช่กล่องเนื้อหาข้างใน)
    if (e.target === m || e.target.hasAttribute('data-close')) {
      m.hidden = true;
      if (m.id === 'scan-modal') resumeScanner();
    }
  });
});

/* =========================================================
   ส่วนที่ 13 : เริ่มต้นเมื่อเปิดหน้าเว็บ
   ========================================================= */

renderSummary(); // โชว์ยอดรวมบนหัวเว็บ
renderList();    // วาดรายการสินค้ารอไว้เลย
