'use strict';
const express = require('express');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const db = require('./db');
const { hashPassword, verifyPassword, DUMMY, makeAuth } = require('./auth');
const mail = require('./mail');

const auth = makeAuth(db);
const router = express.Router();

/* ---------- util ---------- */
const str = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const text = (v, max) => (typeof v === 'string' ? v.replace(/\r/g, '').trim().slice(0, max) : '');
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const safeNext = (n) => (typeof n === 'string' && /^\/(?![/\\])/.test(n) ? n : '/');
const pubUser = (u) => (u ? { id: u.id, name: u.name, email: u.email, role: u.role } : null);
const wa = (raw) => {
  const d = String(raw || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('62')) return d;
  if (d.startsWith('0')) return '62' + d.slice(1);
  if (d.startsWith('8')) return '62' + d;
  return d;
};
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const bad = (res, error, fields) => res.status(400).json(fields ? { error, fields } : { error });
const STATUS = ['baru', 'proses', 'selesai']; // laporan
const ORDER_STATUS = ['baru', 'proses', 'siap', 'selesai', 'batal'];
const loginPath = (t) => (t === 'umkm' ? '/login/umkm' : t === 'admin' ? '/login/admin' : '/login');
const TYPES = ['user', 'umkm', 'admin'];
const CATS = ['Batik', 'Bordir & sablon', 'Kuliner & toko'];
const enumOf = (v, list, d) => (list.includes(v) ? v : d);
const TYPE_OF_ROLE = { user: 'user', umkm: 'umkm', admin: 'admin' };
const TYPE_LABEL = { user: 'Pengunjung / Warga', umkm: 'Pelaku UMKM', admin: 'Admin Desa' };
const PHONE_RE = /^[0-9+\-\s]{8,20}$/;

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false, message: { error: 'Terlalu banyak percobaan. Coba lagi beberapa menit lagi.' } });
const forgotLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: true, legacyHeaders: false, message: { error: 'Terlalu banyak permintaan. Coba lagi beberapa menit lagi.' } });
const writeLimiter = rateLimit({ windowMs: 10 * 60 * 1000, limit: 40, standardHeaders: true, legacyHeaders: false, message: { error: 'Terlalu banyak kiriman. Coba lagi nanti.' } });

router.use(auth.load);

/* ======================= AUTENTIKASI ======================= */
router.get('/auth/me', (req, res) => res.json({ user: pubUser(req.user) }));

router.post('/auth/register', authLimiter, ah(async (req, res) => {
  const name = str(req.body.name, 60), email = str(req.body.email, 254).toLowerCase(), pw = typeof req.body.password === 'string' ? req.body.password : '';
  // Hanya 'user' dan 'umkm' yang bisa mendaftar sendiri. Nilai lain (termasuk 'admin') dianggap 'user'.
  const type = req.body.accountType === 'umkm' ? 'umkm' : 'user';
  const asal = type === 'umkm' || req.body.asal === 'warga' ? 'warga' : 'pengunjung';
  const fields = {};
  if (name.length < 2) fields.name = 'Nama minimal 2 karakter.';
  if (!EMAIL_RE.test(email)) fields.email = 'Masukkan alamat email yang valid.';
  if (pw.length < 8 || pw.length > 128) fields.password = 'Kata sandi minimal 8 karakter.';
  let biz = null;
  if (type === 'umkm') {
    const namaUsaha = str(req.body.namaUsaha, 100), kategori = enumOf(req.body.kategori, CATS, null), whatsapp = str(req.body.whatsapp, 20);
    if (namaUsaha.length < 2) fields.namaUsaha = 'Tulis nama usaha Anda.';
    if (!kategori) fields.kategori = 'Pilih kategori usaha.';
    if (!PHONE_RE.test(whatsapp)) fields.whatsapp = 'Nomor WhatsApp harus angka (8–20 digit).';
    biz = { namaUsaha, kategori, whatsapp, alamat: str(req.body.alamat, 150) };
  }
  if (Object.keys(fields).length) return bad(res, 'Data belum valid.', fields);
  if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email))
    return res.status(409).json({ error: 'Email ini sudah terdaftar.', fields: { email: 'Email ini sudah terdaftar. Silakan masuk.' } });
  const hash = await hashPassword(pw);
  let id;
  try {
    id = db.transaction(() => {
      const uid = db.prepare('INSERT INTO users (name,email,pass_hash,role,asal) VALUES (?,?,?,?,?)').run(name, email, hash, type, asal).lastInsertRowid;
      // Usaha langsung aktif dan tampil di marketplace, tanpa persetujuan admin.
      if (biz) db.prepare("INSERT INTO businesses (nama,pemilik,kategori,alamat,whatsapp,owner_id,verifikasi) VALUES (?,?,?,?,?,?, 'verified')").run(biz.namaUsaha, name, biz.kategori, biz.alamat, biz.whatsapp, uid);
      return uid;
    })();
  } catch { return res.status(409).json({ error: 'Email ini sudah terdaftar.', fields: { email: 'Email ini sudah terdaftar. Silakan masuk.' } }); }
  auth.startSession(res, id, true);
  res.status(201).json({ user: { id: Number(id), name, email, role: type } });
}));

router.post('/auth/login', authLimiter, ah(async (req, res) => {
  const email = str(req.body.email, 254).toLowerCase(), pw = typeof req.body.password === 'string' ? req.body.password : '';
  const u = EMAIL_RE.test(email) ? db.prepare('SELECT * FROM users WHERE email=?').get(email) : null;
  const ok = await verifyPassword(pw, u && u.pass_hash ? u.pass_hash : DUMMY);
  if (!u || !u.pass_hash || !ok) return res.status(401).json({ error: 'Email atau kata sandi salah.' });
  if (!u.aktif) return res.status(403).json({ error: 'Akun ini dinonaktifkan. Hubungi admin desa.' });
  // Jenis akun yang dipilih di halaman masuk harus cocok dengan role di database (dicek setelah sandi benar).
  const want = req.body.accountType;
  if (want && TYPE_OF_ROLE[u.role] !== want)
    return res.status(403).json({ error: `Akun ini terdaftar sebagai ${TYPE_LABEL[TYPE_OF_ROLE[u.role]]}. Pilih jenis akun yang sesuai.`, wrongType: TYPE_OF_ROLE[u.role] });
  auth.startSession(res, u.id, !!req.body.remember);
  res.json({ user: pubUser(u) });
}));

/* --- Lupa kata sandi: tautan sekali pakai (berlaku 1 jam) dikirim ke email. Respons selalu sama
       agar orang luar tidak bisa menebak email mana yang terdaftar. --- */
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
router.post('/auth/forgot', forgotLimiter, ah(async (req, res) => {
  const email = str(req.body.email, 254).toLowerCase();
  if (!EMAIL_RE.test(email)) return bad(res, 'Masukkan alamat email yang valid.', { email: 'Masukkan alamat email yang valid.' });
  const u = db.prepare('SELECT id,name,email,role,aktif FROM users WHERE email=?').get(email);
  if (u && u.aktif) {
    const recent = db.prepare('SELECT 1 FROM password_resets WHERE user_id=? AND created_at>?').get(u.id, Date.now() - 60 * 1000);
    if (!recent) {
      const token = crypto.randomBytes(32).toString('base64url');
      db.prepare('DELETE FROM password_resets WHERE user_id=? OR expires_at<?').run(u.id, Date.now());
      db.prepare('INSERT INTO password_resets (token_hash,user_id,expires_at,created_at) VALUES (?,?,?,?)').run(sha256(token), u.id, Date.now() + 60 * 60 * 1000, Date.now());
      const link = `${baseUrl(req)}${loginPath(TYPE_OF_ROLE[u.role])}?reset=${token}`;
      try { await mail.sendReset(u.email, u.name, link); } catch (e) { console.error('Gagal mengirim email reset:', e.message); }
    }
  }
  res.json({ ok: true });
}));
router.get('/auth/reset/check', (req, res) => {
  const t = typeof req.query.token === 'string' ? req.query.token : '';
  res.json({ valid: !!(t && db.prepare('SELECT 1 FROM password_resets WHERE token_hash=? AND expires_at>?').get(sha256(t), Date.now())) });
});
router.post('/auth/reset', authLimiter, ah(async (req, res) => {
  const t = typeof req.body.token === 'string' ? req.body.token : '', pw = typeof req.body.password === 'string' ? req.body.password : '';
  if (pw.length < 8 || pw.length > 128) return bad(res, 'Kata sandi minimal 8 karakter.', { password: 'Kata sandi minimal 8 karakter.' });
  const r = t ? db.prepare('SELECT user_id FROM password_resets WHERE token_hash=? AND expires_at>?').get(sha256(t), Date.now()) : null;
  if (!r) return res.status(400).json({ error: 'Tautan reset tidak valid atau sudah kedaluwarsa. Minta tautan baru.', expired: true });
  const hash = await hashPassword(pw);
  const u = db.prepare('SELECT role FROM users WHERE id=?').get(r.user_id);
  db.transaction(() => {
    db.prepare('UPDATE users SET pass_hash=? WHERE id=?').run(hash, r.user_id);
    db.prepare('DELETE FROM password_resets WHERE user_id=?').run(r.user_id);
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(r.user_id); // keluar dari semua perangkat
  })();
  res.json({ ok: true, type: u ? TYPE_OF_ROLE[u.role] : 'user' });
}));

router.post('/auth/logout', (req, res) => { auth.endSession(req, res); res.json({ ok: true }); });

/* --- Google OAuth 2.0 (Authorization Code Flow). Aktif bila GOOGLE_CLIENT_ID & GOOGLE_CLIENT_SECRET diisi.
       Jenis akun (user/umkm/admin) dibawa lewat cookie state yang httpOnly; admin TIDAK bisa dibuat lewat Google. --- */
const G = () => ({ id: process.env.GOOGLE_CLIENT_ID, secret: process.env.GOOGLE_CLIENT_SECRET });
const baseUrl = (req) => process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
router.get('/auth/google', (req, res) => {
  const g = G();
  const type = TYPES.includes(req.query.as) ? req.query.as : 'user';
  if (!g.id || !g.secret) return res.redirect(loginPath(type) + '?error=google_off');
  const state = crypto.randomBytes(16).toString('base64url');
  res.cookie('sd_oauth', JSON.stringify({ s: state, n: safeNext(req.query.next), t: type }), { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 10 * 60 * 1000, path: '/api/auth' });
  const p = new URLSearchParams({ client_id: g.id, redirect_uri: baseUrl(req) + '/api/auth/google/callback', response_type: 'code', scope: 'openid email profile', state, prompt: 'select_account' });
  res.redirect('https://accounts.google.com/o/oauth2/v2/auth?' + p);
});
router.get('/auth/google/callback', ah(async (req, res) => {
  const g = G();
  let saved = {};
  try { saved = JSON.parse(req.cookies.sd_oauth || '{}'); } catch { /* abaikan */ }
  const type = TYPES.includes(saved.t) ? saved.t : 'user';
  const fail = (code, t = type) => res.redirect(loginPath(t) + '?error=' + code);
  res.clearCookie('sd_oauth', { path: '/api/auth' });
  if (req.query.error) return fail('google_denied');
  if (!g.id || !g.secret || !saved.s || saved.s !== req.query.state || !req.query.code) return fail('google_failed');
  try {
    const tr = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code: String(req.query.code), client_id: g.id, client_secret: g.secret, redirect_uri: baseUrl(req) + '/api/auth/google/callback', grant_type: 'authorization_code' }),
    });
    const tok = await tr.json();
    if (!tr.ok || !tok.access_token) throw new Error('token ' + (tok.error || tr.status));
    const ur = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: 'Bearer ' + tok.access_token } });
    const info = await ur.json();
    if (!ur.ok || !info.sub || !info.email || info.email_verified !== true) throw new Error('userinfo');
    const email = String(info.email).toLowerCase();
    let u = db.prepare('SELECT * FROM users WHERE google_id=?').get(info.sub) || db.prepare('SELECT * FROM users WHERE email=?').get(email);
    if (u && u.google_id && u.google_id !== info.sub) throw new Error('google_id berbeda');
    if (!u) {
      if (type === 'admin') return fail('google_noadmin');
      const nama = str(info.name || email.split('@')[0], 60);
      const role = type === 'umkm' ? 'umkm' : 'user';
      const id = db.transaction(() => {
        const uid = db.prepare('INSERT INTO users (name,email,google_id,role,asal) VALUES (?,?,?,?,?)').run(nama, email, info.sub, role, role === 'umkm' ? 'warga' : 'pengunjung').lastInsertRowid;
        // Usaha dibuat dengan data minimal; pemilik melengkapinya (terutama WhatsApp) di dashboard. Tampil di marketplace setelah WhatsApp terisi.
        if (role === 'umkm') db.prepare("INSERT INTO businesses (nama,pemilik,kategori,owner_id,verifikasi) VALUES (?,?,?,?, 'verified')").run('Usaha ' + nama.split(' ')[0], nama, 'Kuliner & toko', uid);
        return uid;
      })();
      u = db.prepare('SELECT * FROM users WHERE id=?').get(id);
    } else {
      if (!u.aktif) return fail('google_inactive');
      if (TYPE_OF_ROLE[u.role] !== type) return fail('google_wrongtype', TYPE_OF_ROLE[u.role]);
      if (!u.google_id) db.prepare('UPDATE users SET google_id=? WHERE id=?').run(info.sub, u.id);
    }
    auth.startSession(res, u.id, true);
    const dest = safeNext(saved.n);
    res.redirect(dest !== '/' ? dest : u.role === 'admin' ? '/panel/admin' : u.role === 'umkm' ? '/panel/umkm' : '/');
  } catch (e) {
    console.error('Google OAuth gagal:', e.message);
    fail('google_failed');
  }
}));

/* ======================= DATA PUBLIK ======================= */
router.get('/config', (_req, res) => res.json({ ai: !!process.env.ANTHROPIC_API_KEY, google: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) }));

router.get('/announcements', (_req, res) => {
  res.json({ items: db.prepare("SELECT id,judul,kategori,isi,created_at FROM announcements WHERE status='Terbit' ORDER BY id DESC LIMIT 20").all() });
});

router.get('/businesses', (_req, res) => {
  const rows = db.prepare("SELECT id,nama,pemilik,kategori,alamat,whatsapp FROM businesses WHERE aktif=1 AND (owner_id IS NULL OR whatsapp<>'') ORDER BY nama COLLATE NOCASE").all();
  res.json({ items: rows.map((b) => ({ ...b, wa: wa(b.whatsapp) })) });
});

router.get('/locations', (_req, res) => {
  res.json({ items: db.prepare('SELECT nama,kategori,buka,parkir,toilet FROM locations ORDER BY id').all() });
});

/* Laporan fasilitas: siapa pun boleh kirim, status bisa dipantau lewat nomor tiket. */
const REPORT_TYPES = ['Jalan / akses', 'Toilet / air bersih', 'Penerangan', 'Papan petunjuk', 'Gapura / bangunan cagar budaya', 'Tempat sampah / kebersihan', 'Lainnya'];
router.post('/reports', writeLimiter, (req, res) => {
  const jenis = str(req.body.jenis, 60), lokasi = str(req.body.lokasi, 150), ket = text(req.body.keterangan, 1500), nama = str(req.body.nama, 60) || 'Tanpa nama';
  const fields = {};
  if (!REPORT_TYPES.includes(jenis)) fields.jenis = 'Pilih jenis fasilitas.';
  if (lokasi.length < 3) fields.lokasi = 'Tulis lokasinya.';
  if (ket.length < 5) fields.keterangan = 'Jelaskan kerusakannya.';
  if (Object.keys(fields).length) return bad(res, 'Data belum lengkap.', fields);
  const id = db.prepare('INSERT INTO reports (jenis,lokasi,keterangan,pelapor,user_id) VALUES (?,?,?,?,?)').run(jenis, lokasi, ket, nama, req.user ? req.user.id : null).lastInsertRowid;
  res.status(201).json({ id: Number(id), status: 'baru' });
});
router.get('/reports/track', (req, res) => {
  const ids = String(req.query.ids || '').split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 30);
  if (!ids.length) return res.json({ items: [] });
  const rows = db.prepare(`SELECT id,jenis,lokasi,status,created_at FROM reports WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY id DESC`).all(...ids);
  res.json({ items: rows });
});

/* Pesanan dari Marketplace UMKM: dicatat dulu, lalu pembeli diarahkan ke WhatsApp penjual. */
router.post('/orders', writeLimiter, (req, res) => {
  const bid = Number(req.body.businessId), pemesan = str(req.body.pemesan, 60), pesanan = text(req.body.pesanan, 1000), jumlah = Math.floor(Number(req.body.jumlah));
  const b = Number.isInteger(bid) ? db.prepare("SELECT id,nama,whatsapp FROM businesses WHERE id=? AND aktif=1 AND (owner_id IS NULL OR whatsapp<>'')").get(bid) : null;
  if (!b) return bad(res, 'Usaha tidak ditemukan.');
  const fields = {};
  if (pemesan.length < 2) fields.pemesan = 'Tulis nama Anda.';
  if (pesanan.length < 3) fields.pesanan = 'Tulis yang ingin dipesan.';
  if (!(jumlah >= 1 && jumlah <= 999)) fields.jumlah = 'Jumlah 1–999.';
  const kontak = str(req.body.kontak, 20);
  if (kontak && !PHONE_RE.test(kontak)) fields.kontak = 'Nomor WhatsApp harus angka.';
  if (Object.keys(fields).length) return bad(res, 'Data belum lengkap.', fields);
  const id = db.prepare('INSERT INTO orders (business_id,business_nama,pemesan,pesanan,jumlah,user_id,kontak) VALUES (?,?,?,?,?,?,?)').run(b.id, b.nama, pemesan, pesanan, jumlah, req.user ? req.user.id : null, kontak).lastInsertRowid;
  res.status(201).json({ id: Number(id), wa: wa(b.whatsapp) });
});

/* Heritage Passport: stempel tersimpan di akun. */
router.get('/passport', auth.requireUser, (req, res) => {
  res.json({ stamps: db.prepare('SELECT idx FROM stamps WHERE user_id=? ORDER BY idx').all(req.user.id).map((r) => r.idx) });
});
router.post('/passport/stamp', auth.requireUser, (req, res) => {
  const list = (Array.isArray(req.body.idx) ? req.body.idx : [req.body.idx]).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n < 7);
  const ins = db.prepare('INSERT OR IGNORE INTO stamps (user_id,idx) VALUES (?,?)');
  db.transaction(() => list.forEach((i) => ins.run(req.user.id, i)))();
  res.json({ stamps: db.prepare('SELECT idx FROM stamps WHERE user_id=? ORDER BY idx').all(req.user.id).map((r) => r.idx) });
});
router.delete('/passport', auth.requireUser, (req, res) => { db.prepare('DELETE FROM stamps WHERE user_id=?').run(req.user.id); res.json({ stamps: [] }); });

/* Asisten wisata berbasis AI (opsional). Tanpa ANTHROPIC_API_KEY, klien memakai jawaban lokal. */
const chatLimiter = rateLimit({ windowMs: 10 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false, message: { error: 'Terlalu banyak pertanyaan.' } });
router.post('/chat', chatLimiter, ah(async (req, res) => {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(503).json({ error: 'Asisten AI belum diaktifkan.' });
  const msgs = (Array.isArray(req.body.messages) ? req.body.messages : []).slice(-10)
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m) => ({ role: m.role, content: m.content.slice(0, 1000) }));
  if (!msgs.length || msgs[0].role !== 'user') return bad(res, 'Pesan tidak valid.');
  const lang = req.body.lang === 'en' ? 'English' : 'Bahasa Indonesia';
  const ctx = typeof req.body.context === 'string' ? req.body.context.slice(0, 8000) : '';
  const system = `Kamu asisten wisata Desa Sendang Duwur, Paciran, Lamongan. Jawab singkat dalam ${lang}, hanya berdasarkan informasi berikut. Jika tidak ada di informasi, katakan belum terdata dan sarankan menghubungi kantor desa lewat WhatsApp. Jangan mengarang jam buka, harga, atau kontak.\n\n${ctx}`;
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || 'claude-haiku-5-5', max_tokens: 500, system, messages: msgs }),
  });
  if (!r.ok) return res.status(502).json({ error: 'Asisten AI tidak tersedia.' });
  const j = await r.json();
  res.json({ reply: (j.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim() });
}));

/* ======================= DASHBOARD UMKM ======================= */
// Semua query dibatasi ke usaha milik akun yang sedang masuk (owner_id = req.user.id).
const umkm = express.Router();
umkm.use(auth.requireUmkm);
const myBiz = (req) => db.prepare('SELECT id,nama,pemilik,kategori,alamat,whatsapp,aktif,verifikasi,catatan,created_at FROM businesses WHERE owner_id=?').get(req.user.id);
// Hitungan pesanan per hari (7 hari terakhir, waktu WIB) untuk grafik.
const last7 = (sql, ...args) => {
  const rows = db.prepare(sql).all(...args), m = new Map(rows.map((x) => [x.d, x.n]));
  const out = [];
  for (let i = 6; i >= 0; i--) { const d = db.prepare("SELECT date('now','+7 hours',?) d").get(`-${i} days`).d; out.push({ d, n: m.get(d) || 0 }); }
  return out;
};
umkm.get('/me', (req, res) => {
  const b = myBiz(req);
  const zero = { total: 0, baru: 0, proses: 0, siap: 0, selesai: 0, batal: 0 };
  if (!b) return res.json({ business: null, orders: [], stats: zero, harian: [] });
  const orders = db.prepare('SELECT id,pemesan,pesanan,jumlah,kontak,status,created_at FROM orders WHERE business_id=? ORDER BY id DESC LIMIT 300').all(b.id).map((o) => ({ ...o, wa: wa(o.kontak) }));
  const stats = { ...zero, total: orders.length };
  orders.forEach((o) => { stats[o.status]++; });
  const harian = last7("SELECT date(created_at,'+7 hours') d, COUNT(*) n FROM orders WHERE business_id=? AND date(created_at,'+7 hours')>=date('now','+7 hours','-6 days') GROUP BY d", b.id);
  res.json({ business: b, orders, stats, harian });
});
umkm.put('/me', (req, res) => {
  const b = myBiz(req);
  if (!b) return res.status(404).json({ error: 'Usaha tidak ditemukan.' });
  const nama = str(req.body.nama, 100), kategori = enumOf(req.body.kategori, CATS, null), whatsapp = str(req.body.whatsapp, 20), alamat = str(req.body.alamat, 150);
  const fields = {};
  if (nama.length < 2) fields.nama = 'Tulis nama usaha.';
  if (!kategori) fields.kategori = 'Pilih kategori.';
  if (!PHONE_RE.test(whatsapp)) fields.whatsapp = 'Nomor WhatsApp harus angka (8–20 digit).';
  if (Object.keys(fields).length) return bad(res, 'Data belum valid.', fields);
  db.prepare('UPDATE businesses SET nama=?,kategori=?,whatsapp=?,alamat=? WHERE id=?').run(nama, kategori, whatsapp, alamat, b.id);
  res.json({ ok: true });
});
umkm.patch('/orders/:id', (req, res) => {
  const b = myBiz(req);
  if (!b || !ORDER_STATUS.includes(req.body.status)) return bad(res, 'Status tidak valid.');
  const r = db.prepare('UPDATE orders SET status=? WHERE id=? AND business_id=?').run(req.body.status, req.params.id, b.id);
  r.changes ? res.json({ ok: true }) : res.status(404).json({ error: 'Pesanan tidak ditemukan.' });
});
router.use('/umkm', umkm);

/* ======================= ADMIN ======================= */
const admin = express.Router();
admin.use(auth.requireAdmin);

admin.get('/summary', (_req, res) => {
  const c = (sql) => db.prepare(sql).get().n;
  res.json({
    laporanBaru: c("SELECT COUNT(*) n FROM reports WHERE status='baru'"), pesananBaru: c("SELECT COUNT(*) n FROM orders WHERE status='baru'"),
    pengguna: c("SELECT COUNT(*) n FROM users WHERE role='user'"),
  });
});

// Laporan
admin.get('/reports', (_req, res) => res.json({ items: db.prepare('SELECT * FROM reports ORDER BY id DESC').all() }));
admin.patch('/reports/:id', (req, res) => {
  const s = req.body.status;
  if (!STATUS.includes(s)) return bad(res, 'Status tidak valid.');
  const r = db.prepare('UPDATE reports SET status=? WHERE id=?').run(s, req.params.id);
  r.changes ? res.json({ ok: true }) : res.status(404).json({ error: 'Tidak ditemukan.' });
});
admin.delete('/reports/:id', (req, res) => { db.prepare('DELETE FROM reports WHERE id=?').run(req.params.id); res.json({ ok: true }); });

// Pengumuman
const annData = (b) => {
  const judul = str(b.judul, 120), isi = text(b.isi, 2000), kategori = enumOf(b.kategori, ['Kalender', 'Layanan', 'Peringatan', 'Umum'], 'Umum'), status = enumOf(b.status, ['Draf', 'Terbit'], 'Draf');
  return judul && isi ? { judul, isi, kategori, status } : null;
};
admin.get('/announcements', (_req, res) => res.json({ items: db.prepare('SELECT * FROM announcements ORDER BY id DESC').all() }));
admin.post('/announcements', (req, res) => {
  const a = annData(req.body); if (!a) return bad(res, 'Judul dan isi wajib diisi.');
  const id = db.prepare('INSERT INTO announcements (judul,kategori,isi,status) VALUES (?,?,?,?)').run(a.judul, a.kategori, a.isi, a.status).lastInsertRowid;
  res.status(201).json({ id: Number(id) });
});
admin.put('/announcements/:id', (req, res) => {
  const a = annData(req.body); if (!a) return bad(res, 'Judul dan isi wajib diisi.');
  const r = db.prepare('UPDATE announcements SET judul=?,kategori=?,isi=?,status=? WHERE id=?').run(a.judul, a.kategori, a.isi, a.status, req.params.id);
  r.changes ? res.json({ ok: true }) : res.status(404).json({ error: 'Tidak ditemukan.' });
});
admin.delete('/announcements/:id', (req, res) => { db.prepare('DELETE FROM announcements WHERE id=?').run(req.params.id); res.json({ ok: true }); });

// Usaha warga
const bizData = (b) => {
  const nama = str(b.nama, 100), pemilik = str(b.pemilik, 80), kategori = enumOf(b.kategori, CATS, null);
  const whatsapp = str(b.whatsapp, 20), alamat = str(b.alamat, 150);
  if (!nama || !pemilik || !kategori) return null;
  if (whatsapp && !/^[0-9+\-\s]{8,20}$/.test(whatsapp)) return null;
  return { nama, pemilik, kategori, whatsapp, alamat, aktif: b.aktif === undefined ? 1 : b.aktif ? 1 : 0 };
};
admin.get('/businesses', (_req, res) => res.json({ items: db.prepare('SELECT b.*, (SELECT email FROM users WHERE id=b.owner_id) owner_email FROM businesses b ORDER BY b.nama COLLATE NOCASE').all() }));
admin.post('/businesses', (req, res) => {
  const b = bizData(req.body); if (!b) return bad(res, 'Nama, pemilik, dan kategori wajib; nomor WhatsApp harus angka.');
  const id = db.prepare('INSERT INTO businesses (nama,pemilik,kategori,alamat,whatsapp,aktif) VALUES (?,?,?,?,?,?)').run(b.nama, b.pemilik, b.kategori, b.alamat, b.whatsapp, b.aktif).lastInsertRowid;
  res.status(201).json({ id: Number(id) });
});
admin.put('/businesses/:id', (req, res) => {
  const b = bizData(req.body); if (!b) return bad(res, 'Nama, pemilik, dan kategori wajib; nomor WhatsApp harus angka.');
  const r = db.prepare('UPDATE businesses SET nama=?,pemilik=?,kategori=?,alamat=?,whatsapp=? WHERE id=?').run(b.nama, b.pemilik, b.kategori, b.alamat, b.whatsapp, req.params.id);
  r.changes ? res.json({ ok: true }) : res.status(404).json({ error: 'Tidak ditemukan.' });
});
admin.patch('/businesses/:id', (req, res) => {
  const r = db.prepare('UPDATE businesses SET aktif=? WHERE id=?').run(req.body.aktif ? 1 : 0, req.params.id);
  r.changes ? res.json({ ok: true }) : res.status(404).json({ error: 'Tidak ditemukan.' });
});
admin.delete('/businesses/:id', (req, res) => { db.prepare('DELETE FROM businesses WHERE id=?').run(req.params.id); res.json({ ok: true }); });

// Lokasi
admin.get('/locations', (_req, res) => res.json({ items: db.prepare('SELECT * FROM locations ORDER BY id').all() }));
admin.put('/locations/:id', (req, res) => {
  const r = db.prepare('UPDATE locations SET buka=?,parkir=?,toilet=? WHERE id=?').run(str(req.body.buka, 120), str(req.body.parkir, 120), str(req.body.toilet, 120), req.params.id);
  r.changes ? res.json({ ok: true }) : res.status(404).json({ error: 'Tidak ditemukan.' });
});

// Pesanan
admin.get('/orders', (_req, res) => res.json({ items: db.prepare('SELECT * FROM orders ORDER BY id DESC LIMIT 500').all() }));
admin.patch('/orders/:id', (req, res) => {
  if (!ORDER_STATUS.includes(req.body.status)) return bad(res, 'Status tidak valid.');
  const r = db.prepare('UPDATE orders SET status=? WHERE id=?').run(req.body.status, req.params.id);
  r.changes ? res.json({ ok: true }) : res.status(404).json({ error: 'Tidak ditemukan.' });
});
admin.delete('/orders/:id', (req, res) => { db.prepare('DELETE FROM orders WHERE id=?').run(req.params.id); res.json({ ok: true }); });

// Pengguna
admin.get('/users', (_req, res) => res.json({ items: db.prepare(`SELECT u.id,u.name,u.email,u.role,u.asal,u.aktif,u.created_at,(u.google_id IS NOT NULL) google,
  (SELECT COUNT(*) FROM stamps s WHERE s.user_id=u.id) stamps FROM users u ORDER BY u.id DESC LIMIT 500`).all() }));

admin.patch('/users/:id/aktif', (req, res) => {
  const u = db.prepare('SELECT id,role FROM users WHERE id=?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'Tidak ditemukan.' });
  if (u.role === 'admin') return bad(res, 'Akun admin tidak bisa dinonaktifkan dari sini.');
  const on = req.body.aktif ? 1 : 0;
  db.transaction(() => {
    db.prepare('UPDATE users SET aktif=? WHERE id=?').run(on, u.id);
    if (!on) db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id); // langsung keluar dari semua perangkat
  })();
  res.json({ ok: true });
});

// Statistik untuk ringkasan admin.
admin.get('/stats', (_req, res) => {
  const all = (sql) => db.prepare(sql).all();
  const by = (rows, k) => Object.fromEntries(rows.map((r) => [r[k], r.n]));
  res.json({
    users: by(all('SELECT role, COUNT(*) n FROM users GROUP BY role'), 'role'),
    warga: db.prepare("SELECT COUNT(*) n FROM users WHERE role='user' AND asal='warga'").get().n,
    orders: by(all('SELECT status, COUNT(*) n FROM orders GROUP BY status'), 'status'),
    reports: by(all('SELECT status, COUNT(*) n FROM reports GROUP BY status'), 'status'),
    ordersHarian: last7("SELECT date(created_at,'+7 hours') d, COUNT(*) n FROM orders WHERE date(created_at,'+7 hours')>=date('now','+7 hours','-6 days') GROUP BY d"),
    usersHarian: last7("SELECT date(created_at,'+7 hours') d, COUNT(*) n FROM users WHERE date(created_at,'+7 hours')>=date('now','+7 hours','-6 days') GROUP BY d"),
  });
});

router.use('/admin', admin);
router.use((_req, res) => res.status(404).json({ error: 'Tidak ditemukan.' }));

module.exports = { router, auth };
