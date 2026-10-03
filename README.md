# ตั้งราคา BLISSTECH

เว็บแอปคำนวณราคาขายและกำไรต่อชิ้นบน Shopee · TikTok Shop · Facebook
เปิดใช้ที่ URL ของ Apps Script Web app (ดู `const API_URL` ใน `index.html`) — Google เป็นคนเปิดหน้าเว็บ (ไฟล์ `Index` ในโปรเจกต์ Apps Script)
repo นี้ตั้งเป็น **Private** — ไม่ได้ใช้ GitHub Pages แล้ว

## repo นี้มีอะไร / ไม่มีอะไร

| อยู่ใน repo | ไม่อยู่ใน repo |
|---|---|
| โค้ดหน้าเว็บ (`index.html`) | ข้อมูลสินค้า ต้นทุน ราคาจริง |
| โค้ดฝั่ง Google Apps Script (`apps-script/Code.gs`) | PIN และ API key |
| คู่มือติดตั้ง (`apps-script/README.md`) และคู่มือ API (`API.md`) — ตัวอย่างเป็นข้อมูลสมมติ | ID ของ Google Sheet / โฟลเดอร์รูป |

ข้อมูลจริงอยู่ใน Google Sheet ส่วนตัวของเจ้าของ เข้าถึงได้ผ่าน Apps Script เท่านั้น

## การป้องกัน

- **หน้าเว็บ** ต้องใส่ PIN ทุกครั้งก่อนเห็นข้อมูล — PIN ตรวจที่ Apps Script (เก็บใน Script Properties ไม่อยู่ในโค้ด)
- **แอปอื่น** ใช้ API key แยกต่อแอป สิทธิ์ `read` หรือ `write` ยกเลิกทีละตัวได้ (ดู `API.md`)
- ใส่ PIN หรือ key ผิดซ้ำ ๆ ระบบล็อกชั่วคราว 15 นาที
- URL ของ Apps Script ในโค้ดเปิดเผยได้ — ถ้าไม่มี PIN หรือ key จะไม่ได้ข้อมูลอะไร

พบปัญหาด้านความปลอดภัย กรุณาแจ้งเจ้าของ repo โดยตรง อย่าเปิดเป็น issue สาธารณะ
