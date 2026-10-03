/**
 * BLISSTECH Pricing — backend บน Google Sheet
 * วางไฟล์นี้ใน Extensions > Apps Script ของชีตข้อมูล แล้ว Deploy เป็น Web app
 * หน้าเว็บ: เพิ่มไฟล์ HTML ชื่อ "Index" ในโปรเจกต์ แล้ววางเนื้อหา index.html — เปิด URL ของ Web app ก็คือหน้าเว็บ
 * (Execute as: Me · Who has access: Anyone) ดูขั้นตอนใน apps-script/README.md
 *
 * PIN เก็บใน Project Settings > Script Properties ชื่อ PIN (ไม่อยู่ในโค้ด)
 * ถ้าเป็นโปรเจกต์แยก (ไม่ได้เปิดจากเมนูของชีต) ให้เพิ่ม Script Property SHEET_ID = ID ของชีตข้อมูล
 * ทุก request เป็น POST body JSON: {pin, action, ...}
 *   load                      → {products:[...], config:{fees:{...}}}
 *   add    {id, data}         → เพิ่มสินค้า
 *   update {id, patch}        → แก้เฉพาะฟิลด์ที่ส่งมา
 *   delete {id}
 *   setConfig {key, data}     → เขียน config (เช่น fees)
 *   uploadImage {id, mime, data(base64)} → เก็บรูปใน Drive แล้วใส่ file id ในคอลัมน์ image
 *   removeImage {id}
 *
 * รูปสินค้าอยู่ในโฟลเดอร์ Drive "BLISSTECH Pricing รูปสินค้า" (แชร์แบบมีลิงก์ดูได้ เพื่อให้แอปแสดงรูป)
 * ID โฟลเดอร์เก็บใน Script Property IMAGE_FOLDER_ID (สร้างให้อัตโนมัติ)
 *
 * API สำหรับแอปอื่น (ดู API.md): ใช้ API key แทน PIN — key เก็บใน Script Property ชื่อ APIKEY_<ชื่อ> = "<read|write>:<secret>"
 * สร้าง key: รัน newReadApiKey() หรือ newWriteApiKey() ใน editor แล้วดู key ในบันทึกการดำเนินการ · ยกเลิก: ลบ property นั้น
 */

const PRODUCTS = 'products';
const CONFIG = 'config';
const HEADERS = ['id', 'name', 'cost', 'box',
  'price_shopee', 'price_tiktok', 'price_facebook',
  'ads_shopee', 'ads_tiktok', 'ads_facebook',
  'order', 'source', 'createdAt', 'updatedAt', 'image'];
const TEXT_COLS = ['id', 'name', 'source', 'createdAt', 'updatedAt', 'image'];
const PLATS = ['shopee', 'tiktok', 'facebook'];
const MAX_FAILS = 10;          // PIN ผิดเกินนี้ภายใน 15 นาที → ล็อกชั่วคราว
const FAIL_WINDOW_SEC = 15 * 60;
const IMAGE_FOLDER = 'BLISSTECH Pricing รูปสินค้า';
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_IMAGE_B64 = 7 * 1024 * 1024;
const API_VERSION = 1;
const API_MAX_FAILS = 20;      // API key ผิดเกินนี้ภายใน 15 นาที → ล็อก API ชั่วคราว (ไม่กระทบ PIN)

/** ค่าธรรมเนียมตั้งต้น — ต้องตรงกับ DEFAULT_FEES ใน index.html · setup() เขียนลงแท็บ config ถ้ายังไม่มี */
const DEFAULT_FEES = {
  shopee: [
    { id: 'vat', label: 'VAT 7%', type: 'pct', v: 7, on: true },
    { id: 'ccb', label: 'CCB/FS', type: 'pct', v: 7.5, on: true },
    { id: 'sell', label: 'ค่าธรรมเนียมการขาย', type: 'pct', v: 19.26, on: true },
    { id: 'pay', label: 'ค่าธรรมเนียมการชำระเงิน', type: 'pct', v: 3.21, on: true },
    { id: 'flash', label: 'Flash Sale', type: 'pct', v: 3.21, on: true },
    { id: 'aff', label: 'Affiliate', type: 'pct', v: 15, on: true },
    { id: 'ads', label: 'ADS (ACOS)', type: 'pct', v: 0, on: true }],
  tiktok: [
    { id: 'vat', label: 'VAT 7%', type: 'pct', v: 7, on: true },
    { id: 'grow', label: 'ค่าธรรมเนียมเติบโตของร้าน', type: 'pct', v: 8.03, on: true },
    { id: 'cbd', label: 'CBD/FS (เข้าแคมเปญ)', type: 'pct', v: 3.21, on: true },
    { id: 'mall', label: 'ค่าคอมมิชชั่น Mall', type: 'pct', v: 13.91, on: true },
    { id: 'order', label: 'ค่าธรรมเนียมคำสั่งซื้อ', type: 'pct', v: 3.21, on: true },
    { id: 'infra', label: 'ค่าธรรมเนียมโครงสร้างพื้นฐาน', type: 'baht', v: 1.07, on: true },
    { id: 'coupon', label: 'ค่าบริการคูปอง Extra', type: 'pct', v: 1, on: true },
    { id: 'live', label: 'Live Special (โค้ดผ่านไลฟ์)', type: 'pct', v: 4.28, on: true },
    { id: 'aff', label: 'Affiliate', type: 'pct', v: 5, on: true },
    { id: 'ads', label: 'ADS (ACOS)', type: 'pct', v: 15, on: true }],
  facebook: [
    { id: 'vat', label: 'VAT 7%', type: 'pct', v: 7, on: true },
    { id: 'cod', label: 'ค่า COD', type: 'pct', v: 4, on: true },
    { id: 'ship', label: 'ค่าส่ง/ออเดอร์', type: 'baht', v: 15, on: true },
    { id: 'ads', label: 'ค่าแอดออเดอร์แรก', type: 'pct', v: 25, on: true }]
};

/* ---------- entry points ---------- */

function book() {
  const id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}

/** เปิด URL เฉยๆ = หน้าเว็บแอป (ไฟล์ Index.html ในโปรเจกต์นี้) · มี ?action= = API */
function doGet(e) {
  const q = (e && e.parameter) || {};
  if (q.action === 'ping') return json({ ok: true, app: 'blisstech-pricing', apiVersion: API_VERSION });
  if (!q.key && !q.action) {
    return HtmlService.createHtmlOutputFromFile('Index')
      .setTitle('ตั้งราคา BLISSTECH')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
  }
  return handleApi(q.key, q.action, q, 'GET');
}

function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return json({ ok: false, error: 'bad_request' }); }
  if (req && 'apiKey' in req) return handleApi(req.apiKey, req.action, req, 'POST');

  const auth = checkPin(req.pin);
  if (auth) return json({ ok: false, error: auth });

  try {
    switch (req.action) {
      case 'load': return json({ ok: true, products: readProducts(), config: readConfig() });
      case 'add': return withLock(() => json({ ok: true, id: addProduct(req.id, req.data) }));
      case 'update': return withLock(() => { updateProduct(req.id, req.patch); return json({ ok: true }); });
      case 'delete': return withLock(() => { deleteProduct(req.id); return json({ ok: true }); });
      case 'setConfig': return withLock(() => { writeConfig(req.key, req.data); return json({ ok: true }); });
      case 'uploadImage': return withLock(() => json({ ok: true, image: uploadImage(req.id, req.mime, req.data) }));
      case 'removeImage': return withLock(() => { setImage(req.id, ''); return json({ ok: true }); });
      default: return json({ ok: false, error: 'bad_action' });
    }
  } catch (err) {
    return json({ ok: false, error: err.code || 'server_error', message: String(err.message || err) });
  }
}

/** รันครั้งเดียวจาก editor: สร้างแท็บ/หัวคอลัมน์ที่ขาด และตั้งคอลัมน์ข้อความเป็น plain text */
function setup() {
  const ss = book();
  let sh = ss.getSheetByName(PRODUCTS);
  if (!sh) {
    sh = ss.getSheets().length === 1 ? ss.getSheets()[0] : ss.insertSheet();
    sh.setName(PRODUCTS);
  }
  if (sh.getLastRow() === 0) sh.appendRow(HEADERS);
  const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  HEADERS.filter(h => head.indexOf(h) < 0).forEach(h => { sh.getRange(1, sh.getLastColumn() + 1).setValue(h); head.push(h); });
  TEXT_COLS.forEach(h => sh.getRange(1, head.indexOf(h) + 1, sh.getMaxRows(), 1).setNumberFormat('@'));
  sh.setFrozenRows(1);

  let cf = ss.getSheetByName(CONFIG);
  if (!cf) { cf = ss.insertSheet(CONFIG); cf.appendRow(['key', 'value']); }
  if (!readConfig().fees) writeConfig('fees', DEFAULT_FEES);
  imageFolder();

  if (!PropertiesService.getScriptProperties().getProperty('PIN')) {
    Logger.log('ยังไม่ได้ตั้ง PIN: ไปที่ Project Settings > Script Properties แล้วเพิ่ม PIN');
  }
  Logger.log('setup เสร็จ: ' + (sh.getLastRow() - 1) + ' สินค้า');
}

/* ---------- auth ---------- */

function checkPin(pin) {
  const real = PropertiesService.getScriptProperties().getProperty('PIN');
  if (!real) return 'no_pin_configured';
  const cache = CacheService.getScriptCache();
  const fails = +(cache.get('fails') || 0);
  if (fails >= MAX_FAILS) return 'locked';
  if (String(pin || '') !== real) {
    cache.put('fails', String(fails + 1), FAIL_WINDOW_SEC);
    return 'bad_pin';
  }
  return null;
}

/* ---------- products ---------- */

function productSheet() {
  const sh = book().getSheetByName(PRODUCTS);
  if (!sh) throw err('no_sheet', 'ไม่พบแท็บ products — รัน setup() ก่อน');
  return sh;
}

function headerOf(sh) {
  return sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
}

function readProducts() {
  const sh = productSheet();
  if (sh.getLastRow() < 2) return [];
  const head = headerOf(sh);
  return sh.getRange(2, 1, sh.getLastRow() - 1, head.length).getValues()
    .filter(r => String(r[head.indexOf('id')]).trim())
    .map(r => rowToProduct(head, r));
}

function rowToProduct(head, r) {
  const v = h => { const i = head.indexOf(h); return i < 0 ? '' : r[i]; };
  const n = h => { const x = v(h); return x === '' || x === null || !isFinite(+x) ? null : +x; };
  const s = h => { const x = v(h); return x instanceof Date ? x.toISOString() : String(x); };
  const p = {
    id: s('id').trim(), name: s('name'),
    cost: n('cost') ?? 0, box: n('box') ?? 5,
    ref: {}, ads: {}, order: n('order')
  };
  PLATS.forEach(k => { p.ref[k] = n('price_' + k); p.ads[k] = n('ads_' + k); });
  ['source', 'createdAt', 'updatedAt', 'image'].forEach(h => { if (s(h)) p[h] = s(h); });
  return p;
}

/** แปลง patch แบบแอพ ({ref:{shopee:..}, ads:{..}}) เป็น {คอลัมน์: ค่า} */
function flatten(patch) {
  const out = {};
  Object.keys(patch || {}).forEach(k => {
    const val = patch[k];
    if (k === 'ref' || k === 'ads') {
      const pre = k === 'ref' ? 'price_' : 'ads_';
      PLATS.forEach(pl => { if (val && pl in val) out[pre + pl] = val[pl]; });
    } else if (HEADERS.indexOf(k) >= 0 && k !== 'id' && k !== 'image') {  // รูปเปลี่ยนผ่าน uploadImage/removeImage เท่านั้น
      out[k] = val;
    }
  });
  Object.keys(out).forEach(k => { if (out[k] === null || out[k] === undefined) out[k] = ''; });
  return out;
}

function findRow(sh, head, id) {
  if (sh.getLastRow() < 2) return -1;
  const col = head.indexOf('id') + 1;
  const ids = sh.getRange(2, col, sh.getLastRow() - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) if (String(ids[i][0]).trim() === id) return i + 2;
  return -1;
}

function validId(id) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(id)) throw err('invalid_argument', 'bad id');
  return id;
}

function addProduct(id, data) {
  validId(id);
  const sh = productSheet(), head = headerOf(sh);
  if (findRow(sh, head, id) > 0) throw err('already_exists', id);
  const flat = flatten(data);
  sh.appendRow(head.map(h => h === 'id' ? id : (h in flat ? flat[h] : '')));
  return id;
}

function updateProduct(id, patch) {
  validId(id);
  const sh = productSheet(), head = headerOf(sh);
  const row = findRow(sh, head, id);
  if (row < 0) throw err('invalid_argument', 'not found');
  const flat = flatten(patch);
  const range = sh.getRange(row, 1, 1, head.length);
  const vals = range.getValues()[0];
  head.forEach((h, i) => { if (h in flat) vals[i] = flat[h]; });
  range.setValues([vals]);
}

function deleteProduct(id) {
  validId(id);
  const sh = productSheet(), head = headerOf(sh);
  const row = findRow(sh, head, id);
  if (row < 0) return;
  const col = head.indexOf('image');
  const old = col < 0 ? '' : String(sh.getRange(row, col + 1).getValue());
  sh.deleteRow(row);
  trashImage(old);
}

/* ---------- images ---------- */

function imageFolder() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('IMAGE_FOLDER_ID');
  if (id) {
    try { const f = DriveApp.getFolderById(id); if (!f.isTrashed()) return f; } catch (e) { /* ถูกลบไปแล้ว สร้างใหม่ */ }
  }
  const f = DriveApp.createFolder(IMAGE_FOLDER);
  props.setProperty('IMAGE_FOLDER_ID', f.getId());
  return f;
}

function uploadImage(id, mime, data) {
  validId(id);
  if (IMAGE_TYPES.indexOf(mime) < 0) throw err('invalid_argument', 'bad image type');
  if (typeof data !== 'string' || !data || data.length > MAX_IMAGE_B64) throw err('invalid_argument', 'bad image size');
  const sh = productSheet(), head = ensureColumn(sh, 'image');
  if (findRow(sh, head, id) < 0) throw err('invalid_argument', 'not found');
  const name = id + '.' + mime.split('/')[1].replace('jpeg', 'jpg');
  const file = imageFolder().createFile(Utilities.newBlob(Utilities.base64Decode(data), mime, name));
  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (e) {
    file.setTrashed(true);
    throw err('sharing_blocked', 'บัญชีนี้แชร์ไฟล์แบบมีลิงก์ไม่ได้');
  }
  try { setImage(id, file.getId()); } catch (e) { file.setTrashed(true); throw e; }
  return file.getId();
}

/** เปลี่ยนรูปของสินค้า ('' = ลบรูป) แล้วย้ายรูปเก่าไปถังขยะ Drive (กู้คืนได้ 30 วัน) */
function setImage(id, fileId) {
  validId(id);
  const sh = productSheet(), head = ensureColumn(sh, 'image');
  const row = findRow(sh, head, id);
  if (row < 0) throw err('invalid_argument', 'not found');
  const cell = sh.getRange(row, head.indexOf('image') + 1);
  const old = String(cell.getValue());
  cell.setValue(fileId);
  const up = head.indexOf('updatedAt');
  if (up >= 0) sh.getRange(row, up + 1).setValue(new Date().toISOString());
  if (old && old !== fileId) trashImage(old);
}

function trashImage(fileId) {
  if (!fileId) return;
  try { DriveApp.getFileById(fileId).setTrashed(true); } catch (e) { /* ไม่มีไฟล์แล้ว */ }
}

function ensureColumn(sh, name) {
  const head = headerOf(sh);
  if (head.indexOf(name) < 0) {
    const col = head.length + 1;
    sh.getRange(1, col).setValue(name);
    sh.getRange(1, col, sh.getMaxRows(), 1).setNumberFormat('@');
    head.push(name);
  }
  return head;
}

/* ---------- API สำหรับแอปอื่น (v1) ---------- */

function newReadApiKey() { return createApiKey_('read'); }
function newWriteApiKey() { return createApiKey_('write'); }

function createApiKey_(scope) {
  const secret = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  const name = 'APIKEY_' + scope + '_' + Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyyMMdd_HHmmss');
  PropertiesService.getScriptProperties().setProperty(name, scope + ':' + secret);
  Logger.log('สร้าง API key ' + name + ' (' + scope + ')\nkey: ' + secret + '\nเก็บ key นี้ไว้ในแอปที่จะเชื่อมต่อ · ยกเลิกได้โดยลบ property ' + name);
  return name;
}

function checkApiKey(key) {
  const cache = CacheService.getScriptCache();
  const fails = +(cache.get('apifails') || 0);
  if (fails >= API_MAX_FAILS) return { error: 'locked' };
  if (typeof key === 'string' && key.length >= 32) {
    const props = PropertiesService.getScriptProperties().getProperties();
    for (const name in props) {
      if (name.indexOf('APIKEY_') !== 0) continue;
      const v = String(props[name]), i = v.indexOf(':');
      if (i > 0 && v.slice(i + 1) === key) return { name: name.slice(7), scope: v.slice(0, i) };
    }
  }
  cache.put('apifails', String(fails + 1), FAIL_WINDOW_SEC);
  return { error: 'bad_key' };
}

const API_READ = {
  products: () => { const fees = currentFees(); return readProducts().map(p => apiProduct(p, fees)); },
  product: a => {
    const p = readProducts().filter(x => x.id === String(a.id || ''))[0];
    if (!p) throw err('not_found', 'ไม่พบสินค้า ' + a.id);
    return apiProduct(p, currentFees());
  },
  fees: () => currentFees(),
  quote: a => apiQuote(a)
};
const API_WRITE = {
  addProduct: a => {
    const d = apiInput(a);
    if (!d.name) throw err('invalid_argument', 'ต้องมี name');
    if (d.cost === undefined) throw err('invalid_argument', 'ต้องมี cost');
    const all = readProducts();
    if (all.some(p => p.name.trim().toLowerCase() === d.name.toLowerCase())) throw err('already_exists', 'มีสินค้าชื่อนี้อยู่แล้ว');
    const id = 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const order = all.reduce((m, p) => Math.max(m, p.order || 0), 0) + 1;
    addProduct(id, Object.assign({ box: 5, order: order, createdAt: new Date().toISOString() }, d));
    return API_READ.product({ id: id });
  },
  updateProduct: a => {
    validId(String(a.id || ''));
    updateProduct(a.id, Object.assign(apiInput(a), { updatedAt: new Date().toISOString() }));
    return API_READ.product({ id: a.id });
  }
};

function handleApi(key, action, args, method) {
  const who = checkApiKey(key);
  if (who.error) return json({ ok: false, apiVersion: API_VERSION, error: who.error });
  try {
    if (API_READ[action]) return json({ ok: true, apiVersion: API_VERSION, data: API_READ[action](args) });
    if (API_WRITE[action]) {
      if (who.scope !== 'write') return json({ ok: false, apiVersion: API_VERSION, error: 'forbidden', message: 'key นี้อ่านได้อย่างเดียว' });
      if (method !== 'POST') return json({ ok: false, apiVersion: API_VERSION, error: 'use_post' });
      return withLock(() => json({ ok: true, apiVersion: API_VERSION, data: API_WRITE[action](args) }));
    }
    return json({ ok: false, apiVersion: API_VERSION, error: 'bad_action', actions: Object.keys(API_READ).concat(Object.keys(API_WRITE)) });
  } catch (e) {
    return json({ ok: false, apiVersion: API_VERSION, error: e.code || 'server_error', message: String(e.message || e) });
  }
}

/** รับข้อมูลสินค้าจากแอปอื่น: {name, cost, box, prices:{shopee,..}, ads:{..}} → patch แบบเดียวกับที่หน้าเว็บส่ง */
function apiInput(a) {
  const num = v => (v === null || v === '' ? null : (isFinite(+v) ? +v : undefined));
  const out = {};
  if (a.name !== undefined) out.name = String(a.name).trim();
  ['cost', 'box'].forEach(k => {
    if (a[k] === undefined) return;
    const v = num(a[k]);
    if (v === undefined || v === null) throw err('invalid_argument', k + ' ต้องเป็นตัวเลข');
    out[k] = v;
  });
  [['prices', 'ref'], ['ads', 'ads']].forEach(([from, to]) => {
    if (!a[from] || typeof a[from] !== 'object') return;
    out[to] = {};
    PLATS.forEach(pl => {
      if (!(pl in a[from])) return;
      const v = num(a[from][pl]);
      if (v === undefined) throw err('invalid_argument', from + '.' + pl + ' ต้องเป็นตัวเลขหรือ null');
      out[to][pl] = v;
    });
  });
  return out;
}

function currentFees() {
  const f = readConfig().fees || {}, out = {};
  PLATS.forEach(k => { out[k] = Array.isArray(f[k]) ? f[k] : DEFAULT_FEES[k]; });
  return out;
}

function imageUrl(fileId, w) {
  return fileId ? 'https://lh3.googleusercontent.com/d/' + fileId + (w ? '=w' + w : '') : null;
}

function apiProduct(p, fees) {
  const profit = {};
  PLATS.forEach(k => {
    const price = p.ref[k];
    profit[k] = price ? summarize(priceCalc(fees, k, price, p.cost, p.box, 0, p.ads[k], null)) : null;
  });
  return {
    id: p.id, name: p.name, cost: p.cost, box: p.box,
    prices: p.ref, ads: p.ads, profit: profit,
    image: p.image ? { id: p.image, url: imageUrl(p.image), thumbUrl: imageUrl(p.image, 400) } : null,
    order: p.order, source: p.source || null, createdAt: p.createdAt || null, updatedAt: p.updatedAt || null
  };
}

function summarize(c) {
  return { price: c.price, fee: c.fee, profit: c.profit, margin: c.margin };
}

/** ใช้ค่าแอดเฉพาะสินค้าแทนรายการ id "ads" (เหมือน feesFor ใน index.html) */
function feesWithAds(fees, k, ads) {
  const items = fees[k] || [];
  if (ads === null || ads === undefined || ads === '' || !isFinite(+ads)) return items;
  let found = false;
  const out = items.map(f => {
    if (f.id !== 'ads') return f;
    found = true;
    return Object.assign({}, f, { v: +ads, on: true });
  });
  if (!found) out.push({ id: 'ads', label: 'ค่าแอด', type: 'pct', v: +ads, on: true });
  return out;
}

/** สูตรเดียวกับ calcPlat ใน index.html */
function priceCalc(fees, k, price, cost, box, gift, ads, targetPct) {
  let pct = 0, fixed = 0, fee = 0;
  const lines = feesWithAds(fees, k, ads).map(f => {
    const amt = f.type === 'pct' ? price * f.v / 100 : +f.v;
    if (f.on) { fee += amt; if (f.type === 'pct') pct += f.v / 100; else fixed += +f.v; }
    return { id: f.id, label: f.label, type: f.type, rate: +f.v, on: !!f.on, amount: r2(amt) };
  });
  const base = cost + box + gift + fixed;
  const profit = price - cost - box - gift - fee;
  const den = targetPct === null ? null : 1 - pct - targetPct / 100;
  return {
    platform: k, price: price, cost: cost, box: box, gift: gift,
    fee: r2(fee), profit: r2(profit), margin: price > 0 ? r4(profit / price) : null,
    minPrice: den === null ? undefined : (den > 0 ? Math.ceil(base / den) : null),
    breakEven: 1 - pct > 0 ? Math.ceil(base / (1 - pct)) : null,
    lines: lines
  };
}

/** quote: {platform, price?, id? | cost, box?, gift?, ads?, target?} — ไม่ส่ง price แต่ส่ง id = ใช้ราคาที่บันทึกไว้ */
function apiQuote(a) {
  const k = String(a.platform || '');
  if (PLATS.indexOf(k) < 0) throw err('invalid_argument', 'platform ต้องเป็น ' + PLATS.join('/'));
  const num = v => (v === undefined || v === null || v === '' ? undefined : +v);
  let cost = num(a.cost), box = num(a.box), ads = num(a.ads), price = num(a.price);
  if (a.id) {
    const p = readProducts().filter(x => x.id === String(a.id))[0];
    if (!p) throw err('not_found', 'ไม่พบสินค้า ' + a.id);
    if (cost === undefined) cost = p.cost;
    if (box === undefined) box = p.box;
    if (ads === undefined) ads = p.ads[k];
    if (price === undefined) price = p.ref[k];
  }
  if (box === undefined) box = 5;
  const gift = num(a.gift) ?? 0, target = num(a.target) ?? 20;
  [['cost', cost], ['box', box], ['price', price], ['gift', gift], ['target', target], ['ads', ads ?? 0]].forEach(([name, v]) => {
    if (v === undefined || v === null || !isFinite(v)) throw err('invalid_argument', name + ' ต้องเป็นตัวเลข');
  });
  const out = priceCalc(currentFees(), k, price, cost, box, gift, ads, target);
  out.target = target;
  return out;
}

function r2(x) { return Math.round(x * 100) / 100; }
function r4(x) { return Math.round(x * 10000) / 10000; }

/* ---------- config ---------- */

function configSheet() {
  const ss = book();
  let cf = ss.getSheetByName(CONFIG);
  if (!cf) { cf = ss.insertSheet(CONFIG); cf.appendRow(['key', 'value']); }
  return cf;
}

function readConfig() {
  const cf = configSheet(), out = {};
  if (cf.getLastRow() < 2) return out;
  cf.getRange(2, 1, cf.getLastRow() - 1, 2).getValues().forEach(([k, v]) => {
    if (!k) return;
    try { out[k] = JSON.parse(v); } catch (e) { /* ข้ามค่าที่ไม่ใช่ JSON */ }
  });
  return out;
}

function writeConfig(key, data) {
  if (typeof key !== 'string' || !/^[a-z]{1,20}$/.test(key)) throw err('invalid_argument', 'bad key');
  const cf = configSheet();
  const text = JSON.stringify(data);
  const n = cf.getLastRow();
  const keys = n >= 2 ? cf.getRange(2, 1, n - 1, 1).getValues() : [];
  for (let i = 0; i < keys.length; i++) {
    if (keys[i][0] === key) { cf.getRange(i + 2, 2).setValue(text); return; }
  }
  cf.appendRow([key, text]);
}

/* ---------- helpers ---------- */

function withLock(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function err(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
