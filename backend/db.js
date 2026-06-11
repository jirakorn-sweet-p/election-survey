// db.js
const { Pool } = require('pg');

const pool = new Pool(
  process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }
    : {
        host:     process.env.DB_HOST     || 'localhost',
        port:     parseInt(process.env.DB_PORT) || 5432,
        database: process.env.DB_NAME     || 'election_db',
        user:     process.env.DB_USER     || 'postgres',
        password: process.env.DB_PASSWORD || '',
      }
);

const DDL = `
  -- ตารางหลัก: ข้อมูลกำลังพล
  CREATE TABLE IF NOT EXISTS personnel (
    id                  SERIAL PRIMARY KEY,
    rank                TEXT NOT NULL,
    first_name          TEXT NOT NULL,
    last_name           TEXT NOT NULL,
    -- สิทธิเลือกตั้งของตนเอง
    has_vote_right      BOOLEAN NOT NULL DEFAULT true,
    no_vote_reason      TEXT,
    vote_date           DATE,
    vote_district       TEXT,
    vote_unit           TEXT,
    vote_place          TEXT,
    -- จำนวนผู้มีสิทธิในครอบครัว
    family_voter_count  INTEGER NOT NULL DEFAULT 0,
    created_at          TIMESTAMP DEFAULT NOW(),
    updated_at          TIMESTAMP DEFAULT NOW()
  );

  -- ตารางครอบครัว
  CREATE TABLE IF NOT EXISTS family_members (
    id                  SERIAL PRIMARY KEY,
    personnel_id        INTEGER NOT NULL REFERENCES personnel(id) ON DELETE CASCADE,
    prefix              TEXT NOT NULL,
    first_name          TEXT NOT NULL,
    last_name           TEXT NOT NULL,
    relationship        TEXT NOT NULL,
    -- สิทธิเลือกตั้งของสมาชิก
    has_vote_right      BOOLEAN NOT NULL DEFAULT true,
    no_vote_reason      TEXT,
    vote_date           DATE,
    vote_district       TEXT,
    vote_unit           TEXT,
    vote_place          TEXT
  );

  -- Audit log
  CREATE TABLE IF NOT EXISTS audit_logs (
    id            SERIAL PRIMARY KEY,
    action        TEXT NOT NULL,
    personnel_id  INTEGER,
    personnel_name TEXT,
    changed_by    TEXT NOT NULL DEFAULT 'public',
    detail        TEXT,
    created_at    TIMESTAMP DEFAULT NOW()
  );
`;

async function initDB() {
  await pool.query(DDL);
  console.log('✅  Database ready');
  return pool;
}

module.exports = { initDB };
