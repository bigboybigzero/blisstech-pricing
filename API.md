# BLISSTECH Pricing API (v1)

ให้แอปอื่นดึงข้อมูลสินค้า ต้นทุน ราคา รูป และกำไร จากแอปตั้งราคา BLISSTECH
ข้อมูลมาจาก Google Sheet ชุดเดียวกับหน้าเว็บ — แก้ที่ไหนก็เห็นตรงกันทุกที่

```
Base URL: https://script.google.com/macros/s/AKfycbzuUnnJSuuEYYeFskyn-KdiD0LuG72k-oMwj_ipTf7vryn9obD_YQ8K0rbGgaLN7TmH/exec
```

## 1. ขอ API key (ครั้งเดียวต่อแอป)

แอปอื่นใช้ **API key** ไม่ใช้ PIN ของคน — แต่ละแอปมี key ของตัวเอง ยกเลิกทีละตัวได้

1. เปิดโปรเจกต์ Apps Script "BLISSTECH Pricing API"
2. เลือกฟังก์ชัน `newReadApiKey` (อ่านอย่างเดียว) หรือ `newWriteApiKey` (อ่าน + แก้/เพิ่มสินค้า) → กด **เรียกใช้**
3. ดู key ในบันทึกการดำเนินการ แล้วเก็บไว้ในแอปปลายทาง (เช่น ตัวแปร environment) — **อย่าใส่ key ในโค้ดที่ขึ้น GitHub สาธารณะ**
4. ยกเลิก key: ⚙️ การตั้งค่าโครงการ → พร็อพเพอร์ตี้ของสคริปต์ → ลบแถว `APIKEY_…` ของ key นั้น

| scope | ทำได้ |
|---|---|
| `read` | `products` `product` `fees` `quote` |
| `write` | ทุกอย่างของ read + `addProduct` `updateProduct` (ลบสินค้าไม่ได้) |

ใส่ key ผิดรวมกันเกิน 20 ครั้งใน 15 นาที → API ล็อก 15 นาที (หน้าเว็บที่ใช้ PIN ยังใช้ได้ตามปกติ)

## 2. วิธีเรียก

**POST** (แนะนำ) — body เป็น JSON, ไม่ต้องใส่ header พิเศษ, ต้องตาม redirect

```js
const res = await fetch(BASE_URL, {
  method: "POST",
  body: JSON.stringify({ apiKey: KEY, action: "products" })
});
const json = await res.json();   // { ok: true, apiVersion: 1, data: [...] }
```

**GET** — ใช้ได้เฉพาะคำสั่งอ่าน (สะดวกกับเครื่องมือ no-code) · URL ที่มี key ถือเป็นความลับ อย่าแชร์

```
BASE_URL?key=KEY&action=products
BASE_URL?key=KEY&action=quote&id=x001&platform=shopee&price=790
```

```bash
curl -sL -H 'Content-Type: text/plain' --data '{"apiKey":"KEY","action":"fees"}' "$BASE_URL"
```

> curl: ใช้ `--data` อย่างเดียว ห้ามใส่ `-X POST` (Google redirect แล้ว curl จะ POST ซ้ำผิดที่)

เช็กว่า API ทำงาน: `BASE_URL?action=ping` (ไม่ต้องใช้ key) · เปิด `BASE_URL` เฉยๆ ในเบราว์เซอร์ = หน้าเว็บแอป

ทุกคำตอบมี `ok` และ `apiVersion` · ผิดพลาดจะได้ `{ ok: false, error: "<code>", message?: "..." }`

| error | ความหมาย |
|---|---|
| `bad_key` | key ผิด/ถูกยกเลิก |
| `locked` | ใส่ key ผิดบ่อยเกิน รอ 15 นาที |
| `forbidden` | key แบบ read เรียกคำสั่งเขียน |
| `use_post` | คำสั่งเขียนต้องใช้ POST |
| `bad_action` | ไม่มีคำสั่งนี้ (คำตอบมี `actions` บอกรายการที่ใช้ได้) |
| `not_found` | ไม่พบสินค้า id นี้ |
| `invalid_argument` | ข้อมูลที่ส่งมาไม่ถูกต้อง (ดู `message`) |
| `already_exists` | ชื่อสินค้าซ้ำ |

## 3. คำสั่ง

> ตัวอย่างทั้งหมดในคู่มือนี้เป็นข้อมูลสมมติ ตัวเลขคิดจากค่าธรรมเนียมตั้งต้น

### `products` — สินค้าทั้งหมด
### `product` `{ id }` — สินค้าตัวเดียว

```json
{
  "id": "x001",
  "name": "สินค้าตัวอย่าง A",
  "cost": 200,
  "box": 5,
  "prices": { "shopee": 790, "tiktok": 690, "facebook": 690 },
  "ads":    { "shopee": null, "tiktok": null, "facebook": null },
  "profit": {
    "shopee":   { "price": 790, "fee": 435.92, "profit": 149.08, "margin": 0.1887 },
    "tiktok":   { "price": 690, "fee": 419.49, "profit": 65.51,  "margin": 0.0949 },
    "facebook": { "price": 690, "fee": 263.4,  "profit": 221.6,  "margin": 0.3212 }
  },
  "image": { "id": "<drive file id>", "url": "https://lh3.googleusercontent.com/d/…", "thumbUrl": "…=w400" },
  "order": 1,
  "source": null,
  "createdAt": "2026-01-01T00:00:00.000Z",
  "updatedAt": "2026-01-01T00:00:00.000Z"
}
```

- `prices.<แพลต>` = ราคาขายที่บันทึกไว้ (`null` = ยังไม่ตั้ง → `profit.<แพลต>` เป็น `null`)
- `ads.<แพลต>` = % ค่าแอดเฉพาะสินค้า (`null` = ใช้ค่ากลางจาก `fees`)
- `profit` คิดจากราคาที่บันทึก ด้วยสูตรเดียวกับหน้าเว็บ · `margin` เป็นสัดส่วน (0.1887 = 18.87%)
- `image` เป็น `null` ถ้ายังไม่มีรูป · `source` ว่าง = เพิ่มใหม่หลังย้ายจากชีตเดิม

### `fees` — ค่าธรรมเนียมแต่ละแพลต

```json
{ "shopee": [ { "id": "vat", "label": "VAT 7%", "type": "pct", "v": 7, "on": true }, … ], "tiktok": [ … ], "facebook": [ … ] }
```

`type`: `pct` = % ของราคาขาย, `baht` = บาทต่อออเดอร์ · `on: false` = ไม่คิด

### `quote` — คำนวณกำไร/ราคาขั้นต่ำ

| พารามิเตอร์ | | |
|---|---|---|
| `platform` | ต้องมี | `shopee` / `tiktok` / `facebook` |
| `id` | หรือ `cost` | ใช้ต้นทุน/ค่ากล่อง/ค่าแอด/ราคาที่บันทึกของสินค้านี้ (ส่งค่าอื่นมาทับได้) |
| `price` | | ราคาขายที่จะลอง (ไม่ส่ง + มี `id` = ใช้ราคาที่บันทึก) |
| `cost` `box` | | ต้นทุน/ค่ากล่อง (box ตั้งต้น 5) |
| `gift` | | ของแถม/ต้นทุนเพิ่ม (ตั้งต้น 0) |
| `ads` | | % ค่าแอด (ไม่ส่ง = ของสินค้า หรือค่ากลาง) |
| `target` | | เป้ากำไร % สำหรับ `minPrice` (ตั้งต้น 20) |

```json
{
  "platform": "shopee", "price": 790, "cost": 200, "box": 5, "gift": 0, "target": 20,
  "fee": 435.92, "profit": 149.08, "margin": 0.1887,
  "minPrice": 826, "breakEven": 458,
  "lines": [ { "id": "vat", "label": "VAT 7%", "type": "pct", "rate": 7, "on": true, "amount": 55.3 }, … ]
}
```

`minPrice` = ราคาต่ำสุดที่ได้กำไรตาม `target` (`null` = ทำไม่ได้) · `breakEven` = ราคาเท่าทุน (ปัดขึ้นเป็นบาทเหมือนหน้าเว็บ)

### `updateProduct` `{ id, name?, cost?, box?, prices?, ads? }` — ต้องใช้ key แบบ write

ส่งเฉพาะที่จะแก้ · `prices`/`ads` ส่งบางแพลตได้ เช่น `{ "prices": { "shopee": 1790 } }` · ใส่ `null` = ล้างค่า
คืนสินค้าหลังแก้ (รูปแบบเดียวกับ `product`)

### `addProduct` `{ name, cost, box?, prices?, ads? }` — ต้องใช้ key แบบ write

ชื่อซ้ำ (ไม่สนตัวพิมพ์เล็กใหญ่) จะได้ `already_exists` · คืนสินค้าที่สร้าง (id ขึ้นต้นด้วย `a`)
รูปสินค้ายังเพิ่มผ่าน API ไม่ได้ — ใส่ในหน้าเว็บ

## 4. สูตร (ตรงกับหน้าเว็บและชีต "ตั้งราคาขาย Mall")

```
ค่าธรรมเนียม = Σ(ราคาขาย × % ของรายการที่เปิด) + Σ(รายการแบบบาท)
กำไรสุทธิ    = ราคาขาย − ต้นทุน − ค่ากล่อง − ของแถม − ค่าธรรมเนียม
margin       = กำไรสุทธิ / ราคาขาย
ราคาขั้นต่ำ   = ⌈(ต้นทุน + ค่ากล่อง + ของแถม + ค่าคงที่บาท) / (1 − Σ% − เป้า%)⌉
ราคาเท่าทุน   = ⌈(ต้นทุน + ค่ากล่อง + ของแถม + ค่าคงที่บาท) / (1 − Σ%)⌉
```

ค่าแอดเฉพาะสินค้า (`ads.<แพลต>`) แทนรายการ id `ads` ของแพลตนั้น

## 5. ตัวอย่างใช้งานจริง

**Google Sheet อีกไฟล์ (Apps Script)** — ดึงราคาไปทำรายงาน

```js
function pullPrices() {
  const KEY = PropertiesService.getScriptProperties().getProperty('BLISSTECH_KEY');
  const res = UrlFetchApp.fetch(BASE_URL, { method: 'post', payload: JSON.stringify({ apiKey: KEY, action: 'products' }) });
  const rows = JSON.parse(res.getContentText()).data
    .map(p => [p.id, p.name, p.cost, p.prices.shopee, p.profit.shopee && p.profit.shopee.margin]);
  SpreadsheetApp.getActiveSheet().getRange(2, 1, rows.length, 5).setValues(rows);
}
```

**Python**

```python
import requests, os
r = requests.post(BASE_URL, data='{"apiKey":"%s","action":"products"}' % os.environ["BLISSTECH_KEY"])
products = r.json()["data"]
```

## 6. สำหรับคนแก้โค้ด

- โค้ด API อยู่ใน `apps-script/Code.gs` ส่วน "API สำหรับแอปอื่น (v1)"
- สูตรใน `priceCalc()` ต้องตรงกับ `calcPlat()`/`quick()` ใน `index.html` — แก้ที่หนึ่งต้องแก้อีกที่
- เปลี่ยนรูปแบบคำตอบแบบไม่เข้ากันของเดิม → เพิ่มเป็น v2 (`API_VERSION`) อย่าแก้ v1 ทับ
- แก้ Code.gs แล้ว: Deploy → จัดการการทำให้ใช้งานได้ → ✏️ → เวอร์ชันใหม่ (URL เดิม)
