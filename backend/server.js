require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const bodyParser = require('body-parser');
const path       = require('path');
const crypto     = require('crypto');
const { initDB } = require('./db');

const app  = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, '../frontend/public')));

// ── Auth ─────────────────────────────────────────────────────────────────────
const sessions = new Map();
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin1234';

function createToken(user) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { user, exp: Date.now() + 8 * 60 * 60 * 1000 });
  return token;
}

function authMiddleware(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  const s = sessions.get(token);
  if (!s || Date.now() > s.exp) return res.status(401).json({ success: false, error: 'กรุณาเข้าสู่ระบบก่อน' });
  req.user = s.user;
  next();
}

function validate(body) {
  const validRanks = ['ส.ต.','ส.ท.','ส.อ.','จ.ส.ต.','จ.ส.ท.','จ.ส.อ.','ร.ต.','ร.ท.','ร.อ.'];
  if (!validRanks.includes(body.rank))          return 'ยศไม่ถูกต้อง';
  if (!body.first_name?.trim())                  return 'กรุณาระบุชื่อ';
  if (!body.last_name?.trim())                   return 'กรุณาระบุนามสกุล';
  return null;
}

initDB().then(pool => {

  // ── Auth ──────────────────────────────────────────────────────────────────
  app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body;
    if (username === ADMIN_USER && password === ADMIN_PASS) {
      return res.json({ success: true, token: createToken(username), username });
    }
    res.status(401).json({ success: false, error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
  });

  app.post('/api/auth/logout', (req, res) => {
    sessions.delete((req.headers.authorization||'').replace('Bearer ',''));
    res.json({ success: true });
  });

  app.get('/api/auth/me', authMiddleware, (req, res) => res.json({ success: true, username: req.user }));

  // ── Survey: GET all ───────────────────────────────────────────────────────
  app.get('/api/surveys', authMiddleware, async (req, res) => {
    try {
      const { search = '', sort = 'created_at', order = 'desc' } = req.query;
      const validSorts = { rank:'rank', name:'first_name', created:'created_at' };
      const sortCol = validSorts[sort] || 'created_at';
      const { rows } = await pool.query(`
        SELECT p.*,
          (SELECT COUNT(*) FROM family_members WHERE personnel_id=p.id)::int AS family_count,
          (SELECT COUNT(*) FROM family_members WHERE personnel_id=p.id AND has_vote_right=true)::int AS family_voter_count_actual
        FROM personnel p
        WHERE p.first_name ILIKE $1 OR p.last_name ILIKE $1 OR p.rank ILIKE $1
        ORDER BY ${sortCol} ${order==='asc'?'ASC':'DESC'}
      `, [`%${search}%`]);
      res.json({ success: true, data: rows });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
  });

  // ── Survey: GET stats ─────────────────────────────────────────────────────
  app.get('/api/surveys/stats', authMiddleware, async (req, res) => {
    try {
      const { rows: [s] } = await pool.query(`
        SELECT
          COUNT(*)::int AS total_personnel,
          COUNT(*) FILTER (WHERE has_vote_right=true)::int AS personnel_with_right,
          COUNT(*) FILTER (WHERE has_vote_right=false)::int AS personnel_no_right,
          COALESCE(SUM(family_voter_count),0)::int AS total_family_voters
        FROM personnel
      `);
      const { rows: [fm] } = await pool.query(`
        SELECT
          COUNT(*)::int AS total_family,
          COUNT(*) FILTER (WHERE has_vote_right=true)::int AS family_with_right,
          COUNT(*) FILTER (WHERE has_vote_right=false)::int AS family_no_right
        FROM family_members
      `);
      res.json({ success: true, data: { ...s, ...fm } });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
  });

  // ── Survey: GET export ────────────────────────────────────────────────────
  app.get('/api/surveys/export', authMiddleware, async (req, res) => {
    try {
      const { rows } = await pool.query(`
        SELECT p.*, array_agg(
          json_build_object(
            'prefix',fm.prefix,'first_name',fm.first_name,'last_name',fm.last_name,
            'relationship',fm.relationship,'has_vote_right',fm.has_vote_right,
            'no_vote_reason',fm.no_vote_reason,'vote_date',fm.vote_date,
            'vote_district',fm.vote_district,'vote_unit',fm.vote_unit,'vote_place',fm.vote_place
          )
        ) FILTER (WHERE fm.id IS NOT NULL) AS members
        FROM personnel p
        LEFT JOIN family_members fm ON fm.personnel_id=p.id
        GROUP BY p.id ORDER BY p.created_at DESC
      `);
      res.json({ success: true, data: rows });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
  });

  // ── Survey: GET one ───────────────────────────────────────────────────────
  app.get('/api/surveys/:id', authMiddleware, async (req, res) => {
    try {
      const { rows: [p] } = await pool.query('SELECT * FROM personnel WHERE id=$1', [req.params.id]);
      if (!p) return res.status(404).json({ success: false, error: 'ไม่พบข้อมูล' });
      const { rows: members } = await pool.query('SELECT * FROM family_members WHERE personnel_id=$1 ORDER BY id', [p.id]);
      res.json({ success: true, data: { ...p, members } });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
  });

  // ── Survey: POST ──────────────────────────────────────────────────────────
  app.post('/api/surveys', async (req, res) => {
    const err = validate(req.body);
    if (err) return res.status(400).json({ success: false, error: err });

    const {
      rank, first_name, last_name,
      has_vote_right = true, no_vote_reason = null,
      vote_date = null, vote_district = null, vote_unit = null, vote_place = null,
      family_voter_count = 0, members = []
    } = req.body;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: [{ id }] } = await client.query(`
        INSERT INTO personnel
          (rank,first_name,last_name,has_vote_right,no_vote_reason,vote_date,vote_district,vote_unit,vote_place,family_voter_count)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [rank,first_name.trim(),last_name.trim(),has_vote_right,no_vote_reason||null,
         vote_date||null,vote_district||null,vote_unit||null,vote_place||null,family_voter_count]
      );
      for (const m of members) {
        await client.query(`
          INSERT INTO family_members
            (personnel_id,prefix,first_name,last_name,relationship,has_vote_right,no_vote_reason,vote_date,vote_district,vote_unit,vote_place)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [id,m.prefix,m.first_name.trim(),m.last_name.trim(),m.relationship,
           m.has_vote_right??true,m.no_vote_reason||null,m.vote_date||null,
           m.vote_district||null,m.vote_unit||null,m.vote_place||null]
        );
      }
      await client.query('COMMIT');
      await pool.query(
        `INSERT INTO audit_logs (action,personnel_id,personnel_name,changed_by,detail) VALUES ($1,$2,$3,$4,$5)`,
        ['CREATE',id,`${rank} ${first_name.trim()} ${last_name.trim()}`,'public','บันทึกข้อมูลใหม่']
      );
      res.status(201).json({ success: true, id, message: 'บันทึกข้อมูลเรียบร้อยแล้ว' });
    } catch (err) {
      await client.query('ROLLBACK');
      res.status(500).json({ success: false, error: err.message });
    } finally { client.release(); }
  });

  // ── Survey: PUT ───────────────────────────────────────────────────────────
  app.put('/api/surveys/:id', authMiddleware, async (req, res) => {
    const err = validate(req.body);
    if (err) return res.status(400).json({ success: false, error: err });

    const {
      rank, first_name, last_name,
      has_vote_right = true, no_vote_reason = null,
      vote_date = null, vote_district = null, vote_unit = null, vote_place = null,
      family_voter_count = 0, members = []
    } = req.body;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows:[ex] } = await client.query('SELECT id FROM personnel WHERE id=$1',[req.params.id]);
      if (!ex) { await client.query('ROLLBACK'); return res.status(404).json({success:false,error:'ไม่พบข้อมูล'}); }
      await client.query(`
        UPDATE personnel SET rank=$1,first_name=$2,last_name=$3,has_vote_right=$4,no_vote_reason=$5,
          vote_date=$6,vote_district=$7,vote_unit=$8,vote_place=$9,family_voter_count=$10,updated_at=NOW()
        WHERE id=$11`,
        [rank,first_name.trim(),last_name.trim(),has_vote_right,no_vote_reason||null,
         vote_date||null,vote_district||null,vote_unit||null,vote_place||null,family_voter_count,req.params.id]
      );
      await client.query('DELETE FROM family_members WHERE personnel_id=$1',[req.params.id]);
      for (const m of members) {
        await client.query(`
          INSERT INTO family_members
            (personnel_id,prefix,first_name,last_name,relationship,has_vote_right,no_vote_reason,vote_date,vote_district,vote_unit,vote_place)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [req.params.id,m.prefix,m.first_name.trim(),m.last_name.trim(),m.relationship,
           m.has_vote_right??true,m.no_vote_reason||null,m.vote_date||null,
           m.vote_district||null,m.vote_unit||null,m.vote_place||null]
        );
      }
      await client.query('COMMIT');
      await pool.query(
        `INSERT INTO audit_logs (action,personnel_id,personnel_name,changed_by,detail) VALUES ($1,$2,$3,$4,$5)`,
        ['UPDATE',req.params.id,`${rank} ${first_name.trim()} ${last_name.trim()}`,req.user,'แก้ไขข้อมูล']
      );
      res.json({ success: true, message: 'อัปเดตข้อมูลเรียบร้อยแล้ว' });
    } catch (err) {
      await client.query('ROLLBACK');
      res.status(500).json({ success: false, error: err.message });
    } finally { client.release(); }
  });

  // ── Survey: DELETE ────────────────────────────────────────────────────────
  app.delete('/api/surveys/:id', authMiddleware, async (req, res) => {
    try {
      const { rows:[p] } = await pool.query('SELECT * FROM personnel WHERE id=$1',[req.params.id]);
      if (!p) return res.status(404).json({ success: false, error: 'ไม่พบข้อมูล' });
      await pool.query('DELETE FROM personnel WHERE id=$1',[req.params.id]);
      await pool.query(
        `INSERT INTO audit_logs (action,personnel_id,personnel_name,changed_by,detail) VALUES ($1,$2,$3,$4,$5)`,
        ['DELETE',req.params.id,`${p.rank} ${p.first_name} ${p.last_name}`,req.user,'ลบข้อมูล']
      );
      res.json({ success: true, message: 'ลบข้อมูลเรียบร้อยแล้ว' });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
  });

  // ── Audit logs ────────────────────────────────────────────────────────────
  app.get('/api/audit-logs', authMiddleware, async (req, res) => {
    try {
      const { rows } = await pool.query('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 200');
      res.json({ success: true, data: rows });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
  });

  // ── Serve pages ───────────────────────────────────────────────────────────
  app.get('/survey', (req, res) => res.sendFile(path.join(__dirname,'../frontend/public/survey.html')));
  app.get('*', (req, res) => res.sendFile(path.join(__dirname,'../frontend/public/index.html')));

  app.listen(PORT, () => console.log(`✅  Server → http://localhost:${PORT}`));

}).catch(err => { console.error('❌', err); process.exit(1); });
