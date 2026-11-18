'use strict';
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const db = require('./db');
const seed = require('./seed');
const { router, auth } = require('./routes');

const PUBLIC = path.join(__dirname, '..', 'public');
const PORT = Number(process.env.PORT) || 3000;
const PROD = process.env.NODE_ENV === 'production';

const app = express();
app.disable('x-powered-by');
if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : process.env.TRUST_PROXY);

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      scriptSrcAttr: ["'none'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'blob:'],
      frameSrc: ['https://www.google.com'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false,
  hsts: PROD,
}));
app.use(express.json({ limit: '50kb' }));
app.use(cookieParser());

// Perlindungan CSRF: permintaan yang mengubah data harus berasal dari situs ini.
app.use('/api', (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const o = req.get('origin');
  if (o) { try { if (new URL(o).host !== req.get('host')) return res.status(403).json({ error: 'Asal permintaan tidak diizinkan.' }); } catch { return res.status(403).json({ error: 'Asal permintaan tidak valid.' }); } }
  next();
});
app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
// Dashboard baru (UMKM + Admin Desa). Harus sebelum router lama karena router lama menutup /api dengan 404.
require('./panel').mount(app, { db, auth, PUBLIC });
app.use('/api', router);

// Alamat lama /admin dan /umkm diteruskan ke dashboard baru (/panel/admin, /panel/umkm).
// Hak akses tetap diperiksa di server pada /panel/* dan /api/panel/* (role dibaca dari database, bukan dari klien).
app.get(['/admin', '/admin.html'], (_req, res) => res.redirect(301, '/panel/admin'));
app.get(['/umkm', '/umkm.html'], (_req, res) => res.redirect(301, '/panel/umkm'));
// Tiga halaman masuk: pengunjung/warga, pelaku UMKM, admin desa (satu berkas, jenis akun dibaca dari alamat).
for (const p of ['/login', '/login/umkm', '/login/admin'])
  app.get(p, (_req, res) => res.set('Cache-Control', 'no-cache').sendFile(path.join(PUBLIC, 'login.html')));

app.use('/assets', express.static(path.join(PUBLIC, 'assets'), { maxAge: '30d', immutable: true }));
app.get('/', (_req, res) => res.set('Cache-Control', 'no-cache').sendFile(path.join(PUBLIC, 'index.html')));
app.get('/healthz', (_req, res) => { db.prepare('SELECT 1').get(); res.json({ ok: true }); });

app.use((req, res) => res.status(404).type('text').send('Halaman tidak ditemukan.'));
app.use((err, req, res, _next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Format data tidak valid.' });
  console.error(err);
  res.status(500).json(req.path.startsWith('/api') ? { error: 'Terjadi kesalahan di server.' } : undefined);
});

seed.run();
seed.ensureAdmin().then(() => {
  app.listen(PORT, () => {
    console.log(`Visit Sendang Duwur berjalan di http://localhost:${PORT}`);
    const base = process.env.BASE_URL || `http://localhost:${PORT}`;
    if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) console.log(`Login Google: AKTIF. Redirect URI yang harus terdaftar di Google Cloud: ${base}/api/auth/google/callback`);
    else console.log('Login Google: BELUM DIKONFIGURASI (isi GOOGLE_CLIENT_ID & GOOGLE_CLIENT_SECRET di .env, lihat GOOGLE_SETUP.md).');
    console.log(require('./mail').enabled() ? 'Email reset kata sandi: AKTIF (SMTP).' : 'Email reset kata sandi: SMTP BELUM DIISI di .env, tautan reset hanya dicetak di konsol ini (lihat README).');
  });
});
