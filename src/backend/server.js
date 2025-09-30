// server.js
const path = require('path');
// Ensure local .env overrides any existing environment variables for predictable dev behavior
require('dotenv').config({ path: path.resolve(__dirname, '.env'), override: true });

const express = require('express');
const sql = require('mssql');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const axios = require('axios');
const http = require('http');
const https = require('https');
const rateLimit = require('express-rate-limit');
const nodemailer = require('nodemailer');

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Keep-alive agents to reduce connection overhead and timeouts
axios.defaults.httpAgent = new http.Agent({ keepAlive: true });
axios.defaults.httpsAgent = new https.Agent({ keepAlive: true });

/* =========================
   DEBUG: log ทุก request (เปิดด้วย .env LOG_REQUESTS=on)
   ========================= */
const LOG_REQUESTS = String(process.env.LOG_REQUESTS || 'off').toLowerCase() === 'on';
if (LOG_REQUESTS) {
  app.use((req, _res, next) => {
    console.log(`[REQ] ${req.method} ${req.url}`);
    next();
  });
}

/* =========================
   DB CONFIG (ปรับใน .env ได้)
   ========================= */
const config = {
  user: process.env.DB_USER || "sa",
  password: process.env.DB_PASSWORD || "bank12018",
  server: process.env.DB_SERVER || "localhost",
  database: process.env.DB_NAME || "Fitme",
  options: { trustServerCertificate: true, enableArithAbort: true, encrypt: true },
  port: Number(process.env.DB_PORT || 1433),
  pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
};

const poolPromise = new sql.ConnectionPool(config)
  .connect()
  .then(pool => { console.log('Connected to MSSQL'); return pool; })
  .catch(err => { console.error('Database Connection Failed!', err); process.exit(1); });

/* =========================
   Helpers
   ========================= */
const isValidEmail = (e) => /^\S+@\S+\.\S+$/.test(e);
const parseYMD = (s) => {
  if (typeof s !== 'string') return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const [_, yy, mm, dd] = m;
  const d = new Date(Number(yy), Number(mm) - 1, Number(dd), 0, 0, 0, 0);
  return isNaN(d.getTime()) ? null : d;
};
const looksHashed = (s) =>
  typeof s === 'string' && (s.startsWith('$2a$') || s.startsWith('$2b$') || s.startsWith('$2y$'));

// yyyy-MM-dd string
const ymd = (d) => {
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
};

const normalizeGender = (val) => {
  if (val == null) return null;
  let m = String(val).trim().toLowerCase();
  m = m.replace(/[♂️♀︎]/g, '').trim();
  const map = new Map([
    ['male', 'male'], ['m', 'male'], ['man', 'male'], ['boy', 'male'],
    ['ชาย', 'male'], ['ผู้ชาย', 'male'],
    ['female', 'female'], ['f', 'female'], ['woman', 'female'], ['girl', 'female'],
    ['หญิง', 'female'], ['ผู้หญิง', 'female'],
  ]);
  if (map.has(m)) return map.get(m);
  if (m.startsWith('ชาย')) return 'male';
  if (m.startsWith('หญิง')) return 'female';
  return null;
};

// ปกปิดบางส่วนของอีเมลเพื่อความปลอดภัย เช่น ab***@do***.com
const maskEmail = (email) => {
  try {
    if (!isValidEmail(email)) return '';
    const [local, domain] = String(email).split('@');
    const parts = domain.split('.');
    const domainName = parts.shift() || '';
    const domainRest = parts.join('.') || '';
    const mask = (s) => {
      if (!s) return '';
      if (s.length <= 2) return s[0] + '*';
      return s[0] + '*'.repeat(Math.max(1, s.length - 2)) + s[s.length - 1];
    };
    return `${mask(local)}@${mask(domainName)}${domainRest ? '.' + domainRest : ''}`;
  } catch (_) {
    return '';
  }
};

/* =========================
   Mailer
   ========================= */
const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = Number(process.env.SMTP_PORT || 0);
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const SMTP_SECURE = String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true';
// TLS setting: allow bypassing cert validation (DEV ONLY!) when behind corporate self-signed proxies
const SMTP_REJECT_UNAUTHORIZED = String(process.env.SMTP_REJECT_UNAUTHORIZED || 'true').toLowerCase() !== 'false';
// Easy Gmail setup (optional): if provided and SMTP_* not set, will use Gmail
const GMAIL_USER = process.env.GMAIL_USER || '';
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD || '';

let mailer = null;
let mailerTest = { usingEthereal: false };
if (SMTP_HOST && SMTP_PORT && SMTP_USER && SMTP_PASS) {
  mailer = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    tls: { rejectUnauthorized: SMTP_REJECT_UNAUTHORIZED },
  });
  mailer.verify().then(() => console.log('[mailer] SMTP ready')).catch(err => console.warn('[mailer] verify failed:', err?.message));
} else if (GMAIL_USER && GMAIL_APP_PASSWORD) {
  // Simple Gmail mode (requires App Password, 2FA enabled)
  mailer = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
    tls: { rejectUnauthorized: SMTP_REJECT_UNAUTHORIZED },
  });
  mailer.verify().then(() => console.log('[mailer] Gmail SMTP ready')).catch(err => console.warn('[mailer] Gmail verify failed:', err?.message));
} else {
  console.log('[mailer] SMTP not configured; will use Ethereal test account if needed.');
}

async function sendResetEmail(to, resetLink) {
  try {
    // Lazy init Ethereal if not configured
    if (!mailer) {
      const testAcc = await nodemailer.createTestAccount();
      mailer = nodemailer.createTransport({
        host: 'smtp.ethereal.email',
        port: 587,
        secure: false,
        auth: { user: testAcc.user, pass: testAcc.pass },
      });
      mailerTest.usingEthereal = true;
      console.log('[mailer] Using Ethereal test SMTP. Credentials created.');
    }
    const appName = process.env.APP_NAME || 'Fitme';
    const from = process.env.MAIL_FROM || SMTP_USER || 'bank12018@gmail.com';
    const info = await mailer.sendMail({
      from,
      to,
      subject: `${appName} – ลิงก์รีเซ็ตรหัสผ่าน`,
      text: `คุณร้องขอรีเซ็ตรหัสผ่าน หากใช่ ให้กดลิงก์นี้เพื่อดำเนินการต่อ: ${resetLink}\nหากคุณไม่ได้ร้องขอ สามารถเพิกเฉยอีเมลนี้ได้`,
      html: `
        <p>คุณร้องขอรีเซ็ตรหัสผ่าน</p>
        <p>หากใช่ ให้กดลิงก์นี้เพื่อดำเนินการต่อ:</p>
        <p><a href="${resetLink}">${resetLink}</a></p>
        <p>หากคุณไม่ได้ร้องขอ สามารถเพิกเฉยอีเมลนี้ได้</p>
      `,
    });
    let previewUrl;
    if (mailerTest.usingEthereal) {
      previewUrl = nodemailer.getTestMessageUrl(info);
      if (previewUrl) console.log('[mailer] Preview URL (Ethereal):', previewUrl);
    }
    return { ok: true, previewUrl };
  } catch (e) {
    console.error('[mailer] sendResetEmail error:', e?.message || e);
    return { ok: false };
  }
}

/* =========================
   Sessions (dev-simple token store)
   ========================= */
const sessions = new Map(); // token -> userId
const newToken = () => crypto.randomBytes(24).toString('hex');

/* =========================
   Password reset tokens (DB storage)
   ========================= */
const RESET_TOKEN_TTL_MS = 1000 * 60 * 30; // 30 minutes
const sha256Buf = (s) => crypto.createHash('sha256').update(s).digest();

async function insertResetToken(userId, token /*, req */) {
  const tokenHash = sha256Buf(token);
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);
  const pool = await poolPromise;
  await pool.request()
    .input('user_id', sql.Int, userId)
    .input('token_hash', sql.VarBinary, tokenHash)
    .input('expires_at', sql.DateTime2, expiresAt)
    .query('INSERT INTO dbo.password_reset_tokens (user_id, token_hash, expires_at) VALUES (@user_id, @token_hash, @expires_at)');
}

async function findActiveResetToken(token) {
  if (!token) return null;
  const tokenHash = sha256Buf(token);
  const pool = await poolPromise;
  const rs = await pool.request()
    .input('token_hash', sql.VarBinary, tokenHash)
    .query('SELECT TOP 1 id, user_id, expires_at, used_at FROM dbo.password_reset_tokens WHERE token_hash=@token_hash ORDER BY id DESC');
  if (!rs.recordset.length) return null;
  const rec = rs.recordset[0];
  if (rec.used_at) return null;
  const exp = new Date(rec.expires_at).getTime();
  if (Date.now() > exp) return null;
  return rec;
}

async function markResetTokenUsed(id) {
  const pool = await poolPromise;
  await pool.request().input('id', sql.Int, id).query('UPDATE dbo.password_reset_tokens SET used_at=SYSDATETIME() WHERE id=@id');
}

/* =========================
   Middlewares
   ========================= */
const requireAuth = async (req, res, next) => {
  try {
    const auth = req.headers.authorization || '';
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (!m) return res.status(401).json({ error: 'unauthorized' });
    const token = m[1];
    const userId = sessions.get(token);
    if (!userId) return res.status(401).json({ error: 'invalid token' });

    const pool = await poolPromise;
    const rs = await pool.request()
      .input('id', sql.Int, userId)
      .query(`
        SELECT TOP 1 id, username, email, first_name, last_name, gender, date_of_birth,
               ISNULL(is_admin,0) AS is_admin, ISNULL(is_active,1) AS is_active
        FROM dbo.users WHERE id=@id
      `);
    if (!rs.recordset.length) return res.status(401).json({ error: 'user not found' });

    const u = rs.recordset[0];
    if (!u.is_active) return res.status(403).json({ error: 'account disabled' });

    req.user = u; // {id, username, is_admin, ...}
    req.token = token;
    next();
  } catch (e) {
    console.error('requireAuth error:', e);
    res.status(500).json({ error: 'server error' });
  }
};

// ตรวจว่าเป็นแอดมิน
const requireAdmin = (req, res, next) => {
  if (!req.user || !req.user.is_admin) {
    return res.status(403).json({ error: 'forbidden' });
  }
  next();
};

// เปิด/ปิดการใช้งานผู้ใช้
app.put('/api/admin/users/:id/active', requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { is_active } = req.body || {};
    if (!Number.isFinite(id) || typeof is_active !== 'boolean') {
      return res.status(400).json({ error: 'invalid params' });
    }

    const pool = await poolPromise;
    await pool.request()
      .input('id', sql.Int, id)
      .input('is_active', sql.Bit, is_active ? 1 : 0)
      .query(`UPDATE dbo.users SET is_active=@is_active WHERE id=@id`);

    res.json({ ok: true });
  } catch (e) {
    console.error('PUT /api/admin/users/:id/active error', e);
    res.status(500).json({ error: 'server error' });
  }
});

// ป้องกันยิง /login รัวๆ แบบง่ายๆ ตาม IP (1 req/วินาที)
const lastLoginAt = new Map(); // ip -> timestamp
function throttleLogin(req, res, next) {
  try {
    const now = Date.now();
    const ip = (req.ip || req.headers['x-forwarded-for'] || req.connection?.remoteAddress || 'ip').toString();
    const last = lastLoginAt.get(ip) || 0;
    if (now - last < 1000) return res.status(429).json({ error: 'too many requests' });
    lastLoginAt.set(ip, now);
    next();
  } catch (e) {
    next();
  }
}

/* =========================
   Routes: Public
   ========================= */
app.get('/', (_req, res) => res.json('Hello from the backend! (token auth)'));

app.post('/register', async (req, res) => {
  try {
    const username   = req.body?.username;
    const password   = req.body?.password;
    const email      = req.body?.email;
    const first_name = req.body?.first_name ?? req.body?.firstName;
    const last_name  = req.body?.last_name  ?? req.body?.lastName;
    const genderRaw  = req.body?.gender ?? req.body?.Gender ?? req.body?.sex ?? req.body?.Sex;
    const dobRaw     = req.body?.date_of_birth ?? req.body?.dateOfBirth ?? req.body?.dob;

    if (!username || !password || !email || !first_name || !last_name || !genderRaw || !dobRaw)
      return res.status(400).json({ error: 'กรุณากรอกข้อมูลให้ครบทุกช่อง' });
    if (String(username).trim().length < 3)
      return res.status(400).json({ error: 'ชื่อผู้ใช้ต้องมีอย่างน้อย 3 ตัวอักษร' });
    if (!isValidEmail(email))
      return res.status(400).json({ error: 'รูปแบบอีเมลไม่ถูกต้อง' });

    const g = normalizeGender(genderRaw);
    if (!g) return res.status(400).json({ error: 'ค่า gender ไม่ถูกต้อง (male/female/ชาย/หญิง)' });

    const dob = parseYMD(dobRaw);
    if (!dob) return res.status(400).json({ error: 'รูปแบบวันเกิดไม่ถูกต้อง (YYYY-MM-DD)' });

    const pool = await poolPromise;
    const dup = await pool.request()
      .input('username', sql.NVarChar, String(username).trim())
      .input('email',    sql.NVarChar, String(email).trim())
      .query('SELECT TOP 1 1 FROM dbo.users WHERE username=@username OR email=@email');
    if (dup.recordset.length > 0)
      return res.status(409).json({ error: 'ชื่อผู้ใช้หรืออีเมลนี้ถูกใช้ไปแล้ว' });

    const hashed = await bcrypt.hash(String(password), 10);
    await pool.request()
      .input('username',      sql.NVarChar, String(username).trim())
      .input('password',      sql.NVarChar, hashed)
      .input('email',         sql.NVarChar, String(email).trim())
      .input('first_name',    sql.NVarChar, String(first_name).trim())
      .input('last_name',     sql.NVarChar, String(last_name).trim())
      .input('gender',        sql.NVarChar, g)
      .input('date_of_birth', sql.Date,     dob)
      .query(`
        INSERT INTO dbo.users (username, [password], email, first_name, last_name, gender, date_of_birth)
        VALUES (@username, @password, @email, @first_name, @last_name, @gender, @date_of_birth)
      `);

    // auto-login
    const rs = await pool.request()
      .input('username', sql.NVarChar, String(username).trim())
      .query(`
        SELECT TOP 1 id, username, email, first_name, last_name, gender, date_of_birth,
               ISNULL(is_admin,0) AS is_admin, ISNULL(is_active,1) AS is_active
        FROM dbo.users WHERE username=@username
      `);

    const token = newToken();
    sessions.set(token, rs.recordset[0].id);
    res.json({ message: 'สมัครสมาชิกสำเร็จ!', token, user: rs.recordset[0] });
  } catch (err) {
    console.error('SQL error (register)', err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดในการสมัครสมาชิก' });
  }
});

app.post('/login', throttleLogin, async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน' });

    const pool = await poolPromise;
    const rs = await pool.request()
      .input('username', sql.NVarChar, String(username).trim())
      .query(`
        SELECT TOP 1 id, username, [password], email, first_name, last_name, gender, date_of_birth,
               ISNULL(is_admin,0) AS is_admin, ISNULL(is_active,1) AS is_active
        FROM dbo.users WHERE username = @username
      `);

    const invalid = () => res.status(401).json({ error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
    if (!rs.recordset.length) return invalid();

    const user = rs.recordset[0];
    if (!user.is_active) return res.status(403).json({ error: 'บัญชีถูกปิดการใช้งาน' });

    const stored = String(user.password || '');

    if (looksHashed(stored)) {
      const ok = await bcrypt.compare(String(password), stored);
      if (!ok) return invalid();
    } else {
      if (stored !== String(password)) return invalid();
      const newHash = await bcrypt.hash(String(password), 10);
      await pool.request()
        .input('id', sql.Int, user.id)
        .input('pw', sql.NVarChar, newHash)
        .query('UPDATE dbo.users SET [password] = @pw WHERE id = @id');
    }

    const token = newToken();
    sessions.set(token, user.id);
    const { password: _pw, ...safeUser } = user;
    res.json({ message: 'ล็อกอินสำเร็จ!', token, user: safeUser });
  } catch (err) {
    console.error('SQL error (login)', err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดในการล็อกอิน' });
  }
});

app.post('/logout', requireAuth, (req, res) => {
  if (req.token) sessions.delete(req.token);
  res.json({ ok: true });
});

/* =========================
   Me / Profile / Settings
   ========================= */
app.get('/api/me', requireAuth, async (req, res) => {
  try {
    const pool = await poolPromise;
    const me = await pool.request()
      .input('uid', sql.Int, req.user.id)
      .query(`
        SELECT
          u.[id], u.[username], u.[email], u.[first_name], u.[last_name], u.[gender], u.[date_of_birth],
          ISNULL(u.[is_admin],0)   AS is_admin,
          ISNULL(u.[is_active],1)  AS is_active,
          p.[ExerciseType]    AS exercise_type,
          p.[ActivityLevel]   AS activity_level,
          p.[WeightKg]        AS weight_kg,
          p.[HeightCm]        AS height_cm,
          p.[WaterGoalL]      AS water_goal_l,
          p.[HealthCondition] AS health_condition,
          p.[Goal]            AS goal
        FROM [dbo].[users] AS u
        OUTER APPLY (
          SELECT TOP (1) *
          FROM [dbo].[User_Profiles] p
          WHERE p.[UserId] = u.[id]
          ORDER BY p.[UpdatedAt] DESC
        ) AS p
        WHERE u.[id] = @uid;
      `);
    res.json(me.recordset[0] || null);
  } catch (err) {
    console.error('SQL error (/api/me)', err);
    res.status(500).json({ error: 'server error' });
  }
});

app.put('/api/me/profile', requireAuth, async (req, res) => {
  try {
    const {
      exercise_type, activity_level, weight_kg, height_cm, water_goal_l, health_condition, goal
    } = req.body || {};

    const pool = await poolPromise;
    await pool.request()
      .input('uid',              sql.Int,           req.user.id)
      .input('ExerciseType',     sql.NVarChar(32),  exercise_type ?? null)
      .input('ActivityLevel',    sql.NVarChar(32),  activity_level ?? null)
      .input('WeightKg',         sql.Decimal(5,2),  weight_kg ?? null)
      .input('HeightCm',         sql.Decimal(5,2),  height_cm ?? null)
      .input('WaterGoalL',       sql.Decimal(4,2),  water_goal_l ?? null)
      .input('HealthCondition',  sql.NVarChar(255), health_condition ?? null)
      .input('Goal',             sql.NVarChar(32),  goal ?? null)
      .query(`
        IF EXISTS (SELECT 1 FROM dbo.User_Profiles WITH (UPDLOCK, HOLDLOCK) WHERE UserId = @uid)
        BEGIN
          UPDATE dbo.User_Profiles
          SET ExerciseType    = @ExerciseType,
              ActivityLevel   = @ActivityLevel,
              WeightKg        = @WeightKg,
              HeightCm        = @HeightCm,
              WaterGoalL      = @WaterGoalL,
              HealthCondition = @HealthCondition,
              [Goal]          = @Goal,
              UpdatedAt       = SYSUTCDATETIME()
          WHERE UserId = @uid;
        END
        ELSE
        BEGIN
          INSERT INTO dbo.User_Profiles
            (UserId, ExerciseType, ActivityLevel, WeightKg, HeightCm, WaterGoalL, HealthCondition, [Goal])
          VALUES
            (@uid,  @ExerciseType, @ActivityLevel, @WeightKg, @HeightCm, @WaterGoalL, @HealthCondition, @Goal);
        END
      `);

    res.json({ ok: true });
  } catch (err) {
    console.error('SQL error (PUT /api/me/profile)', err);
    res.status(500).json({ error: 'server error' });
  }
});

app.get('/whoami', requireAuth, (req, res) => res.json(req.user || null));

/* =========================
   Calories / Favorites / Settings
   ========================= */
app.get('/api/calories', requireAuth, async (req, res) => {
  try {
    const date = String(req.query.date || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'date ต้องเป็นรูปแบบ YYYY-MM-DD' });
    }
    const from = new Date(date + 'T00:00:00Z');
    const to   = new Date(from.getTime() + 24 * 60 * 60 * 1000);

    const pool = await poolPromise;
    const rs = await pool.request()
      .input('uid', sql.Int, req.user.id)
      .input('from', sql.DateTimeOffset, from)
      .input('to',   sql.DateTimeOffset, to)
      .query(`
        SELECT Id, ConsumedAt, Name, Category, CaloriesPerServing, Servings
        FROM dbo.Calorie_Entries
        WHERE UserId=@uid AND ConsumedAt >= @from AND ConsumedAt < @to
        ORDER BY ConsumedAt DESC, Id DESC
      `);

    const items = rs.recordset.map(r => ({
      id: r.Id,
      consumedAt: r.ConsumedAt,
      name: r.Name,
      category: r.Category,
      caloriesPerServing: Number(r.CaloriesPerServing),
      servings: Number(r.Servings),
      total: Number(r.CaloriesPerServing) * Number(r.Servings),
    }));
    const total = items.reduce((s, x) => s + x.total, 0);
    res.json({ date, total, items });
  } catch (err) {
    console.error('GET /api/calories error', err);
    res.status(500).json({ error: 'server error' });
  }
});

app.post('/api/calories', requireAuth, async (req, res) => {
  try {
    const { name, caloriesPerServing, servings, category, consumedAt } = req.body || {};
    if (!name || !caloriesPerServing || !servings) {
      return res.status(400).json({ error: 'กรอก name, caloriesPerServing, servings ให้ครบ' });
    }
    const cat = category || null;
    if (cat && !['breakfast','lunch','dinner','snack'].includes(String(cat))) {
      return res.status(400).json({ error: 'category ต้องเป็น breakfast|lunch|dinner|snack' });
    }
    const consAt = consumedAt ? new Date(consumedAt) : new Date();

    const pool = await poolPromise;
    const rs = await pool.request()
      .input('uid', sql.Int, req.user.id)
      .input('ConsumedAt', sql.DateTimeOffset, consAt)
      .input('Name', sql.NVarChar(100), String(name).trim())
      .input('Category', sql.NVarChar(16), cat)
      .input('CaloriesPerServing', sql.Decimal(8,2), Number(caloriesPerServing))
      .input('Servings', sql.Decimal(8,2), Number(servings))
      .query(`
        INSERT INTO dbo.Calorie_Entries
          (UserId, ConsumedAt, Name, Category, CaloriesPerServing, Servings)
        OUTPUT inserted.Id
        VALUES (@uid, @ConsumedAt, @Name, @Category, @CaloriesPerServing, @Servings)
      `);

    res.json({ ok: true, id: rs.recordset[0].Id });
  } catch (err) {
    console.error('POST /api/calories error', err);
    res.status(500).json({ error: 'server error' });
  }
});

app.put('/api/calories/:id', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });

    const { name, caloriesPerServing, servings, category, consumedAt } = req.body || {};
    if (!name || !caloriesPerServing || !servings) {
      return res.status(400).json({ error: 'กรอก name, caloriesPerServing, servings ให้ครบ' });
    }
    const cat = category || null;
    if (cat && !['breakfast','lunch','dinner','snack'].includes(String(cat))) {
      return res.status(400).json({ error: 'category ต้องเป็น breakfast|lunch|dinner|snack' });
    }
    const consAt = consumedAt ? new Date(consumedAt) : new Date();

    const pool = await poolPromise;
    const upd = await pool.request()
      .input('id', sql.BigInt, id)
      .input('uid', sql.Int, req.user.id)
      .input('ConsumedAt', sql.DateTimeOffset, consAt)
      .input('Name', sql.NVarChar(100), String(name).trim())
      .input('Category', sql.NVarChar(16), cat)
      .input('CaloriesPerServing', sql.Decimal(8,2), Number(caloriesPerServing))
      .input('Servings', sql.Decimal(8,2), Number(servings))
      .query(`
        UPDATE dbo.Calorie_Entries
        SET ConsumedAt=@ConsumedAt, Name=@Name, Category=@Category,
            CaloriesPerServing=@CaloriesPerServing, Servings=@Servings
        WHERE Id=@id AND UserId=@uid
      `);

    if (upd.rowsAffected[0] === 0) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('PUT /api/calories/:id error', err);
    res.status(500).json({ error: 'server error' });
  }
});

app.delete('/api/calories/:id', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });

    const pool = await poolPromise;
    const del = await pool.request()
      .input('id', sql.BigInt, id)
      .input('uid', sql.Int, req.user.id)
      .query(`DELETE FROM dbo.Calorie_Entries WHERE Id=@id AND UserId=@uid`);

    if (del.rowsAffected[0] === 0) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/calories/:id error', err);
    res.status(500).json({ error: 'server error' });
  }
});

app.get('/api/favorites', requireAuth, async (req, res) => {
  try {
    const pool = await poolPromise;
    const rs = await pool.request()
      .input('uid', sql.Int, req.user.id)
      .query(`
        SELECT Id, Name, Calories, UsageCount, UpdatedAt
        FROM dbo.User_Favorite_Foods
        WHERE UserId=@uid
        ORDER BY UsageCount DESC, UpdatedAt DESC
      `);
    res.json(rs.recordset);
  } catch (err) {
    console.error('GET /api/favorites error', err);
    res.status(500).json({ error: 'server error' });
  }
});

app.post('/api/favorites', requireAuth, async (req, res) => {
  try {
    const { name, calories } = req.body || {};
    if (!name || !calories) return res.status(400).json({ error: 'กรอก name, calories ให้ครบ' });

    const pool = await poolPromise;
    const rs = await pool.request()
      .input('uid', sql.Int, req.user.id)
      .input('Name', sql.NVarChar(100), String(name).trim())
      .input('Calories', sql.Decimal(8,2), Number(calories))
      .query(`
        IF EXISTS (SELECT 1 FROM dbo.User_Favorite_Foods WHERE UserId=@uid AND Name=@Name)
        BEGIN
          UPDATE dbo.User_Favorite_Foods
          SET Calories=@Calories, UsageCount = UsageCount + 1, UpdatedAt=SYSUTCDATETIME()
          WHERE UserId=@uid AND Name=@Name;

          SELECT Id FROM dbo.User_Favorite_Foods WHERE UserId=@uid AND Name=@Name;
        END
        ELSE
        BEGIN
          INSERT INTO dbo.User_Favorite_Foods (UserId, Name, Calories, UsageCount)
          OUTPUT inserted.Id
          VALUES (@uid, @Name, @Calories, 1);
        END
      `);

    res.json({ ok: true, id: rs.recordset[0].Id });
  } catch (err) {
    console.error('POST /api/favorites error', err);
    res.status(500).json({ error: 'server error' });
  }
});

app.delete('/api/favorites/:id', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });

    const pool = await poolPromise;
    const del = await pool.request()
      .input('id', sql.BigInt, id)
      .input('uid', sql.Int, req.user.id)
      .query(`DELETE FROM dbo.User_Favorite_Foods WHERE Id=@id AND UserId=@uid`);

    if (del.rowsAffected[0] === 0) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/favorites/:id error', err);
    res.status(500).json({ error: 'server error' });
  }
});

/* =========================
   Water intake (daily)
   Tables expected: dbo.Water_Entries (UserId INT, Date DATE, Ml INT, CreatedAt DATETIME2, UpdatedAt DATETIME2)
   ========================= */
app.get('/api/water', requireAuth, async (req, res) => {
  try {
    const dateStr = String(req.query.date || '').trim();
    const d = parseYMD(dateStr);
    if (!d) return res.status(400).json({ error: 'date ต้องเป็น YYYY-MM-DD' });
    const pool = await poolPromise;
    const rs = await pool.request()
      .input('uid', sql.Int, req.user.id)
      .input('d', sql.Date, d)
      .query(`SELECT TOP(1) Ml FROM dbo.Water_Entries WHERE UserId=@uid AND [Date]=@d`);
    const ml = rs.recordset[0]?.Ml ? Number(rs.recordset[0].Ml) : 0;
    res.json({ date: dateStr, ml });
  } catch (err) {
    console.error('GET /api/water error', err);
    res.status(500).json({ error: 'server error' });
  }
});

app.post('/api/water/add', requireAuth, async (req, res) => {
  try {
    const addMl = Number(req.body?.add_ml || 0);
    const dateStr = String(req.body?.date || ymd(new Date())).trim();
    if (!Number.isFinite(addMl) || addMl === 0) return res.status(400).json({ error: 'add_ml invalid' });
    const d = parseYMD(dateStr);
    if (!d) return res.status(400).json({ error: 'date ต้องเป็น YYYY-MM-DD' });

    const pool = await poolPromise;
    await pool.request()
      .input('uid', sql.Int, req.user.id)
      .input('d', sql.Date, d)
      .input('m', sql.Int, addMl)
      .query(`
        MERGE dbo.Water_Entries WITH (HOLDLOCK) AS t
        USING (SELECT @uid AS UserId, @d AS [Date]) AS s
        ON (t.UserId=s.UserId AND t.[Date]=s.[Date])
        WHEN MATCHED THEN UPDATE SET Ml = ISNULL(t.Ml,0) + @m, UpdatedAt=SYSUTCDATETIME()
        WHEN NOT MATCHED THEN INSERT (UserId,[Date],Ml,CreatedAt,UpdatedAt) VALUES(@uid,@d,@m,SYSUTCDATETIME(),SYSUTCDATETIME());
      `);
    const r2 = await pool.request().input('uid', sql.Int, req.user.id).input('d', sql.Date, d)
      .query(`SELECT TOP(1) Ml FROM dbo.Water_Entries WHERE UserId=@uid AND [Date]=@d`);
    res.json({ ok: true, date: dateStr, ml: Number(r2.recordset[0]?.Ml || 0) });
  } catch (err) {
    console.error('POST /api/water/add error', err);
    res.status(500).json({ error: 'server error' });
  }
});

app.put('/api/water', requireAuth, async (req, res) => {
  try {
    const ml = Number(req.body?.ml || 0);
    const dateStr = String(req.body?.date || ymd(new Date())).trim();
    const d = parseYMD(dateStr);
    if (!d) return res.status(400).json({ error: 'date ต้องเป็น YYYY-MM-DD' });
    const pool = await poolPromise;
    await pool.request().input('uid', sql.Int, req.user.id).input('d', sql.Date, d).input('ml', sql.Int, ml)
      .query(`
        MERGE dbo.Water_Entries WITH (HOLDLOCK) AS t
        USING (SELECT @uid AS UserId, @d AS [Date]) s
        ON t.UserId=s.UserId AND t.[Date]=s.[Date]
        WHEN MATCHED THEN UPDATE SET Ml=@ml, UpdatedAt=SYSUTCDATETIME()
        WHEN NOT MATCHED THEN INSERT (UserId,[Date],Ml,CreatedAt,UpdatedAt) VALUES (@uid,@d,@ml,SYSUTCDATETIME(),SYSUTCDATETIME());
      `);
    res.json({ ok: true, date: dateStr, ml });
  } catch (err) {
    console.error('PUT /api/water error', err);
    res.status(500).json({ error: 'server error' });
  }
});

app.get('/api/water/summary', requireAuth, async (req, res) => {
  try {
    const days = Math.min(90, Math.max(1, Number(req.query.days || 7)));
    const to = new Date();
    const from = new Date(to.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
    const pool = await poolPromise;
    const rs = await pool.request()
      .input('uid', sql.Int, req.user.id)
      .input('from', sql.Date, from)
      .input('to', sql.Date, to)
      .query(`SELECT [Date], Ml FROM dbo.Water_Entries WHERE UserId=@uid AND [Date] BETWEEN @from AND @to ORDER BY [Date] ASC`);
    const map = new Map(rs.recordset.map(r => [ymd(new Date(r.Date)), Number(r.Ml)]));
    const out = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(from.getTime() + i * 86400000);
      const s = ymd(d);
      out.push({ date: s, ml: map.get(s) || 0 });
    }
    res.json({ from: ymd(from), to: ymd(to), days, items: out });
  } catch (err) {
    console.error('GET /api/water/summary error', err);
    res.status(500).json({ error: 'server error' });
  }
});

/* =========================
   Weight entries (daily)
   Table: dbo.Weight_Entries (UserId INT, Date DATE, WeightKg DECIMAL(5,2))
   ========================= */
app.get('/api/weight', requireAuth, async (req, res) => {
  try {
    const dateStr = String(req.query.date || '').trim();
    const d = parseYMD(dateStr);
    if (!d) return res.status(400).json({ error: 'date ต้องเป็น YYYY-MM-DD' });
    const pool = await poolPromise;
    const rs = await pool.request().input('uid', sql.Int, req.user.id).input('d', sql.Date, d)
      .query(`SELECT TOP(1) WeightKg FROM dbo.Weight_Entries WHERE UserId=@uid AND [Date]=@d`);
    const w = rs.recordset[0]?.WeightKg != null ? Number(rs.recordset[0].WeightKg) : null;
    res.json({ date: dateStr, weight_kg: w });
  } catch (err) {
    console.error('GET /api/weight error', err);
    res.status(500).json({ error: 'server error' });
  }
});

app.put('/api/weight', requireAuth, async (req, res) => {
  try {
    const dateStr = String(req.body?.date || ymd(new Date())).trim();
    const weight = req.body?.weight_kg;
    const d = parseYMD(dateStr);
    if (!d) return res.status(400).json({ error: 'date ต้องเป็น YYYY-MM-DD' });
    if (weight == null || !Number.isFinite(Number(weight))) return res.status(400).json({ error: 'weight_kg invalid' });
    const pool = await poolPromise;
    await pool.request()
      .input('uid', sql.Int, req.user.id)
      .input('d', sql.Date, d)
      .input('w', sql.Decimal(5,2), Number(weight))
      .query(`
        MERGE dbo.Weight_Entries WITH (HOLDLOCK) AS t
        USING (SELECT @uid AS UserId, @d AS [Date]) s
        ON t.UserId=s.UserId AND t.[Date]=s.[Date]
        WHEN MATCHED THEN UPDATE SET WeightKg=@w, UpdatedAt=SYSUTCDATETIME()
        WHEN NOT MATCHED THEN INSERT (UserId,[Date],WeightKg,CreatedAt,UpdatedAt) VALUES(@uid,@d,@w,SYSUTCDATETIME(),SYSUTCDATETIME());
      `);
    res.json({ ok: true, date: dateStr, weight_kg: Number(weight) });
  } catch (err) {
    console.error('PUT /api/weight error', err);
    res.status(500).json({ error: 'server error' });
  }
});

app.get('/api/weight/summary', requireAuth, async (req, res) => {
  try {
    const days = Math.min(180, Math.max(1, Number(req.query.days || 30)));
    const to = new Date();
    const from = new Date(to.getTime() - (days - 1) * 86400000);
    const pool = await poolPromise;
    const rs = await pool.request().input('uid', sql.Int, req.user.id).input('from', sql.Date, from).input('to', sql.Date, to)
      .query(`SELECT [Date], WeightKg FROM dbo.Weight_Entries WHERE UserId=@uid AND [Date] BETWEEN @from AND @to ORDER BY [Date] ASC`);
    const out = rs.recordset.map(r => ({ date: ymd(new Date(r.Date)), weight_kg: r.WeightKg != null ? Number(r.WeightKg) : null }));
    res.json({ from: ymd(from), to: ymd(to), days, items: out });
  } catch (err) {
    console.error('GET /api/weight/summary error', err);
    res.status(500).json({ error: 'server error' });
  }
});

/* =========================
   Workout Sessions / Sets logging
   Tables: dbo.Workout_Sessions, dbo.Workout_Session_Sets
   ========================= */
app.post('/api/workout/session/start', requireAuth, async (req, res) => {
  try {
    const planId = Number(req.body?.planId || req.body?.plan_id || 0) || null;
    const dayId = Number(req.body?.dayId || req.body?.day_id || 0) || null;
    const pool = await poolPromise;
    const rs = await pool.request()
      .input('uid', sql.Int, req.user.id)
      .input('plan', sql.Int, planId)
      .input('day', sql.Int, dayId)
      .query(`
        INSERT INTO dbo.Workout_Sessions (UserId, PlanId, DayId, StartedAt)
        OUTPUT inserted.Id
        VALUES (@uid, @plan, @day, SYSUTCDATETIME())
      `);
    res.json({ ok: true, sessionId: rs.recordset[0].Id });
  } catch (err) {
    console.error('POST /api/workout/session/start error', err);
    res.status(500).json({ error: 'server error' });
  }
});

app.post('/api/workout/session/:id/set', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid session id' });
    const b = req.body || {};
    const pool = await poolPromise;

    // Determine next seq if not provided
    let seq = Number(b.seq || b.Seq || 0);
    if (!Number.isFinite(seq) || seq <= 0) {
      const r = await pool.request().input('sid', sql.BigInt, id)
        .query('SELECT ISNULL(MAX(Seq),0)+1 AS NextSeq FROM dbo.Workout_Session_Sets WHERE SessionId=@sid');
      seq = Number(r.recordset[0]?.NextSeq || 1);
    }

    await pool.request()
      .input('sid', sql.BigInt, id)
      .input('seq', sql.TinyInt, seq)
      .input('ename', sql.NVarChar(100), b.exerciseName ?? b.ExerciseName ?? null)
      .input('peid', sql.Int, b.planExerciseId ?? null)
      .input('eid', sql.Int, b.exerciseId ?? null)
      .input('w', sql.Decimal(6,2), b.weightKg != null ? Number(b.weightKg) : null)
      .input('reps', sql.SmallInt, b.reps != null ? Number(b.reps) : null)
      .input('tsec', sql.Int, b.timeSec != null ? Number(b.timeSec) : null)
      .input('rest', sql.SmallInt, b.restSec != null ? Number(b.restSec) : null)
      .input('rpe', sql.TinyInt, b.rpe != null ? Number(b.rpe) : null)
      .input('hr', sql.SmallInt, b.heartRate != null ? Number(b.heartRate) : null)
      .query(`
        INSERT INTO dbo.Workout_Session_Sets (SessionId, Seq, ExerciseName, PlanExerciseId, ExerciseId, WeightKg, Reps, TimeSec, RestSec, RPE, HeartRate, CompletedAt)
        VALUES (@sid, @seq, @ename, @peid, @eid, @w, @reps, @tsec, @rest, @rpe, @hr, SYSUTCDATETIME())
      `);

    res.json({ ok: true, seq });
  } catch (err) {
    console.error('POST /api/workout/session/:id/set error', err);
    res.status(500).json({ error: 'server error' });
  }
});

app.post('/api/workout/session/:id/finish', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid session id' });
    const sessionRpe = req.body?.sessionRPE != null ? Number(req.body.sessionRPE) : (req.body?.sessionRpe != null ? Number(req.body.sessionRpe) : null);

    const pool = await poolPromise;
    // Aggregate
    const agg = await pool.request().input('sid', sql.BigInt, id).query(`
      SELECT COUNT(*) AS Sets,
             SUM(CASE WHEN Reps IS NOT NULL AND WeightKg IS NOT NULL THEN CAST(Reps * WeightKg AS DECIMAL(12,2)) ELSE 0 END) AS VolumeKg,
             SUM(ISNULL(Reps,0)) AS TotalReps,
             AVG(CASE WHEN HeartRate IS NOT NULL THEN HeartRate END) AS AvgHR
      FROM dbo.Workout_Session_Sets
      WHERE SessionId=@sid
    `);
    const sets = Number(agg.recordset[0]?.Sets || 0);
    const volume = Number(agg.recordset[0]?.VolumeKg || 0);
    const reps = Number(agg.recordset[0]?.TotalReps || 0);
    const avgHr = agg.recordset[0]?.AvgHR != null ? Math.round(Number(agg.recordset[0].AvgHR)) : null;

    const upd = await pool.request()
      .input('sid', sql.BigInt, id)
      .input('rpe', sql.TinyInt, sessionRpe)
      .input('sets', sql.SmallInt, sets)
      .input('reps', sql.Int, reps)
      .input('vol', sql.Decimal(12,2), volume)
      .input('avg', sql.SmallInt, avgHr)
      .query(`
        UPDATE dbo.Workout_Sessions
        SET FinishedAt = SYSUTCDATETIME(),
            DurationSec = DATEDIFF(SECOND, StartedAt, SYSUTCDATETIME()),
            SessionRPE = COALESCE(@rpe, SessionRPE),
            TotalSets = @sets,
            TotalReps = @reps,
            TotalVolumeKg = @vol,
            AvgHeartRate = @avg
        WHERE Id=@sid
      `);
    if (upd.rowsAffected[0] === 0) return res.status(404).json({ error: 'session not found' });
    res.json({ ok: true, sessionId: id, totalSets: sets, totalReps: reps, totalVolumeKg: volume, avgHeartRate: avgHr });
  } catch (err) {
    console.error('POST /api/workout/session/:id/finish error', err);
    res.status(500).json({ error: 'server error' });
  }
});

app.get('/api/workout/summary', requireAuth, async (req, res) => {
  try {
    const days = Math.min(90, Math.max(1, Number(req.query.days || 28)));
    const to = new Date();
    const from = new Date(to.getTime() - (days - 1) * 86400000);
    const pool = await poolPromise;
    const rs = await pool.request().input('uid', sql.Int, req.user.id).input('from', sql.DateTimeOffset, from).input('to', sql.DateTimeOffset, to)
      .query(`
        SELECT COUNT(*) AS Sessions,
               SUM(ISNULL(DurationSec,0)) AS DurationSec,
               SUM(ISNULL(TotalSets,0)) AS TotalSets,
               SUM(ISNULL(TotalReps,0)) AS TotalReps,
               SUM(ISNULL(TotalVolumeKg,0)) AS TotalVolumeKg
        FROM dbo.Workout_Sessions
        WHERE UserId=@uid AND StartedAt BETWEEN @from AND @to
      `);
    const row = rs.recordset[0] || {};
    res.json({ from: from.toISOString(), to: to.toISOString(), days, ...row });
  } catch (err) {
    console.error('GET /api/workout/summary error', err);
    res.status(500).json({ error: 'server error' });
  }
});

app.get('/api/workout/daily', requireAuth, async (req, res) => {
  try {
    const days = Math.min(90, Math.max(1, Number(req.query.days || 28)));
    const to = new Date();
    const from = new Date(to.getTime() - (days - 1) * 86400000);
    const pool = await poolPromise;
    const rs = await pool.request()
      .input('uid', sql.Int, req.user.id)
      .input('from', sql.Date, from)
      .input('to', sql.Date, to)
      .query(`
        SELECT CAST(StartedAt AS DATE) AS [Date],
               COUNT(*) AS Sessions,
               SUM(ISNULL(DurationSec, DATEDIFF(SECOND, StartedAt, ISNULL(FinishedAt, SYSUTCDATETIME())))) AS DurationSec
        FROM dbo.Workout_Sessions
        WHERE UserId=@uid AND CAST(StartedAt AS DATE) BETWEEN @from AND @to
        GROUP BY CAST(StartedAt AS DATE)
        ORDER BY [Date] ASC
      `);
    const map = new Map(rs.recordset.map(r => [ymd(new Date(r.Date)), { sessions: Number(r.Sessions || 0), durationSec: Number(r.DurationSec || 0) }]));
    const out = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(from.getTime() + i * 86400000);
      const key = ymd(d);
      const v = map.get(key) || { sessions: 0, durationSec: 0 };
      out.push({ date: key, ...v });
    }
    res.json({ from: ymd(from), to: ymd(to), days, items: out });
  } catch (err) {
    console.error('GET /api/workout/daily error', err);
    res.status(500).json({ error: 'server error' });
  }
});

app.get('/api/settings', requireAuth, async (req, res) => {
  try {
    const pool = await poolPromise;
    const rs = await pool.request()
      .input('uid', sql.Int, req.user.id)
      .query(`SELECT UserId, DailyGoalKcal, GoalMode, ShowMealCategories, UpdatedAt
              FROM dbo.User_Settings WHERE UserId=@uid`);
    res.json(rs.recordset[0] || null);
  } catch (err) {
    console.error('GET /api/settings error', err);
    res.status(500).json({ error: 'server error' });
  }
});

app.put('/api/settings', requireAuth, async (req, res) => {
  try {
    const { dailyGoalKcal, goalMode, showMealCategories } = req.body || {};
    const pool = await poolPromise;
    await pool.request()
      .input('uid', sql.Int, req.user.id)
      .input('DailyGoalKcal', sql.Int, dailyGoalKcal ?? null)
      .input('GoalMode', sql.NVarChar(16), goalMode ?? null)
      .input('ShowMealCategories', sql.Bit, typeof showMealCategories === 'boolean' ? (showMealCategories ? 1 : 0) : null)
      .query(`
        IF EXISTS (SELECT 1 FROM dbo.User_Settings WHERE UserId=@uid)
        BEGIN
          UPDATE dbo.User_Settings
          SET DailyGoalKcal = @DailyGoalKcal,
              GoalMode = @GoalMode,
              ShowMealCategories = COALESCE(@ShowMealCategories, ShowMealCategories),
              UpdatedAt = SYSUTCDATETIME()
          WHERE UserId=@uid;
        END
        ELSE
        BEGIN
          INSERT INTO dbo.User_Settings (UserId, DailyGoalKcal, GoalMode, ShowMealCategories)
          VALUES (@uid, @DailyGoalKcal, @GoalMode, COALESCE(@ShowMealCategories, 1));
        END
      `);
    res.json({ ok: true });
  } catch (err) {
    console.error('PUT /api/settings error', err);
    res.status(500).json({ error: 'server error' });
  }
});

/* =========================
   Workout Plan
   ========================= */
const allowedDays = new Set([3,4,5]);
const allowedMinutes = new Set([30,45,60]);
const allowedEquip = new Set(['none','minimal','fullGym']);
const allowedLevel = new Set(['beginner','intermediate','advanced']);
const allowedGoal  = new Set(['lose_weight','build_muscle','maintain_shape','general_fitness']);

function validatePrefs(p) {
  if (!allowedDays.has(Number(p.daysPerWeek))) throw new Error('daysPerWeek ต้องเป็น 3/4/5');
  if (!allowedMinutes.has(Number(p.minutesPerSession))) throw new Error('minutesPerSession ต้องเป็น 30/45/60');
  if (!allowedEquip.has(String(p.equipment))) throw new Error('equipment ต้องเป็น none|minimal|fullGym');
  if (!allowedLevel.has(String(p.level))) throw new Error('level ต้องเป็น beginner|intermediate|advanced');
  if (!allowedGoal.has(String(p.goal))) throw new Error('goal ไม่ถูกต้อง');
}

function deriveTitleFromPrefs(p) {
  const goalName = {
    lose_weight: 'ลดน้ำหนัก',
    build_muscle: 'เพิ่มกล้ามเนื้อ',
    maintain_shape: 'รักษารูปร่าง',
    general_fitness: 'ฟิตทั่วไป'
  }[p.goal] || 'ฟิตทั่วไป';
  return `${goalName} • ${p.daysPerWeek}d x ${p.minutesPerSession}m (${p.level})`;
}

// removed progression helper to keep existing API unchanged

function buildPlanStructure(prefs) {
  const days = [];
  const D = prefs.daysPerWeek;
  if (D === 3) {
    days.push({ dayOrder: 1, focus: 'Full-Body' });
    days.push({ dayOrder: 2, focus: 'Full-Body' });
    days.push({ dayOrder: 3, focus: 'Full-Body' });
  } else if (D === 4) {
    if (prefs.goal === 'build_muscle') {
      days.push({ dayOrder: 1, focus: 'Upper' });
      days.push({ dayOrder: 2, focus: 'Lower' });
      days.push({ dayOrder: 3, focus: 'Upper' });
      days.push({ dayOrder: 4, focus: 'Lower' });
    } else {
      days.push({ dayOrder: 1, focus: 'Full-Body' });
      days.push({ dayOrder: 2, focus: 'Push + Core' });
      days.push({ dayOrder: 3, focus: 'Pull + Cardio' });
      days.push({ dayOrder: 4, focus: 'Legs' });
    }
  } else if (D === 5) {
    if (prefs.goal === 'build_muscle') {
      days.push({ dayOrder: 1, focus: 'Push' });
      days.push({ dayOrder: 2, focus: 'Pull' });
      days.push({ dayOrder: 3, focus: 'Legs' });
      days.push({ dayOrder: 4, focus: 'Upper' });
      days.push({ dayOrder: 5, focus: 'Lower' });
    } else {
      days.push({ dayOrder: 1, focus: 'Full-Body' });
      days.push({ dayOrder: 2, focus: 'Push' });
      days.push({ dayOrder: 3, focus: 'Pull' });
      days.push({ dayOrder: 4, focus: 'Legs' });
      days.push({ dayOrder: 5, focus: 'Conditioning/Cardio' });
    }
  }
  for (const d of days) {
    d.warmup = '5–8m warm-up + dynamic mobility';
    d.cooldown = '3–5m cooldown & stretching';
  }
  return days;
}

function buildExercisesForDay(focus, prefs) {
  const E = prefs.equipment;
  const L = prefs.level;
  const addCore = !!prefs.addCore;
  const addCardio = !!prefs.addCardio;

  const rx = (baseReps) => {
    if (L === 'beginner')  return { sets: 3, reps: baseReps, rest: 60 };
    if (L === 'advanced')  return { sets: 4, reps: baseReps, rest: 90 };
    return { sets: 3, reps: baseReps, rest: 75 };
  };

  const move = {
    squat:   E==='none' ? 'Bodyweight Squat' : (E==='minimal' ? 'Dumbbell Goblet Squat' : 'Barbell Back Squat'),
    hinge:   E==='none' ? 'Hip Hinge (BW Good Morning)' : (E==='minimal' ? 'DB RDL' : 'Barbell Romanian Deadlift'),
    push_h:  E==='none' ? 'Push-up' : (E==='minimal' ? 'DB Bench Press' : 'Barbell Bench Press'),
    push_v:  E==='none' ? 'Pike Push-up' : (E==='minimal' ? 'DB Shoulder Press' : 'Barbell Overhead Press'),
    pull_h:  E==='none' ? 'Inverted Row' : (E==='minimal' ? 'DB Row' : 'Seated/Barbell Row'),
    pull_v:  E==='none' ? 'Doorway Row / Towel Pull' : (E==='minimal' ? 'Band Lat Pulldown' : 'Lat Pulldown / Pull-up'),
    lunge:   E==='none' ? 'Reverse Lunge' : (E==='minimal' ? 'DB Reverse Lunge' : 'Smith/DB Lunge'),
    core1:   'Plank',
    core2:   'Dead Bug',
    cardio:  'Steady Jog / Bike / Row',
    conditioning: 'Intervals 30s on/30s off',
    calf:    E==='none' ? 'Calf Raise (BW)' : 'DB Calf Raise',
    fly:     E==='none' ? 'Push-up wide' : (E==='minimal' ? 'DB Fly' : 'Machine/Cable Fly'),
    curl:    E==='none' ? 'Backpack Biceps Curl' : 'DB Biceps Curl',
    triceps: E==='none' ? 'Bench Dip' : 'DB Overhead Triceps Extension',
  };

  const list = [];
  const add = (name, preset) => {
    if (!name) return;
    list.push({
      ExerciseName: name,
      Sets: preset.sets ?? null,
      RepsOrTime: preset.reps ? `${preset.reps}` : (preset.time ? `${preset.time}s` : null),
      RestSec: preset.rest ?? null,
      Notes: preset.notes ?? null,
    });
  };

  switch (true) {
    case /Full-Body/i.test(focus):
      add(move.squat, rx('8–12'));
      add(move.push_h, rx('8–12'));
      add(move.pull_h, rx('8–12'));
      add(move.hinge, rx('8–12'));
      if (addCore) add(move.core1, { sets: 3, time: 30, rest: 45 });
      if (addCardio) add(move.cardio, { sets: 1, time: 600, rest: 0, notes: 'easy pace 10m' });
      break;
    case /Upper/i.test(focus):
      add(move.push_h, rx('8–12'));
      add(move.pull_h, rx('8–12'));
      add(move.push_v, rx('8–12'));
      add(move.pull_v, rx('8–12'));
      add(move.curl, rx('10–15'));
      add(move.triceps, rx('10–15'));
      if (addCore) add(move.core2, { sets: 3, reps: '8–12', rest: 60 });
      break;
    case /Lower/i.test(focus):
      add(move.squat, rx('6–10'));
      add(move.hinge, rx('8–12'));
      add(move.lunge, rx('10–12/side'));
      add(move.calf, rx('12–20'));
      if (addCardio) add(move.cardio, { sets: 1, time: 600, rest: 0, notes: 'zone 2' });
      break;
    case /Push/i.test(focus) && !/Pull/i.test(focus):
      add(move.push_h, rx('6–10'));
      add(move.push_v, rx('8–12'));
      add(move.fly, rx('12–15'));
      add(move.triceps, rx('10–15'));
      if (addCore) add(move.core1, { sets: 3, time: 30, rest: 45 });
      break;
    case /Pull/i.test(focus) && !/Push/i.test(focus):
      add(move.pull_h, rx('6–10'));
      add(move.pull_v, rx('8–12'));
      add(move.curl, rx('10–15'));
      if (addCore) add(move.core2, { sets: 3, reps: '8–12', rest: 60 });
      break;
    case /Legs/i.test(focus):
      add(move.squat, rx('6–10'));
      add(move.lunge, rx('10–12/side'));
      add(move.hinge, rx('8–12'));
      add(move.calf, rx('12–20'));
      break;
    case /Conditioning|Cardio/i.test(focus):
      if (prefs.minutesPerSession >= 45) {
        add(move.conditioning, { sets: 12, time: 30, rest: 30, notes: '12x(30s on/30s off)' });
      } else {
        add(move.cardio, { sets: 1, time: 1200, rest: 0, notes: '20m steady' });
      }
      if (addCore) add(move.core1, { sets: 3, time: 30, rest: 45 });
      break;
    default:
      add(move.squat, rx('8–12'));
      add(move.push_h, rx('8–12'));
      add(move.pull_h, rx('8–12'));
      if (addCore) add(move.core1, { sets: 3, time: 30, rest: 45 });
  }
  return list;
}

async function fetchPlanById(planId, userId) {
  const pool = await poolPromise;

  const p = await pool.request()
    .input('id', sql.Int, planId)
    .input('uid', sql.Int, userId)
    .query(`
      SELECT TOP(1)
        Id, UserId, Title, Goal, DaysPerWeek, MinutesPerSession, Equipment, Level,
        AddCardio, AddCore, AddMobility, CreatedAt
      FROM dbo.Workout_Plans
      WHERE Id=@id AND UserId=@uid
    `);
  if (!p.recordset.length) return null;

  const plan = p.recordset[0];

  const days = await pool.request()
    .input('PlanId', sql.Int, planId)
    .query(`
      SELECT Id, PlanId, DayOrder, Focus, Warmup, Cooldown
      FROM dbo.Workout_Plan_Days
      WHERE PlanId=@PlanId
      ORDER BY DayOrder ASC
    `);

  const dayRows = days.recordset;
  const dayIds = dayRows.map(d => d.Id);
  let exRows = [];
  if (dayIds.length) {
    const inList = dayIds.join(',');
    const ex = await pool.request().query(`
      SELECT Id, DayId, Seq, ExerciseName, Sets, RepsOrTime, RestSec, Notes
      FROM dbo.Workout_Plan_Exercises
      WHERE DayId IN (${inList})
      ORDER BY DayId ASC, Seq ASC
    `);
    exRows = ex.recordset;
  }

  const dayWithExercises = dayRows.map(d => ({
    id: d.Id,
    dayOrder: d.DayOrder,
    focus: d.Focus,
    warmup: d.Warmup,
    cooldown: d.Cooldown,
    exercises: exRows.filter(x => x.DayId === d.Id).map(x => ({
      id: x.Id,
      seq: x.Seq,
      name: x.ExerciseName,
      sets: x.Sets,
      repsOrTime: x.RepsOrTime,
      restSec: x.RestSec,
      notes: x.Notes,
    })),
  }));

  return {
    id: plan.Id,
    title: plan.Title,
    createdAt: plan.CreatedAt,
    goal: plan.Goal,
    daysPerWeek: plan.DaysPerWeek,
    minutesPerSession: plan.MinutesPerSession,
    equipment: plan.Equipment,
    level: plan.Level,
    addCardio: plan.AddCardio,
    addCore: plan.AddCore,
    addMobility: plan.AddMobility,
    days: dayWithExercises,
  };
}

app.post('/api/workout/plan', requireAuth, async (req, res) => {
  const prefs = req.body || {};
  try {
    validatePrefs(prefs);

    const pool = await poolPromise;
    const tx = new sql.Transaction(pool);
    await tx.begin();

    try {
      const title = deriveTitleFromPrefs(prefs);

      const planReq = new sql.Request(tx);
      planReq
        .input('UserId', sql.Int, req.user.id)
        .input('Title', sql.NVarChar(120), title)
        .input('Goal', sql.NVarChar(32), prefs.goal)
        .input('DaysPerWeek', sql.TinyInt, prefs.daysPerWeek)
        .input('MinutesPerSession', sql.SmallInt, prefs.minutesPerSession)
        .input('Equipment', sql.NVarChar(16), prefs.equipment)
        .input('Level', sql.NVarChar(16), prefs.level)
        .input('AddCardio', sql.Bit, prefs.addCardio ? 1 : 0)
        .input('AddCore', sql.Bit, prefs.addCore ? 1 : 0)
        .input('AddMobility', sql.Bit, prefs.addMobility ? 1 : 0);

      const planIns = await planReq.query(`
        INSERT INTO dbo.Workout_Plans
        (UserId, Title, Goal, DaysPerWeek, MinutesPerSession, Equipment, Level, AddCardio, AddCore, AddMobility)
        OUTPUT inserted.Id, inserted.CreatedAt
        VALUES (@UserId, @Title, @Goal, @DaysPerWeek, @MinutesPerSession, @Equipment, @Level, @AddCardio, @AddCore, @AddMobility)
      `);

      const planId = planIns.recordset[0].Id;

      const days = buildPlanStructure(prefs);
      for (const d of days) {
        const dayReq = new sql.Request(tx);
        dayReq
          .input('PlanId', sql.Int, planId)
          .input('DayOrder', sql.TinyInt, d.dayOrder)
          .input('Focus', sql.NVarChar(64), d.focus)
          .input('Warmup', sql.NVarChar(255), d.warmup)
          .input('Cooldown', sql.NVarChar(255), d.cooldown);

        const dayIns = await dayReq.query(`
          INSERT INTO dbo.Workout_Plan_Days
            (PlanId, DayOrder, Focus, Warmup, Cooldown)
          OUTPUT inserted.Id
          VALUES (@PlanId, @DayOrder, @Focus, @Warmup, @Cooldown)
        `);

        const dayId = dayIns.recordset[0].Id;
        const exs = buildExercisesForDay(d.focus, prefs);

        let seq = 1;
        for (const ex of exs) {
          const exReq = new sql.Request(tx);
          exReq
            .input('DayId', sql.Int, dayId)
            .input('Seq', sql.TinyInt, seq++)
            .input('ExerciseName', sql.NVarChar(100), ex.ExerciseName)
            .input('Sets', sql.SmallInt, ex.Sets ?? null)
            .input('RepsOrTime', sql.NVarChar(32), ex.RepsOrTime ?? null)
            .input('RestSec', sql.SmallInt, ex.RestSec ?? null)
            .input('Notes', sql.NVarChar(255), ex.Notes ?? null);

          await exReq.query(`
            INSERT INTO dbo.Workout_Plan_Exercises
              (DayId, Seq, ExerciseName, Sets, RepsOrTime, RestSec, Notes)
            VALUES (@DayId, @Seq, @ExerciseName, @Sets, @RepsOrTime, @RestSec, @Notes)
          `);
        }
      }

      await tx.commit();
      const plan = await fetchPlanById(planId, req.user.id);
      return res.json(plan);
    } catch (err) {
      await tx.rollback();
      throw err;
    }
  } catch (err) {
    console.error('POST /api/workout/plan error', err);
    res.status(400).json({ error: err.message || 'bad request' });
  }
});

app.get('/api/workout/plan/latest', requireAuth, async (req, res) => {
  try {
    const pool = await poolPromise;
    const r = await pool.request()
      .input('uid', sql.Int, req.user.id)
      .query(`
        SELECT TOP(1) Id
        FROM dbo.Workout_Plans
        WHERE UserId=@uid
        ORDER BY CreatedAt DESC, Id DESC
      `);
    if (!r.recordset.length) return res.json(null);

    const planId = r.recordset[0].Id;
    const plan = await fetchPlanById(planId, req.user.id);
    res.json(plan);
  } catch (err) {
    console.error('GET /api/workout/plan/latest error', err);
    res.status(500).json({ error: 'server error' });
  }
});

app.get('/api/workout/plan/:id', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });

    const plan = await fetchPlanById(id, req.user.id);
    if (!plan) return res.status(404).json({ error: 'not found' });
    res.json(plan);
  } catch (err) {
    console.error('GET /api/workout/plan/:id error', err);
    res.status(500).json({ error: 'server error' });
  }
});

app.get('/api/workout/plans', requireAuth, async (req, res) => {
  try {
    const pool = await poolPromise;
    const rs = await pool.request()
      .input('uid', sql.Int, req.user.id)
      .query(`
        SELECT Id, Title, Goal, DaysPerWeek, MinutesPerSession, Equipment, Level, CreatedAt
        FROM dbo.Workout_Plans
        WHERE UserId=@uid
        ORDER BY CreatedAt DESC, Id DESC
      `);
    res.json(rs.recordset);
  } catch (err) {
    console.error('GET /api/workout/plans error', err);
    res.status(500).json({ error: 'server error' });
  }
});

app.delete('/api/workout/plan/:id', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });

    const pool = await poolPromise;
    const r = await pool.request()
      .input('id', sql.Int, id)
      .input('uid', sql.Int, req.user.id)
      .query(`DELETE FROM dbo.Workout_Plans WHERE Id=@id AND UserId=@uid`);

    if (r.rowsAffected[0] === 0) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/workout/plan/:id error', err);
    res.status(500).json({ error: 'server error' });
  }
});

/* =========================
   Admin APIs (ต้องเป็นแอดมิน)
   ========================= */
app.get('/api/admin/users', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const pool = await poolPromise;
    const rs = await pool.request().query(`
      SELECT id, username, email, first_name, last_name, gender, date_of_birth,
             ISNULL(is_admin,0) AS is_admin, ISNULL(is_active,1) AS is_active, created_at
      FROM dbo.users
      ORDER BY created_at DESC, id DESC
    `);
    res.json(rs.recordset);
  } catch (err) {
    console.error('GET /api/admin/users error', err);
    res.status(500).json({ error: 'server error' });
  }
});

// อ่านข้อมูลผู้ใช้เดี่ยว
app.get('/api/admin/users/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });

    const pool = await poolPromise;
    const rs = await pool.request()
      .input('id', sql.Int, id)
      .query(`
        SELECT id, username, email, first_name, last_name, gender, date_of_birth,
               ISNULL(is_admin,0) AS is_admin, ISNULL(is_active,1) AS is_active, created_at
        FROM dbo.users WHERE id=@id
      `);
    if (!rs.recordset.length) return res.status(404).json({ error: 'not found' });
    res.json(rs.recordset[0]);
  } catch (err) {
    console.error('GET /api/admin/users/:id error', err);
    res.status(500).json({ error: 'server error' });
  }
});

app.put('/api/admin/users/:id/active', requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { is_active } = req.body || {};
    if (!Number.isFinite(id) || typeof is_active !== 'boolean') {
      return res.status(400).json({ error: 'invalid payload' });
    }

    const pool = await poolPromise;
    const r = await pool.request()
      .input('id', sql.Int, id)
      .input('active', sql.Bit, is_active ? 1 : 0)
      .query(`UPDATE dbo.users SET is_active=@active WHERE id=@id`);

    if (r.rowsAffected[0] === 0) return res.status(404).json({ error: 'not found' });

    // audit
    await pool.request()
      .input('ActorUserId', sql.Int, req.user.id)
      .input('TargetUserId', sql.Int, id)
      .input('Action', sql.NVarChar(64), 'USER_SET_ACTIVE')
      .input('Detail', sql.NVarChar(4000), JSON.stringify({ is_active }))
      .query(`
        IF OBJECT_ID('dbo.Admin_Audit_Log','U') IS NOT NULL
          INSERT INTO dbo.Admin_Audit_Log (ActorUserId, TargetUserId, Action, Detail)
          VALUES (@ActorUserId, @TargetUserId, @Action, @Detail)
      `);

    res.json({ ok: true });
  } catch (err) {
    console.error('PUT /api/admin/users/:id/active error', err);
    res.status(500).json({ error: 'server error' });
  }
});

app.put('/api/admin/users/:id/admin', requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { is_admin } = req.body || {};
    if (!Number.isFinite(id) || typeof is_admin !== 'boolean') {
      return res.status(400).json({ error: 'invalid payload' });
    }

    const pool = await poolPromise;
    const r = await pool.request()
      .input('id', sql.Int, id)
      .input('admin', sql.Bit, is_admin ? 1 : 0)
      .query(`UPDATE dbo.users SET is_admin=@admin WHERE id=@id`);

    if (r.rowsAffected[0] === 0) return res.status(404).json({ error: 'not found' });

    await pool.request()
      .input('ActorUserId', sql.Int, req.user.id)
      .input('TargetUserId', sql.Int, id)
      .input('Action', sql.NVarChar(64), 'USER_SET_ADMIN')
      .input('Detail', sql.NVarChar(4000), JSON.stringify({ is_admin }))
      .query(`
        IF OBJECT_ID('dbo.Admin_Audit_Log','U') IS NOT NULL
          INSERT INTO dbo.Admin_Audit_Log (ActorUserId, TargetUserId, Action, Detail)
          VALUES (@ActorUserId, @TargetUserId, @Action, @Detail)
      `);

    res.json({ ok: true });
  } catch (err) {
    console.error('PUT /api/admin/users/:id/admin error', err);
    res.status(500).json({ error: 'server error' });
  }
});

app.post('/api/admin/users/:id/force-logout', requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });

    // kill sessions of that user
    for (const [tok, uid] of Array.from(sessions.entries())) {
      if (uid === id) sessions.delete(tok);
    }

    const pool = await poolPromise;
    await pool.request()
      .input('ActorUserId', sql.Int, req.user.id)
      .input('TargetUserId', sql.Int, id)
      .input('Action', sql.NVarChar(64), 'FORCE_LOGOUT')
      .input('Detail', sql.NVarChar(4000), null)
      .query(`
        IF OBJECT_ID('dbo.Admin_Audit_Log','U') IS NOT NULL
          INSERT INTO dbo.Admin_Audit_Log (ActorUserId, TargetUserId, Action, Detail)
          VALUES (@ActorUserId, @TargetUserId, @Action, @Detail)
      `);

    res.json({ ok: true });
  } catch (err) {
    console.error('POST /api/admin/users/:id/force-logout error', err);
    res.status(500).json({ error: 'server error' });
  }
});

app.get('/api/admin/audit-log', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const pool = await poolPromise;
    const rs = await pool.request().query(`
      IF OBJECT_ID('dbo.Admin_Audit_Log','U') IS NULL
        SELECT CAST(NULL AS INT) AS Id, CAST(NULL AS INT) AS ActorUserId, CAST(NULL AS INT) AS TargetUserId,
               CAST(NULL AS NVARCHAR(64)) AS Action, CAST(NULL AS NVARCHAR(4000)) AS Detail,
               CAST(NULL AS DATETIME2(3)) AS CreatedAt
      ELSE
        SELECT TOP(200) * FROM dbo.Admin_Audit_Log ORDER BY CreatedAt DESC, Id DESC
    `);
    res.json(rs.recordset.filter(r => r && r.Id)); // remove null row if any
  } catch (err) {
    console.error('GET /api/admin/audit-log error', err);
    res.status(500).json({ error: 'server error' });
  }
});

/* =========================
   AI: แนะนำอาหาร (External providers)
   ตัวเลือก .env:
   - ใช้โมเดลจำลอง (ไม่เรียกภายนอก):
       EXTERNAL_MODEL=off
   - OpenAI-compatible API (เช่น OpenAI):
       EXTERNAL_MODEL=on
       MODEL_PROVIDER=openai
       MODEL_BASE_URL=https://api.openai.com/v1
       MODEL_API_KEY=sk-xxxx
       MODEL_NAME=gpt-4o-mini
   - Google Gemini (Generative Language API):
       EXTERNAL_MODEL=on
       MODEL_PROVIDER=gemini
       GEMINI_API_BASE=https://generativelanguage.googleapis.com/v1beta
       GEMINI_API_KEY=AIza...
       GEMINI_MODEL=gemini-2.5-flash
   ========================= */
const useExternalModel = String(process.env.EXTERNAL_MODEL || '').toLowerCase() === 'on';
const MODEL_PROVIDER  = String(process.env.MODEL_PROVIDER || 'openai').toLowerCase();

// OpenAI-compatible
const MODEL_BASE_URL = (process.env.MODEL_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
const MODEL_API_KEY  = process.env.MODEL_API_KEY  || '';
const MODEL_NAME     = process.env.MODEL_NAME     || 'gpt-4o-mini';

// Gemini
const GEMINI_API_BASE = (process.env.GEMINI_API_BASE || 'https://generativelanguage.googleapis.com/v1').replace(/\/$/, '');
const GEMINI_API_KEY  = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL    = process.env.GEMINI_MODEL   || 'gemini-2.5-flash';
const GEMINI_MAX_OUTPUT_TOKENS = Number(process.env.GEMINI_MAX_OUTPUT_TOKENS || 4096);

// AI behavior tuning
const AI_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS || 120000);
const AI_RETRY_MAX = Number(process.env.AI_RETRY_MAX || 3);
const AI_AUTO_CONTINUE_MAX_ROUNDS = Number(process.env.AI_AUTO_CONTINUE_MAX_ROUNDS || 1);
const AI_FALLBACK_ON_ERROR = String(process.env.AI_FALLBACK_ON_ERROR || 'off').toLowerCase() === 'on';
const AI_DEBUG = String(process.env.AI_DEBUG || 'off').toLowerCase() === 'on';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

if (AI_DEBUG) {
  console.log('[ai-config]', {
    EXTERNAL_MODEL: useExternalModel ? 'on' : 'off',
    MODEL_PROVIDER,
    GEMINI_API_BASE,
    GEMINI_MODEL,
    AI_TIMEOUT_MS,
    AI_RETRY_MAX,
    AI_FALLBACK_ON_ERROR: AI_FALLBACK_ON_ERROR ? 'on' : 'off',
  });
}

async function callOpenAICompatible(messages, temperature = 0.7) {
  if (!useExternalModel) {
    // fallback mock (no external call)
    return {
      choices: [{
        message: {
          content:
`เมนูที่เหมาะกับคุณวันนี้:
• ข้าวกล้อง + อกไก่ย่าง + สลัดผักน้ำใส
• โยเกิร์ตไขมันต่ำ + ผลไม้รวม
• ดื่มน้ำ 2 ลิตร และเดินเร็ว 20 นาทีหลังอาหารเที่ยง`
        }
      }]
    };
  }

  if (MODEL_PROVIDER === 'gemini') {
    // Collapse messages into a single prompt for Gemini
    const sysText = messages.filter(m => m?.role === 'system').map(m => String(m?.content || '').trim()).filter(Boolean).join('\n');
    const userText = messages.filter(m => m?.role !== 'system').map(m => String(m?.content || '').trim()).filter(Boolean).join('\n\n');
    const combined = [sysText, userText].filter(Boolean).join('\n\n');

    const base = (GEMINI_API_BASE || '').replace(/\/$/, '');
    // Use exactly the configured API version (v1 or v1beta) to avoid 404s
    const bases = [base];

    const variants = (() => {
      const v = [];
      const m = String(GEMINI_MODEL || 'gemini-2.5-flash');
      v.push(m);
      // Avoid "-latest"; only use model IDs that exist for your account
      // If 2.5 is not available in this account/region, fall back to 1.5-flash
      if (m.startsWith('gemini-2.5-flash')) v.push('gemini-1.5-flash');
      // Try known-good models only (no "pro" variants here)
      v.push('gemini-2.5-flash', 'gemini-1.5-flash');
      return Array.from(new Set(v));
    })();

    const body = {
      contents: [ { role: 'user', parts: [ { text: combined } ] } ],
      generationConfig: { temperature, maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS }
    };

    let lastError = null;
    for (const b of bases) {
      for (const model of variants) {
        const url = `${b}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;
        for (let attempt = 0; attempt <= AI_RETRY_MAX; attempt++) {
          try {
            const { data } = await axios.post(url, body, { headers: { 'Content-Type': 'application/json' }, timeout: AI_TIMEOUT_MS });
            let text = Array.isArray(data?.candidates)
              ? (data.candidates[0]?.content?.parts || []).map(p => p?.text || '').join(' ').trim()
              : '';
            let finishReason = data?.candidates?.[0]?.finishReason || '';
            const blockReason = data?.promptFeedback?.blockReason || '';

            // Auto-continue if hit MAX_TOKENS and we have some partial text
            if (finishReason === 'MAX_TOKENS' && text && AI_AUTO_CONTINUE_MAX_ROUNDS > 0) {
              let acc = text;
              let rounds = 0;
              for (; rounds < AI_AUTO_CONTINUE_MAX_ROUNDS; rounds++) {
                const contBody = {
                  contents: [
                    { role: 'user', parts: [ { text: combined } ] },
                    { role: 'model', parts: [ { text: acc } ] },
                    { role: 'user', parts: [ { text: 'โปรดเขียนต่อจากคำตอบก่อนหน้าในรูปแบบเดิม อย่าซ้ำสิ่งที่ส่งไปแล้ว' } ] },
                  ],
                  generationConfig: { temperature, maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS }
                };
                try {
                  const { data: cont } = await axios.post(url, contBody, { headers: { 'Content-Type': 'application/json' }, timeout: AI_TIMEOUT_MS });
                  const piece = Array.isArray(cont?.candidates)
                    ? (cont.candidates[0]?.content?.parts || []).map(p => p?.text || '').join(' ').trim()
                    : '';
                  const f = cont?.candidates?.[0]?.finishReason || '';
                  if (piece) acc += (acc ? '\n' : '') + piece;
                  finishReason = f || finishReason;
                  if (f !== 'MAX_TOKENS') break;
                } catch (_) {
                  break; // keep what we have
                }
              }
              text = acc;
              return {
                choices: [ { message: { content: text } } ],
                _meta: { provider: 'gemini', model, url, finishReason, blockReason, continuedRounds: rounds }
              };
            }

            return {
              choices: [ { message: { content: text } } ],
              _meta: { provider: 'gemini', model, url, finishReason, blockReason, safetyRatings: data?.candidates?.[0]?.safetyRatings }
            };
          } catch (e) {
            lastError = e;
            const status = Number(e?.response?.status);
            if (status === 404) {
              // Try next model/base combo, no retries for 404
              break;
            }
            const retriable = [429, 500, 502, 503, 504].includes(status) || ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND'].includes(e?.code);
            if (retriable && attempt < AI_RETRY_MAX) {
              await sleep(500 * Math.pow(2, attempt) + Math.floor(Math.random() * 200));
              continue;
            }
            // Non-retriable: move on to next model/base
            break;
          }
        }
      }
    }

    if (AI_FALLBACK_ON_ERROR) {
      return {
        choices: [{ message: { content:
`เมนูที่เหมาะกับคุณวันนี้:
• ข้าวกล้อง + อกไก่ย่าง + สลัดผักน้ำใส
• โยเกิร์ตไขมันต่ำ + ผลไม้รวม
• ดื่มน้ำ 2 ลิตร และเดินเร็ว 20 นาทีหลังอาหารเที่ยง` } }]
      };
    }
    throw lastError || new Error('Gemini call failed');
  }

  // Default: OpenAI-compatible Chat Completions
  const base = (MODEL_BASE_URL || '').replace(/\/$/, '');
  const url = `${base}/chat/completions`;
  const headers = { Authorization: `Bearer ${MODEL_API_KEY}` };
  const body = { model: MODEL_NAME, messages, temperature, stream: false };
  for (let attempt = 0; attempt <= AI_RETRY_MAX; attempt++) {
    try {
      const { data } = await axios.post(url, body, { headers, timeout: AI_TIMEOUT_MS });
      return data;
    } catch (e) {
      const status = e?.response?.status;
      const retriable = [429, 500, 502, 503, 504].includes(Number(status)) || ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND'].includes(e?.code);
      if (retriable && attempt < AI_RETRY_MAX) {
        await sleep(500 * Math.pow(2, attempt) + Math.floor(Math.random() * 200));
        continue;
      }
      if (AI_FALLBACK_ON_ERROR) {
        return {
          choices: [{ message: { content:
`เมนูที่เหมาะกับคุณวันนี้:
• ข้าวกล้อง + อกไก่ย่าง + สลัดผักน้ำใส
• โยเกิร์ตไขมันต่ำ + ผลไม้รวม
• ดื่มน้ำ 2 ลิตร และเดินเร็ว 20 นาทีหลังอาหารเที่ยง` } }]
        };
      }
      throw e;
    }
  }
}

// จำกัดการเรียกสำหรับลืมอีเมล/ลืมรหัสผ่านแบบง่ายๆ
const forgotLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 นาที
  max: 5,              // 5 ครั้งต่อ IP ต่อ 1 นาที
  standardHeaders: true,
  legacyHeaders: false,
});

// ขอรีเซ็ตรหัสผ่านผ่านอีเมล (dev: log ลิงก์แทนการส่งอีเมลจริง)
app.post('/auth/forgot-password', forgotLimiter, async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim();
    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ error: 'กรุณากรอกอีเมลให้ถูกต้อง' });
    }

    const pool = await poolPromise;
    const rs = await pool.request()
      .input('email', sql.NVarChar, email)
      .query('SELECT TOP 1 id, username FROM dbo.users WHERE email=@email');

    // สร้าง token จำลองและ log ลิงก์ (เดโม่)
    const token = crypto.randomBytes(20).toString('hex');
    const host = (process.env.APP_PUBLIC_BASE_URL || `http://${req.get('host') || 'localhost:3000'}`);
    const resetLink = `${host.replace(/\/$/, '')}/reset-password?token=${token}`;
    console.log(`[forgot-password] email=${email}, user=${rs.recordset[0]?.username || '-'}, link=${resetLink}`);

    // ถ้าพบผู้ใช้: เก็บ token ลงฐานข้อมูลเพื่อใช้ยืนยันตอนตั้งรหัสใหม่
    if (rs.recordset.length) {
      const userId = rs.recordset[0].id;
      await insertResetToken(userId, token, req);
    }

    // ส่งอีเมลหากตั้งค่า SMTP แล้ว (หรือ Ethereal dev)
    const mail = await sendResetEmail(email, resetLink);

    // อย่าบอกว่ามี/ไม่มีบัญชี เพื่อลดการเดา
    // แสดงลิงก์เฉพาะโหมด dev หรือใช้ Ethereal เท่านั้น
    const devPreviewOn = String(process.env.DEV_MAIL_PREVIEW || 'off').toLowerCase() === 'on' || (mailerTest && mailerTest.usingEthereal);
    const resp = { ok: true, message: 'ถ้ามีบัญชี เราได้ส่งลิงก์รีเซ็ตไปที่อีเมลนี้แล้ว' };
    if (devPreviewOn) {
      resp.preview_url = mail?.previewUrl || resetLink;
      resp.reset_link = resetLink;
    }
    return res.json(resp);
  } catch (e) {
    console.error('POST /auth/forgot-password error', e);
    res.status(500).json({ error: 'server error' });
  }
});

// ลืมอีเมล: ให้ผู้ใช้กรอกชื่อผู้ใช้ แล้วแสดงอีเมลแบบปกปิดบางส่วน (ถ้ามี)
app.post('/auth/forgot-email', forgotLimiter, async (req, res) => {
  try {
    const username = String(req.body?.username || '').trim();
    if (!username) return res.status(400).json({ error: 'กรุณากรอกชื่อผู้ใช้' });

    const pool = await poolPromise;
    const rs = await pool.request()
      .input('username', sql.NVarChar, username)
      .query('SELECT TOP 1 email FROM dbo.users WHERE username=@username');

    const email = rs.recordset[0]?.email || '';
    const masked = email ? maskEmail(email) : undefined;
    return res.json({ ok: true, masked_email: masked });
  } catch (e) {
    console.error('POST /auth/forgot-email error', e);
    res.status(500).json({ error: 'server error' });
  }
});

// ค้นหาอีเมลจากข้อมูลโปรไฟล์ (first_name, last_name, date_of_birth)
app.post('/auth/forgot-email/by-profile', forgotLimiter, async (req, res) => {
  try {
    const first_name = String(req.body?.first_name || req.body?.firstName || '').trim();
    const last_name  = String(req.body?.last_name  || req.body?.lastName  || '').trim();
    const dobStr     = String(req.body?.date_of_birth || req.body?.dateOfBirth || '').trim();

    if (!first_name || !last_name || !dobStr) {
      return res.status(400).json({ error: 'กรุณากรอกชื่อ นามสกุล และวันเกิด' });
    }
    const dob = parseYMD(dobStr);
    if (!dob) return res.status(400).json({ error: 'รูปแบบวันเกิดไม่ถูกต้อง (YYYY-MM-DD)' });

    const pool = await poolPromise;
    const rs = await pool.request()
      .input('first_name', sql.NVarChar, first_name)
      .input('last_name',  sql.NVarChar, last_name)
      .input('dob',        sql.Date,     dob)
      .query('SELECT TOP 1 email FROM dbo.users WHERE first_name=@first_name AND last_name=@last_name AND date_of_birth=@dob');

    const email = rs.recordset[0]?.email || '';
    const masked = email ? maskEmail(email) : undefined;
    return res.json({ ok: true, masked_email: masked });
  } catch (e) {
    console.error('POST /auth/forgot-email/by-profile error', e);
    res.status(500).json({ error: 'server error' });
  }
});

/* =========================
   Reset Password pages (HTML minimal)
   ========================= */
function htmlPage(title, body) {
  return `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu; background:#0f172a; color:#e2e8f0; display:flex; justify-content:center; align-items:center; min-height:100vh;}
    .card{background:#111827; padding:24px; border-radius:16px; max-width:420px; width:92%; box-shadow:0 10px 30px rgba(0,0,0,.3)}
    h1{font-size:20px; margin:0 0 12px}
    p{opacity:.9}
    .row{margin:12px 0}
    input{width:100%; padding:12px 14px; border-radius:12px; border:1px solid #334155; background:#0b1220; color:#e2e8f0}
    button{width:100%; background:#6366f1; color:#fff; border:0; padding:12px 16px; border-radius:999px; font-weight:600; cursor:pointer}
    small{opacity:.7}
    .error{color:#fca5a5}
    .ok{color:#86efac}
    a{color:#93c5fd}
  </style>
  </head>
  <body>
    <div class="card">${body}</div>
  </body>
</html>`;
}

// (moved forgotLimiter definition above routes)

async function getValidResetToken(token) {
  return await findActiveResetToken(token);
}

app.get('/reset-password', async (req, res) => {
  try {
    const token = String(req.query?.token || '');
    const rec = await getValidResetToken(token);
    if (!rec) {
      return res.status(400).send(htmlPage('ลิงก์ไม่ถูกต้อง', `
        <h1>ลิงก์รีเซ็ตไม่ถูกต้องหรือหมดอายุ</h1>
        <p>โปรดลองขอรีเซ็ตใหม่อีกครั้งจากหน้าลืมรหัสผ่าน</p>
      `));
    }
    const body = `
      <h1>ตั้งรหัสผ่านใหม่</h1>
      <form method="POST" action="/reset-password">
        <input type="hidden" name="token" value="${token}" />
        <div class="row"><input type="password" name="password" placeholder="รหัสผ่านใหม่ (อย่างน้อย 6 ตัว)" required minlength="6" /></div>
        <div class="row"><input type="password" name="confirm" placeholder="ยืนยันรหัสผ่านใหม่" required minlength="6" /></div>
        <div class="row"><button type="submit">ยืนยัน</button></div>
        <small>ลิงก์นี้จะหมดอายุภายใน 30 นาที</small>
      </form>
    `;
    res.type('html').send(htmlPage('ตั้งรหัสผ่านใหม่', body));
  } catch (e) {
    res.status(500).send(htmlPage('เกิดข้อผิดพลาด', `<p class="error">server error</p>`));
  }
});

// รองรับ form-urlencoded จากแบบฟอร์ม HTML
const expressUrlencoded = express.urlencoded({ extended: true, limit: '10kb' });
app.post('/reset-password', expressUrlencoded, async (req, res) => {
  try {
    const token = String(req.body?.token || '');
    const password = String(req.body?.password || '');
    const confirm = String(req.body?.confirm || '');
    const rec = await getValidResetToken(token);
    if (!rec) return res.status(400).send(htmlPage('ลิงก์ไม่ถูกต้อง', `<p class="error">ลิงก์ไม่ถูกต้องหรือหมดอายุ</p>`));
    if (!password || password.length < 6) {
      return res.status(400).send(htmlPage('รหัสผ่านสั้นเกินไป', `<p class="error">รหัสผ่านอย่างน้อย 6 ตัว</p>`));
    }
    if (password !== confirm) {
      return res.status(400).send(htmlPage('ยืนยันรหัสไม่ตรงกัน', `<p class="error">กรุณากรอกให้ตรงกัน</p>`));
    }

    const hashed = await bcrypt.hash(password, 10);
    const pool = await poolPromise;
    await pool.request()
      .input('id', sql.Int, rec.user_id)
      .input('password', sql.NVarChar, hashed)
      .query('UPDATE dbo.users SET [password]=@password WHERE id=@id');

    await markResetTokenUsed(rec.id);
    res.type('html').send(htmlPage('สำเร็จ', `<h1 class="ok">ตั้งรหัสผ่านใหม่สำเร็จ</h1><p>คุณสามารถกลับไปเข้าสู่ระบบได้แล้ว</p>`));
  } catch (e) {
    console.error('POST /reset-password error', e);
    res.status(500).send(htmlPage('เกิดข้อผิดพลาด', `<p class="error">server error</p>`));
  }
});

// ส่งอีเมลทดสอบง่ายๆ (สำหรับ dev):
// POST /auth/send-test { to?: string }
app.post('/auth/send-test', async (req, res) => {
  try {
    const to = String(req.body?.to || process.env.TEST_MAIL_TO || SMTP_USER || GMAIL_USER || '').trim();
    if (!to) return res.status(400).json({ error: 'กรุณาระบุอีเมลผู้รับใน body.to หรือ TEST_MAIL_TO' });
    const host = (process.env.APP_PUBLIC_BASE_URL || `http://${req.get('host') || 'localhost:3000'}`);
    const link = `${host.replace(/\/$/, '')}/reset-password?token=${crypto.randomBytes(12).toString('hex')}`;
    const info = await sendResetEmail(to, link);
    return res.json({ ok: true, to, preview_url: info?.previewUrl, link });
  } catch (e) {
    console.error('POST /auth/send-test error', e);
    res.status(500).json({ error: 'server error' });
  }
});

app.post('/api/ai/meal-suggest', requireAuth, async (req, res) => {
  try {
    if (!useExternalModel) {
      if (AI_DEBUG) console.log('[/api/ai/meal-suggest] mock mode (EXTERNAL_MODEL=off)');
      const text = `เมนูที่เหมาะกับคุณวันนี้:\n• ข้าวกล้อง + อกไก่ย่าง + สลัดผักน้ำใส\n• โยเกิร์ตไขมันต่ำ + ผลไม้รวม\n• ดื่มน้ำ 2 ลิตร และเดินเร็ว 20 นาทีหลังอาหารเที่ยง`;
      return res.json({ ok: true, text });
    }
    const b = req.body || {};
    const mealsWanted = Number(b.meals) || 3;
    const dayKcal = Number(b.daily_kcal) || 2000;
    const activity = String(b.activity_level || '').trim();
    const goal = String(b.goal || '').trim();
    const weight = b.weight_kg ?? '';
    const height = b.height_cm ?? '';
    const diet = String(b.diet || '').trim();
    const avoid = String(b.avoid || '').trim();
    const cuisineType = String(b.cuisine_type || '').trim();
    const maxTime = Number(b.max_cooking_time) || '';
    const budget = String(b.budget || '').trim();
    const includeIngredients = String(b.include_ingredients || '').trim();
    const mealTiming = Array.isArray(b.meal_timing) ? b.meal_timing : [];
    const up = b.user_preferences || {};
    const med = Array.isArray(up.medicalConditions) ? up.medicalConditions : [];
    const fav = Array.isArray(up.favoriteCuisines) ? up.favoriteCuisines : [];
    const cookingSkill = String(up.cookingSkill || '').trim();
    const weeklyPlan = Boolean(b.weekly_plan);
    const generateShopping = Boolean(b.generate_shopping_list);

    const constraints = [
      `แคลอรี่รวมต่อวันประมาณ ${dayKcal} kcal`,
      mealsWanted ? `จำนวนมื้อ ${mealsWanted} มื้อ/วัน` : '',
      diet ? `สไตล์อาหาร: ${diet}` : '',
      cuisineType ? `ประเภทอาหาร: ${cuisineType}` : '',
      avoid ? `หลีกเลี่ยง: ${avoid}` : '',
      includeIngredients ? `ควรมี: ${includeIngredients}` : '',
      maxTime ? `เวลาทำอาหารต่อมื้อไม่เกิน ${maxTime} นาที` : '',
      budget ? `งบประมาณ: ${budget}` : '',
      cookingSkill ? `ทักษะการทำอาหาร: ${cookingSkill}` : '',
      med.length ? `เงื่อนไขสุขภาพ: ${med.join(', ')}` : '',
      fav.length ? `ชอบอาหาร: ${fav.join(', ')}` : '',
      mealTiming.length ? `ช่วงมื้อ: ${mealTiming.join(', ')}` : '',
    ].filter(Boolean).join('\n• ');

    const profilePrompt = `คุณเป็นโค้ชโภชนาการ พูดไทยล้วน สั้น กระชับ
ผู้ใช้: เพศ ${req.user.gender||'-'}, เกิด ${req.user.date_of_birth||'-'}
โปรไฟล์ล่าสุด (ถ้ามี): activity=${activity||'-'}, goal=${goal||'-'}, น้ำหนัก=${weight||'-'}kg, ส่วนสูง=${height||'-'}cm
ข้อกำหนด:
• ${constraints}
งานที่ต้องทำ: ${weeklyPlan ? 'สร้างแผนอาหารรายสัปดาห์ (7 วัน)' : `แนะนำรายการอาหารสำหรับ 1 วัน`}
รูปแบบผลลัพธ์: bullet ภาษาไทย, ระบุ kcal ต่อเมนูโดยประมาณ, เคล็ดลับสั้น 1–2 บรรทัดท้ายสุด${generateShopping ? ', และตามด้วยหัวข้อ "รายการซื้อของ" สรุปวัตถุดิบที่ต้องใช้' : ''}`;

    const messages = [
      { role: 'system', content: 'คุณคือผู้ช่วยด้านโภชนาการที่เน้นความปลอดภัย ใช้ภาษาไทย' },
      { role: 'user', content: profilePrompt }
    ];

    const data = await callOpenAICompatible(messages, 0.6);
    const meta = data?._meta || {};
    const text = String(data?.choices?.[0]?.message?.content || '').trim();
    // Treat non-text/blocked/unfinished as failure with explicit reason
    if (meta?.blockReason) {
      return res.json({ ok: false, error: { reason: 'BLOCKED', blockReason: meta.blockReason } });
    }
    // Special handling: return partial with canContinue when MAX_TOKENS
    if (String(meta?.finishReason) === 'MAX_TOKENS') {
      return res.json({ ok: false, error: { reason: 'NON_STOP_FINISH', finish: 'MAX_TOKENS' }, partialText: text, canContinue: true });
    }
    if (meta?.finishReason && String(meta.finishReason) !== 'STOP') {
      return res.json({ ok: false, error: { reason: 'NON_STOP_FINISH', finish: meta.finishReason } });
    }
    if (!text) {
      return res.json({ ok: false, error: { reason: 'EMPTY_OUTPUT' } });
    }
    res.json({ ok: true, text });
  } catch (err) {
    if (AI_FALLBACK_ON_ERROR) {
      // ลด noise: log เป็น warn แบบสั้น เมื่อมี fallback
      console.warn('POST /api/ai/meal-suggest fallback used');
      const fb = `เมนูที่เหมาะกับคุณวันนี้:
• ข้าวกล้อง + อกไก่ย่าง + สลัดผักน้ำใส
• โยเกิร์ตไขมันต่ำ + ผลไม้รวม
• ดื่มน้ำ 2 ลิตร และเดินเร็ว 20 นาทีหลังอาหารเที่ยง`;
      return res.json({ ok: true, text: fb });
    }
    // ไม่มี fallback: แสดง error รายละเอียดตามโหมด
    console.error('POST /api/ai/meal-suggest error', err?.response?.data || err.message);
    if (AI_DEBUG) {
      return res.status(Number(err?.response?.status) || 500).json({
        error: 'ai error',
        provider: MODEL_PROVIDER,
        detail: err?.response?.data || String(err?.message || err)
      });
    }
    res.status(500).json({ error: 'ai error' });
  }
});

// AI-assisted workout plan suggestions (text preview)
app.post('/api/ai/workout-suggest', requireAuth, async (req, res) => {
  try {
    // If external model is disabled, return a helpful default preview text
    if (!useExternalModel) {
      if (AI_DEBUG) console.log('[/api/ai/workout-suggest] mock mode (EXTERNAL_MODEL=off)');
      const text = `สรุปพรีวิวแผนฝึก (ตัวอย่าง):\n• Split: Full-Body x3 (45 นาที/ครั้ง)\n• เน้นเทคนิคพื้นฐาน + โมบิลิตี้ 5 นาที/วัน\n• วันตัวอย่าง: \n  - Day 1: Squat/Push/Pull + Plank \n  - Day 2: Hinge/Lunge/Row + Dead Bug \n  - Day 3: Push/Pull/Legs + Cardio 10 นาที\nข้อแนะนำ: รักษา RIR 1–3 เซ็ตท้าย ปรับเพิ่ม/ลดปริมาณตามความรู้สึก และนอนหลับให้เพียงพอ`;
      return res.json({ ok: true, text });
    }

    const p = req.body || {};
    const days = Number(p.daysPerWeek) || 3;
    const mins = Number(p.minutesPerSession) || 45;
    const equip = String(p.equipment || 'minimal');
    const level = String(p.level || 'beginner');
    const goal = String(p.goal || 'general_fitness');
    const addCardio = Boolean(p.addCardio);
    const addCore = Boolean(p.addCore);
    const addMobility = Boolean(p.addMobility);

    const injuries = Array.isArray(p.injuries) ? p.injuries : [];
    const restricted = Array.isArray(p.restrictedMoves) ? p.restrictedMoves : [];
    const intensity = String(p.intensityMode || '').trim();

    const constraints = [
      `วันต่อสัปดาห์: ${days}`,
      `เวลาต่อครั้ง: ${mins} นาที`,
      `อุปกรณ์: ${equip}`,
      `เลเวล: ${level}`,
      `เป้าหมาย: ${goal}`,
      addCardio ? 'เพิ่มคาร์ดิโอ' : '',
      addCore ? 'เพิ่ม Core' : '',
      addMobility ? 'เพิ่ม Mobility' : '',
      intensity ? `โหมดความหนัก: ${intensity} (ปรับ sets/reps/rest ให้เหมาะสม)` : '',
      injuries.length ? `อาการบาดเจ็บ: ${injuries.join(', ')}` : '',
      restricted.length ? `ท่าที่ควรเลี่ยง: ${restricted.join(', ')}` : ''
    ].filter(Boolean).join('\n• ');

    const profile = `เพศ ${req.user.gender || '-'} • เกิด ${req.user.date_of_birth || '-'}`;
    const prompt = `คุณเป็นโค้ชฟิตเนส พูดไทยสั้น กระชับ ชัดเจน\nโปรไฟล์ผู้ใช้: ${profile}\nข้อกำหนดแผน:\n• ${constraints}\nงาน: ออกแบบพรีวิวแผนฝึกตามสัปดาห์ โดยแจกแจงชื่อวัน (Day 1..), โฟกัสของวัน และท่าหลัก 3–5 ท่า/วัน พร้อมช่วงแนะนำ RIR/เวลาพักโดยย่อ และเคล็ดลับสั้นท้ายสุด 1–2 บรรทัด\nหมายเหตุ: หลีกเลี่ยงท่าที่กระทบอาการบาดเจ็บและ 'ท่าที่ควรเลี่ยง' โดยเลือกทางเลือกที่ปลอดภัยแทน\nรูปแบบผลลัพธ์: bullet ภาษาไทยที่อ่านง่าย ไม่ต้องใส่โค้ดหรือ JSON`;

    const messages = [
      { role: 'system', content: 'คุณคือผู้ช่วยโค้ชออกกำลังกายที่เน้นความปลอดภัยและความยั่งยืน ใช้ภาษาไทย' },
      { role: 'user', content: prompt }
    ];

    const data = await callOpenAICompatible(messages, 0.6);
    const meta = data?._meta || {};
    const text = String(data?.choices?.[0]?.message?.content || '').trim();

    if (meta?.blockReason) {
      return res.json({ ok: false, error: { reason: 'BLOCKED', blockReason: meta.blockReason } });
    }
    if (String(meta?.finishReason) === 'MAX_TOKENS') {
      return res.json({ ok: false, error: { reason: 'NON_STOP_FINISH', finish: meta.finishReason }, partialText: text, canContinue: true });
    }
    if (meta?.finishReason && String(meta.finishReason) !== 'STOP') {
      return res.json({ ok: false, error: { reason: 'NON_STOP_FINISH', finish: meta.finishReason } });
    }
    if (!text) {
      return res.json({ ok: false, error: { reason: 'EMPTY_OUTPUT' } });
    }
    return res.json({ ok: true, text });
  } catch (err) {
    if (AI_FALLBACK_ON_ERROR) {
      console.warn('POST /api/ai/workout-suggest fallback used');
      const fb = `สรุปพรีวิวแผนฝึก (โหมดออฟไลน์):\n• Full-Body x3 (45 นาที) + Core/คาร์ดิโอตามเหมาะสม\n• Day 1: Squat/Push/Pull + Plank\n• Day 2: Hinge/Lunge/Row + Dead Bug\n• Day 3: Push/Pull/Legs + Cardio 10 นาที\nคำแนะนำ: เริ่มเบาๆ เพิ่มปริมาณทีละน้อย เน้นฟอร์มและการพักผ่อนให้พอ`; 
      return res.json({ ok: true, text: fb });
    }
    console.error('POST /api/ai/workout-suggest error', err?.response?.data || err?.message || err);
    return res.status(500).json({ error: 'ai error' });
  }
});

// Create a structured workout plan using AI and persist to DB
// Request: same prefs as /api/workout/plan
// Response: same shape as /api/workout/plan (includes ids)
app.post('/api/ai/workout-plan', requireAuth, async (req, res) => {
  const prefs = req.body || {};
  try {
    validatePrefs(prefs);

    // Helper: safe string with max length
    const safeStr = (v, max) => {
      const s = (v == null) ? '' : String(v);
      return s.length > max ? s.slice(0, max) : s;
    };

    // Build prompt requiring strict JSON
    const injuries = Array.isArray(prefs.injuries) ? prefs.injuries : [];
    const restricted = Array.isArray(prefs.restrictedMoves) ? prefs.restrictedMoves : [];
    const intensity = String(prefs.intensityMode || '').trim();

    const constraints = [
      `วัน/สัปดาห์: ${prefs.daysPerWeek}`,
      `เวลา/ครั้ง: ${prefs.minutesPerSession} นาที`,
      `อุปกรณ์: ${prefs.equipment}`,
      `เลเวล: ${prefs.level}`,
      `เป้าหมาย: ${prefs.goal}`,
      prefs.addCardio ? 'เพิ่มคาร์ดิโอ' : '',
      prefs.addCore ? 'เพิ่ม Core' : '',
      prefs.addMobility ? 'เพิ่ม Mobility' : '',
      intensity ? `โหมดความหนัก: ${intensity} (กำหนดเรป/พัก/จำนวนเซ็ตตามโหมด)` : '',
      injuries.length ? `อาการบาดเจ็บ: ${injuries.join(', ')}` : '',
      restricted.length ? `ท่าที่ควรเลี่ยง: ${restricted.join(', ')}` : '',
    ].filter(Boolean).join('\n• ');

    const profile = `เพศ ${req.user.gender || '-'} • เกิด ${req.user.date_of_birth || '-'}`;
    const sys = 'คุณคือโค้ชออกกำลังกายที่ให้คำแนะนำปลอดภัยและยั่งยืน ใช้ภาษาไทย';
    const user = `โปรไฟล์ผู้ใช้: ${profile}\nข้อกำหนด:\n• ${constraints}\n\nงาน: สร้างแผนฝึกรายสัปดาห์แบบ JSON เท่านั้น ไม่ใส่คำอธิบายอื่นนอกจาก JSON โดยมีโครงสร้างดังนี้:\n{\n  "title": "string ไทยสั้นกระชับ",\n  "progression": ["string"...],\n  "deloadAdvice": "string",\n  "days": [\n    {\n      "dayOrder": 1,\n      "focus": "Full-Body|Upper|Lower|Push|Pull|Legs|Conditioning",\n      "warmup": "string",\n      "cooldown": "string",\n      "exercises": [\n        {"name": "string", "sets": 3, "repsOrTime": "8–12", "restSec": 60, "notes": "RIR 1–2"}\n      ]\n    }\n  ]\n}\nเงื่อนไข: สร้างตามจำนวนวัน ${prefs.daysPerWeek} วัน และเวลาต่อครั้ง ${prefs.minutesPerSession} นาที โดยประมาณ\nหมายเหตุ: หลีกเลี่ยงท่าที่กระทบอาการบาดเจ็บ/รายการที่ควรเลี่ยง หากจำเป็นให้เลือกทางเลือกที่ปลอดภัย และปรับเรป/พัก/จำนวนเซ็ตตามโหมดความหนัก`;

    let aiPlan = null;
    try {
      const data = await callOpenAICompatible([
        { role: 'system', content: sys },
        { role: 'user', content: user },
      ], 0.6);
      let text = String(data?.choices?.[0]?.message?.content || '').trim();
      // Try to extract JSON from code fences if present
      const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
      if (fence) text = fence[1].trim();
      try {
        aiPlan = JSON.parse(text);
      } catch (_) {
        // Try to find first {...}
        const m = text.match(/\{[\s\S]*\}/);
        if (m) aiPlan = JSON.parse(m[0]);
      }
    } catch (e) {
      if (AI_DEBUG) console.warn('[ai-workout-plan] parse or call error:', e?.message || e);
    }

    // Fallback to deterministic structure if AI failed
    let days;
    let title = deriveTitleFromPrefs(prefs);
    let progression = [];
    let deloadAdvice = null;

    if (aiPlan && Array.isArray(aiPlan.days) && aiPlan.days.length) {
      // Normalize AI days
      const normDays = [];
      for (let i = 0; i < aiPlan.days.length; i++) {
        const d = aiPlan.days[i] || {};
        const order = Number(d.dayOrder || (d.day && String(d.day).match(/(\d+)/)?.[1]) || (i + 1));
        const focus = safeStr(d.focus || 'Full-Body', 64);
        const warmup = safeStr(d.warmup || '5–8m warm-up + dynamic mobility', 255);
        const cooldown = safeStr(d.cooldown || '3–5m cooldown & stretching', 255);
        const exIn = Array.isArray(d.exercises) ? d.exercises : [];
        const exs = [];
        let seq = 1;
        for (const ex of exIn) {
          const name = safeStr(ex?.name || '', 100);
          if (!name) continue;
          const sets = (ex?.sets != null && Number.isFinite(Number(ex.sets))) ? Number(ex.sets) : null;
          const rt = ex?.repsOrTime != null ? String(ex.repsOrTime) : (ex?.reps != null ? String(ex.reps) : (ex?.timeSec != null ? `${Number(ex.timeSec)}s` : null));
          const repsOrTime = rt ? safeStr(rt, 32) : null;
          const restSec = (ex?.restSec != null && Number.isFinite(Number(ex.restSec))) ? Number(ex.restSec) : (ex?.rest != null && Number.isFinite(Number(ex.rest)) ? Number(ex.rest) : null);
          const notes = ex?.notes != null ? safeStr(ex.notes, 255) : null;
          exs.push({ seq: seq++, name, sets, repsOrTime, restSec, notes });
        }
        normDays.push({ dayOrder: order, focus, warmup, cooldown, exercises: exs });
      }
      // Ensure correct number of days
      days = normDays.slice(0, Number(prefs.daysPerWeek));
      if (days.length < Number(prefs.daysPerWeek)) {
        const fill = buildPlanStructure(prefs);
        while (days.length < Number(prefs.daysPerWeek) && fill[days.length]) {
          const d = fill[days.length];
          const exs = buildExercisesForDay(d.focus, prefs).map((e, idx) => ({
            seq: idx + 1,
            name: e.ExerciseName,
            sets: e.Sets ?? null,
            repsOrTime: e.RepsOrTime ?? null,
            restSec: e.RestSec ?? null,
            notes: e.Notes ?? null,
          }));
          days.push({ dayOrder: d.dayOrder, focus: d.focus, warmup: d.warmup, cooldown: d.cooldown, exercises: exs });
        }
      }
      if (aiPlan.title) title = safeStr(aiPlan.title, 120);
      if (Array.isArray(aiPlan.progression)) progression = aiPlan.progression.map(x => safeStr(x, 255));
      if (aiPlan.deloadAdvice) deloadAdvice = safeStr(aiPlan.deloadAdvice, 255);
    } else {
      // Deterministic fallback
      const baseDays = buildPlanStructure(prefs);
      days = baseDays.map(d => {
        const exs = buildExercisesForDay(d.focus, prefs).map((e, idx) => ({
          seq: idx + 1,
          name: e.ExerciseName,
          sets: e.Sets ?? null,
          repsOrTime: e.RepsOrTime ?? null,
          restSec: e.RestSec ?? null,
          notes: e.Notes ?? null,
        }));
        return { dayOrder: d.dayOrder, focus: d.focus, warmup: d.warmup, cooldown: d.cooldown, exercises: exs };
      });
    }

    // Persist plan into DB (similar to /api/workout/plan)
    const pool = await poolPromise;
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      const planReq = new sql.Request(tx);
      planReq
        .input('UserId', sql.Int, req.user.id)
        .input('Title', sql.NVarChar(120), title)
        .input('Goal', sql.NVarChar(32), prefs.goal)
        .input('DaysPerWeek', sql.TinyInt, prefs.daysPerWeek)
        .input('MinutesPerSession', sql.SmallInt, prefs.minutesPerSession)
        .input('Equipment', sql.NVarChar(16), prefs.equipment)
        .input('Level', sql.NVarChar(16), prefs.level)
        .input('AddCardio', sql.Bit, prefs.addCardio ? 1 : 0)
        .input('AddCore', sql.Bit, prefs.addCore ? 1 : 0)
        .input('AddMobility', sql.Bit, prefs.addMobility ? 1 : 0);

      const planIns = await planReq.query(`
        INSERT INTO dbo.Workout_Plans
        (UserId, Title, Goal, DaysPerWeek, MinutesPerSession, Equipment, Level, AddCardio, AddCore, AddMobility)
        OUTPUT inserted.Id, inserted.CreatedAt
        VALUES (@UserId, @Title, @Goal, @DaysPerWeek, @MinutesPerSession, @Equipment, @Level, @AddCardio, @AddCore, @AddMobility)
      `);
      const planId = planIns.recordset[0].Id;

      for (const d of days) {
        const dayReq = new sql.Request(tx);
        dayReq
          .input('PlanId', sql.Int, planId)
          .input('DayOrder', sql.TinyInt, d.dayOrder)
          .input('Focus', sql.NVarChar(64), d.focus)
          .input('Warmup', sql.NVarChar(255), d.warmup ?? null)
          .input('Cooldown', sql.NVarChar(255), d.cooldown ?? null);
        const dayIns = await dayReq.query(`
          INSERT INTO dbo.Workout_Plan_Days (PlanId, DayOrder, Focus, Warmup, Cooldown)
          OUTPUT inserted.Id
          VALUES (@PlanId, @DayOrder, @Focus, @Warmup, @Cooldown)
        `);
        const dayId = dayIns.recordset[0].Id;

        let seq = 1;
        for (const ex of (d.exercises || [])) {
          const exReq = new sql.Request(tx);
          exReq
            .input('DayId', sql.Int, dayId)
            .input('Seq', sql.TinyInt, Number(ex.seq || seq++))
            .input('ExerciseName', sql.NVarChar(100), safeStr(ex.name || '', 100))
            .input('Sets', sql.SmallInt, ex.sets != null ? Number(ex.sets) : null)
            .input('RepsOrTime', sql.NVarChar(32), ex.repsOrTime ? safeStr(ex.repsOrTime, 32) : null)
            .input('RestSec', sql.SmallInt, ex.restSec != null ? Number(ex.restSec) : null)
            .input('Notes', sql.NVarChar(255), ex.notes ? safeStr(ex.notes, 255) : null);
          await exReq.query(`
            INSERT INTO dbo.Workout_Plan_Exercises (DayId, Seq, ExerciseName, Sets, RepsOrTime, RestSec, Notes)
            VALUES (@DayId, @Seq, @ExerciseName, @Sets, @RepsOrTime, @RestSec, @Notes)
          `);
        }
      }

      await tx.commit();
      const plan = await fetchPlanById(planId, req.user.id);
      return res.json(plan);
    } catch (e) {
      await tx.rollback();
      throw e;
    }
  } catch (err) {
    console.error('POST /api/ai/workout-plan error', err?.message || err);
    res.status(400).json({ error: err.message || 'bad request' });
  }
});

// Quick provider health: list available models and methods
app.get('/api/ai/models', async (_req, res) => {
  try {
    if (MODEL_PROVIDER === 'gemini') {
      const base = (GEMINI_API_BASE || '').replace(/\/$/, '');
      const url = `${base}/models?key=${encodeURIComponent(GEMINI_API_KEY)}`;
      const { data } = await axios.get(url, { timeout: AI_TIMEOUT_MS });
      const models = Array.isArray(data?.models) ? data.models.map(m => ({
        name: m?.name || '',
        methods: m?.supportedGenerationMethods || m?.supportedMethods || [],
      })) : [];
      return res.json({ provider: 'gemini', count: models.length, models });
    } else {
      const base = (MODEL_BASE_URL || '').replace(/\/$/, '');
      const { data } = await axios.get(`${base}/models`, {
        headers: { Authorization: `Bearer ${MODEL_API_KEY}` },
        timeout: AI_TIMEOUT_MS,
      });
      const models = Array.isArray(data?.data) ? data.data.map(m => ({ id: m?.id })) : [];
      return res.json({ provider: 'openai', count: models.length, models });
    }
  } catch (e) {
    if (AI_DEBUG) {
      return res.status(Number(e?.response?.status) || 500).json({
        error: 'list models error',
        detail: e?.response?.data || String(e?.message || e),
      });
    }
    res.status(500).json({ error: 'list models error' });
  }
});

/* =========================
   404 (minimal & robust)
   ========================= */
app.use((req, res) => {
  res.status(404).json({
    error: 'not found',
    tried: `${req.method} ${req.originalUrl || req.url}`,
  });
});

/* =========================
   Start
   ========================= */
const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => console.log(`Server is running on http://localhost:${PORT}`));
