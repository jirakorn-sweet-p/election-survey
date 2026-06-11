# ระบบสำรวจสิทธิเลือกตั้ง

## โครงสร้างโปรเจค
```
election-survey/
├── backend/
│   ├── server.js        ← Express REST API
│   ├── db.js            ← PostgreSQL schema
│   ├── package.json
│   └── .env             ← สร้างจาก .env.example
└── frontend/
    └── public/
        ├── index.html   ← Admin panel (ต้อง login)
        └── survey.html  ← แบบสำรวจ (ไม่ต้อง login)
```

## วิธีติดตั้ง

```bash
cd election-survey/backend
npm install
cp .env.example .env
# แก้ไข .env ใส่ค่าที่ถูกต้อง
npm start
```

เปิดเบราว์เซอร์:
- แบบสำรวจ: http://localhost:3001/survey
- Admin: http://localhost:3001

## URL สำคัญ

| URL | หน้า | Login |
|-----|------|-------|
| `/survey` | กรอกแบบสำรวจ | ❌ ไม่ต้อง |
| `/` | Admin dashboard | ✅ ต้อง |

## Default Admin
- Username: `admin`
- Password: `admin1234`
(เปลี่ยนใน .env)

## Database Schema

### ตาราง `personnel`
| คอลัมน์ | ประเภท | คำอธิบาย |
|---------|--------|----------|
| id | SERIAL PK | รหัสอัตโนมัติ |
| rank | TEXT | ยศ |
| first_name | TEXT | ชื่อ |
| last_name | TEXT | นามสกุล |
| has_vote_right | BOOLEAN | มีสิทธิเลือกตั้ง |
| no_vote_reason | TEXT | เหตุผลที่ไม่มีสิทธิ |
| vote_date | DATE | วันที่เลือกตั้ง |
| vote_district | TEXT | เขตเลือกตั้ง |
| vote_unit | TEXT | หน่วยเลือกตั้ง |
| vote_place | TEXT | สถานที่เลือกตั้ง |
| family_voter_count | INTEGER | จำนวนสมาชิกในครอบครัวที่มีสิทธิ |

### ตาราง `family_members`
| คอลัมน์ | ประเภท | คำอธิบาย |
|---------|--------|----------|
| id | SERIAL PK | รหัสอัตโนมัติ |
| personnel_id | INTEGER FK | อ้างอิง personnel |
| prefix | TEXT | คำนำหน้าชื่อ |
| first_name | TEXT | ชื่อ |
| last_name | TEXT | นามสกุล |
| relationship | TEXT | ความสัมพันธ์กับเจ้าของ |
| has_vote_right | BOOLEAN | มีสิทธิเลือกตั้ง |
| no_vote_reason | TEXT | เหตุผลที่ไม่มีสิทธิ |
| vote_date | DATE | วันที่เลือกตั้ง |
| vote_district | TEXT | เขตเลือกตั้ง |
| vote_unit | TEXT | หน่วยเลือกตั้ง |
| vote_place | TEXT | สถานที่เลือกตั้ง |

## API Endpoints

| Method | URL | คำอธิบาย |
|--------|-----|----------|
| POST | /api/auth/login | เข้าสู่ระบบ |
| GET | /api/surveys | รายการทั้งหมด (protected) |
| GET | /api/surveys/stats | สถิติ (protected) |
| GET | /api/surveys/export | Export JSON (protected) |
| GET | /api/surveys/:id | ดูรายละเอียด (protected) |
| POST | /api/surveys | เพิ่มข้อมูล (public) |
| PUT | /api/surveys/:id | แก้ไข (protected) |
| DELETE | /api/surveys/:id | ลบ (protected) |
| GET | /api/audit-logs | ประวัติการแก้ไข (protected) |
