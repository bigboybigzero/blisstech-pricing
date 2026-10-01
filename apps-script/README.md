# ตั้งค่า Google Sheet + Apps Script (ทำครั้งเดียว)

ข้อมูลสินค้าและต้นทุนอยู่ใน Google Sheet ของเจ้าของเท่านั้น ไม่อยู่ใน repo นี้

## 1. สร้างชีตข้อมูล
1. สร้าง Google Sheet ใหม่ ตั้งชื่อเช่น `BLISSTECH Pricing DB` (อย่าแชร์ลิงก์สาธารณะ)
2. File → Import → Upload → เลือก `data/products-sheet.csv` (อยู่ในเครื่องเท่านั้น)
   - Import location: **Replace current sheet** · Convert text to numbers: เปิด

## 2. ใส่ Apps Script
1. ในชีต: Extensions → Apps Script
   - ถ้าเปิดไม่ได้ (หน้า "ไม่สามารถเปิดไฟล์ได้" — เกิดเมื่อ Chrome ล็อกอิน Google หลายบัญชี)
     ให้สร้างโปรเจกต์แยกที่ script.google.com แทน แล้วเพิ่ม Script Property `SHEET_ID` = ID ของชีต (ส่วนกลางของ URL ชีต)
2. ลบโค้ดเดิม วางเนื้อหา `apps-script/Code.gs` ทั้งไฟล์ แล้วกด Save
3. เลือกฟังก์ชัน `setup` → Run (ครั้งแรกจะขอสิทธิ์ ให้กดอนุญาต)
   - จะเปลี่ยนชื่อแท็บเป็น `products` และสร้างแท็บ `config`
4. ⚙️ Project Settings → Script Properties → Add property
   - Property: `PIN` · Value: PIN ที่ต้องการ (แนะนำ 6 หลักขึ้นไป)

## 3. Deploy เป็น Web app
1. Deploy → New deployment → ⚙️ เลือก **Web app**
2. Execute as: **Me** · Who has access: **Anyone**
3. Deploy → คัดลอก Web app URL (ลงท้าย `/exec`)
4. เปิด `index.html` ใส่ URL ที่บรรทัด `const API_URL="";`

> แก้ `Code.gs` ภายหลัง: Deploy → Manage deployments → ✏️ → Version: New version
> (ถ้ากด New deployment ใหม่ URL จะเปลี่ยน)

## ความปลอดภัย
- URL ของ Web app อยู่ใน repo ได้ — ถ้าไม่มี PIN จะไม่ได้ข้อมูลอะไร
- ใส่ PIN ผิดรวมกันเกิน 10 ครั้งใน 15 นาที ระบบล็อกทุกเครื่อง 15 นาที
- เปลี่ยน PIN: แก้ค่าใน Script Properties ได้ทันที เครื่องที่จำ PIN เก่าจะถูกถามใหม่
- ปุ่ม "ล็อก" มุมบนลบ PIN ที่จำไว้ในเครื่องนั้น
