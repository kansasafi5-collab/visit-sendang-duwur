'use strict';
const crypto = require('crypto');
const { promisify } = require('util');
const scrypt = promisify(crypto.scrypt);

const COOKIE = 'sd_sid';
const DAY = 864e5;
const PROD = process.env.NODE_ENV === 'production';

async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}
async function verifyPassword(pw, stored) {
  const [alg, saltHex, keyHex] = String(stored || '').split('$');
  if (alg !== 'scrypt' || !saltHex || !keyHex) return false;
  const key = await scrypt(pw, Buffer.from(saltHex, 'hex'), 64, { N: 16384, r: 8, p: 1 });
  const want = Buffer.from(keyHex, 'hex');
  return want.length === key.length && crypto.timingSafeEqual(key, want);
}
// Hash palsu agar waktu respons login sama untuk email yang tidak terdaftar.
const DUMMY = `scrypt$${'00'.repeat(16)}$${'00'.repeat(64)}`;

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

function makeAuth(db) {
  const q = {
    ins: db.prepare('INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)'),
    get: db.prepare(`SELECT u.id,u.name,u.email,u.role FROM sessions s JOIN users u ON u.id=s.user_id
                     WHERE s.token_hash=? AND s.expires_at>? AND u.aktif=1`),
    del: db.prepare('DELETE FROM sessions WHERE token_hash=?'),
    purge: db.prepare('DELETE FROM sessions WHERE expires_at<=?'),
  };
  setInterval(() => q.purge.run(Date.now()), 6 * 60 * 60 * 1000).unref();

  function startSession(res, userId, remember) {
    const token = crypto.randomBytes(32).toString('base64url');
    const ttl = remember ? 30 * DAY : DAY;
    q.ins.run(sha(token), userId, Date.now() + ttl);
    const opt = { httpOnly: true, sameSite: 'lax', secure: PROD, path: '/' };
    if (remember) opt.maxAge = ttl;
    res.cookie(COOKIE, token, opt);
  }
  function endSession(req, res) {
    const t = req.cookies && req.cookies[COOKIE];
    if (t) q.del.run(sha(t));
    res.clearCookie(COOKIE, { path: '/' });
  }
  // Mengisi req.user bila sesi valid.
  function load(req, _res, next) {
    const t = req.cookies && req.cookies[COOKIE];
    req.user = t ? q.get.get(sha(t), Date.now()) || null : null;
    next();
  }
  const requireUser = (req, res, next) => (req.user ? next() : res.status(401).json({ error: 'Silakan masuk terlebih dahulu.' }));
  const requireAdmin = (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Silakan masuk terlebih dahulu.' });
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Hanya untuk admin desa.' });
    next();
  };
  const requireUmkm = (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Silakan masuk terlebih dahulu.' });
    if (req.user.role !== 'umkm') return res.status(403).json({ error: 'Hanya untuk akun pelaku UMKM.' });
    next();
  };
  return { startSession, endSession, load, requireUser, requireAdmin, requireUmkm };
}

module.exports = { hashPassword, verifyPassword, DUMMY, makeAuth, COOKIE };
