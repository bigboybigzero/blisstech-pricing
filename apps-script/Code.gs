/**
 * BLISSTECH Pricing — backend บน Google Sheet
 * วางไฟล์นี้ใน Extensions > Apps Script ของชีตข้อมูล แล้ว Deploy เป็น Web app
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

/* ---------- entry points ---------- */

function book() {
  const id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}

function doGet() {
  return json({ ok: true, app: 'blisstech-pricing' });
}

function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return json({ ok: false, error: 'bad_request' }); }

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
