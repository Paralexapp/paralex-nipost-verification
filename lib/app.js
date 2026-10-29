'use strict';
const express = require('express');
const helmet = require('helmet');
const crypto = require('crypto');
const { Pool } = require('pg');
const { buildCertificate } = require('./certificate');

const { DATABASE_URL, SESSION_SECRET, ADMIN_PASSWORD, STAFF_PASSWORD } = process.env;
if (!DATABASE_URL || !SESSION_SECRET || !ADMIN_PASSWORD) {
  console.error('Missing environment variables: DATABASE_URL, SESSION_SECRET and ADMIN_PASSWORD are required.');
  process.exit(1);
}
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
  max: 3,                    // small pool: each serverless instance opens its own
  idleTimeoutMillis: 10000,
});

/* ---------- schema ---------- */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS counter (id int PRIMARY KEY, n int NOT NULL);
INSERT INTO counter (id, n) VALUES (1, 0) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS users (
  seq int PRIMARY KEY,
  id text UNIQUE NOT NULL,
  name text NOT NULL,
  email text UNIQUE NOT NULL,
  phone text NOT NULL,
  plate text NOT NULL,
  registered_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS throttle (k text PRIMARY KEY, c int NOT NULL, reset_at timestamptz NOT NULL);
DELETE FROM throttle WHERE reset_at < now() - interval '1 day';`;

// Runs once per cold start. The transaction-level advisory lock stops two cold starts racing.
const ready = (async () => {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('SELECT pg_advisory_xact_lock(7321)');
    await c.query(SCHEMA);
    await c.query('COMMIT');
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; }
  finally { c.release(); }
})();
ready.catch((e) => console.error('Database setup failed:', e.message));

/* ---------- auth (signed, httpOnly cookie) ---------- */
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();
const same = (a, b) => crypto.timingSafeEqual(sha(a), sha(b));
const mac = (p) => crypto.createHmac('sha256', SESSION_SECRET).update(p).digest('base64url');
const sign = (role) => {
  const p = Buffer.from(JSON.stringify({ role, exp: Date.now() + 8 * 3600e3 })).toString('base64url');
  return p + '.' + mac(p);
};
const readToken = (t) => {
  try {
    const [p, s] = String(t).split('.');
    const m = mac(p);
    if (!s || s.length !== m.length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(m))) return null;
    const d = JSON.parse(Buffer.from(p, 'base64url').toString());
    return d.exp > Date.now() ? d.role : null;
  } catch { return null; }
};
const roleOf = (req) => {
  const m = /(?:^|;\s*)sid=([^;]+)/.exec(req.headers.cookie || '');
  return m ? readToken(m[1]) : null;
};
const need = (min) => (req, res, next) => {
  const r = roleOf(req);
  if (!r) return res.status(401).json({ error: 'Please sign in.' });
  if (min === 'admin' && r !== 'admin') return res.status(403).json({ error: 'Admin access required.' });
  next();
};

/* ---------- helpers ---------- */
const COLS = `seq, id, name, email, phone, plate, registered_at, expires_at,
  ceil(extract(epoch from (expires_at - now())) / 86400)::int AS days_left`;
const full = (r) => ({ seq: r.seq, id: r.id, name: r.name, email: r.email, phone: r.phone, plate: r.plate,
  registeredAt: r.registered_at, expiresAt: r.expires_at, daysLeft: r.days_left });
const pub = (r) => ({ id: r.id, name: r.name, plate: r.plate,
  registeredAt: r.registered_at, expiresAt: r.expires_at, daysLeft: r.days_left });
const bad = (res, msg) => res.status(400).json({ error: msg });
const clientIp = (req) => req.headers['x-nf-client-connection-ip']
  || String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || 'unknown';
// Rate limiting kept in the database so it works across serverless instances.
async function hit(key, max, windowSec) {
  const { rows } = await pool.query(
    `INSERT INTO throttle (k, c, reset_at) VALUES ($1, 1, now() + make_interval(secs => $2))
     ON CONFLICT (k) DO UPDATE SET
       c = CASE WHEN throttle.reset_at < now() THEN 1 ELSE throttle.c + 1 END,
       reset_at = CASE WHEN throttle.reset_at < now() THEN now() + make_interval(secs => $2) ELSE throttle.reset_at END
     RETURNING c`, [key, windowSec]);
  return rows[0].c <= max;
}
const limit = (name, max, windowSec = 900) => async (req, res, next) => {
  try {
    if (await hit(`${name}:${clientIp(req)}`, max, windowSec)) return next();
    res.status(429).json({ error: 'Too many requests. Please try again shortly.' });
  } catch (e) { next(e); }
};

/* ---------- app ---------- */
const app = express();
app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: { directives: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'", 'https://cdnjs.cloudflare.com'],
    styleSrc: ["'self'"],
    styleSrcAttr: ["'unsafe-inline'"],
    imgSrc: ["'self'", 'data:', 'blob:'],
    connectSrc: ["'self'"],
    objectSrc: ["'none'"],
    frameAncestors: ["'none'"],
  } },
}));
app.use(express.json({ limit: '10kb' }));
app.use('/api', async (req, res, next) => { try { await ready; next(); } catch (e) { next(e); } });

app.get('/healthz', (req, res) => res.json({ ok: true }));
app.get('/api/me', (req, res) => res.json({ role: roleOf(req) }));

app.post('/api/login', limit('login', 10), (req, res) => {
  const pw = String((req.body || {}).password || '');
  let role = null;
  if (same(pw, ADMIN_PASSWORD)) role = 'admin';
  else if (STAFF_PASSWORD && same(pw, STAFF_PASSWORD)) role = 'staff';
  if (!role) return res.status(401).json({ error: 'Incorrect password.' });
  res.cookie('sid', sign(role), { httpOnly: true, sameSite: 'strict', secure: req.secure || req.headers['x-forwarded-proto'] === 'https', maxAge: 8 * 3600e3 });
  res.json({ role });
});
app.post('/api/logout', (req, res) => { res.clearCookie('sid'); res.json({ ok: true }); });

/* PUBLIC: verification (returns only name, plate, ID and dates) */
app.get('/api/verify/:id', limit('verify', 60, 60), async (req, res, next) => {
  try {
    const id = String(req.params.id).trim().toUpperCase();
    if (!/^JW26\.\d{3,}$/.test(id)) return res.status(404).json({ error: 'Not found' });
    const { rows } = await pool.query(`SELECT ${COLS} FROM users WHERE id = $1`, [id]);
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.set('Cache-Control', 'no-store');
    res.json(pub(rows[0]));
  } catch (e) { next(e); }
});

/* STAFF: register, list */
app.post('/api/users', need('staff'), async (req, res, next) => {
  const b = req.body || {};
  const name = String(b.name || '').trim();
  const email = String(b.email || '').trim().toLowerCase();
  const phone = String(b.phone || '').trim();
  const plate = String(b.plate || '').trim().toUpperCase().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 120) return bad(res, 'Please enter your full name.');
  if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 200) return bad(res, 'Please enter a valid email address.');
  if (phone.replace(/\D/g, '').length < 7 || phone.length > 30) return bad(res, 'Please enter a valid phone number.');
  if (plate.replace(/[^A-Z0-9]/g, '').length < 4 || plate.length > 20) return bad(res, 'Plate No. is required. Please enter a valid plate number.');
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    // The row lock on the counter serialises registrations: no duplicates, no gaps, even under load.
    const n = (await c.query('UPDATE counter SET n = n + 1 WHERE id = 1 RETURNING n')).rows[0].n;
    const id = 'JW26.' + String(n).padStart(3, '0');
    const { rows } = await c.query(
      `INSERT INTO users (seq, id, name, email, phone, plate, registered_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, now(), now() + interval '12 months') RETURNING ${COLS}`,
      [n, id, name, email, phone, plate]);
    await c.query('COMMIT');
    res.status(201).json(full(rows[0]));
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    if (e.code === '23505') return res.status(409).json({ error: 'This email is already registered.' });
    next(e);
  } finally { c.release(); }
});

app.get('/api/users', need('staff'), async (req, res, next) => {
  try {
    const { rows } = await pool.query(`SELECT ${COLS} FROM users ORDER BY seq DESC`);
    res.set('Cache-Control', 'no-store');
    res.json(rows.map(full));
  } catch (e) { next(e); }
});

/* STAFF: edit details (name, phone, plate) */
app.patch('/api/users/:id', need('staff'), async (req, res, next) => {
  try {
    const id = String(req.params.id).trim().toUpperCase();
    if (!/^JW26\.\d{3,}$/.test(id)) return bad(res, 'Invalid ID.');
    const b = req.body || {};
    const name = String(b.name || '').trim();
    const phone = String(b.phone || '').trim();
    const plate = String(b.plate || '').trim().toUpperCase().replace(/\s+/g, ' ');
    if (name.length < 2 || name.length > 120) return bad(res, 'Please enter the full name.');
    if (phone.replace(/\D/g, '').length < 7 || phone.length > 30) return bad(res, 'Please enter a valid phone number.');
    if (plate.replace(/[^A-Z0-9]/g, '').length < 4 || plate.length > 20) return bad(res, 'Plate No. is required. Please enter a valid plate number.');
    const { rows } = await pool.query(
      `UPDATE users SET name = $2, phone = $3, plate = $4 WHERE id = $1 RETURNING ${COLS}`, [id, name, phone, plate]);
    if (!rows[0]) return res.status(404).json({ error: 'User not found.' });
    res.json(full(rows[0]));
  } catch (e) { next(e); }
});

/* STAFF: renew. Adds 12 months to the current expiry, or to today if already expired. */
app.post('/api/users/:id/renew', need('staff'), async (req, res, next) => {
  try {
    const id = String(req.params.id).trim().toUpperCase();
    if (!/^JW26\.\d{3,}$/.test(id)) return bad(res, 'Invalid ID.');
    const { rows } = await pool.query(
      `UPDATE users SET expires_at = GREATEST(expires_at, now()) + interval '12 months' WHERE id = $1 RETURNING ${COLS}`, [id]);
    if (!rows[0]) return res.status(404).json({ error: 'User not found.' });
    res.json(full(rows[0]));
  } catch (e) { next(e); }
});

/* STAFF: certificate (PDF) with the user's QR code */
app.get('/api/users/:id/certificate', need('staff'), async (req, res, next) => {
  try {
    const id = String(req.params.id).trim().toUpperCase();
    if (!/^JW26\.\d{3,}$/.test(id)) return bad(res, 'Invalid ID.');
    const { rows } = await pool.query(`SELECT ${COLS} FROM users WHERE id = $1`, [id]);
    if (!rows[0]) return res.status(404).json({ error: 'User not found.' });
    const pdf = await buildCertificate(full(rows[0]));
    res.removeHeader('Content-Security-Policy');
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${id}-certificate.pdf"`, 'Cache-Control': 'no-store' });
    res.send(pdf);
  } catch (e) {
    console.error('Certificate error:', e);
    res.status(500).json({ error: 'Certificate failed: ' + (e && e.message ? e.message : 'unknown error') });
  }
});

/* ADMIN: delete (IDs are never reused because the counter only increases) */
app.delete('/api/users/:id', need('admin'), async (req, res, next) => {
  try {
    const id = String(req.params.id).trim().toUpperCase();
    if (!/^JW26\.\d{3,}$/.test(id)) return bad(res, 'Invalid ID.');
    await pool.query('DELETE FROM users WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

app.use((e, req, res, next) => {
  if (e.type === 'entity.parse.failed') return bad(res, 'Invalid request.');
  console.error(e);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

module.exports = app;

// Used only by the Netlify Function: Netlify may forward /.netlify/functions/api/x, /api/x or /x.
module.exports.normalize = (req, res, next) => {
  req.url = req.url.replace(/^\/\.netlify\/functions\/api/, '');
  if (!req.url.startsWith('/api') && !req.url.startsWith('/healthz')) req.url = '/api' + req.url;
  next();
};
