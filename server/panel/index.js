'use strict';
// Dashboard baru (UMKM + Admin Desa). Dipasang SEBELUM app.use('/api', router) di server/index.js,
// karena router lama menutup /api dengan handler 404.
const path = require('path');
const express = require('express');
const migrate = require('./migrate');
const up = require('./uploads');

const ROLE_LABEL = { umkm: 'Panel UMKM', admin: 'Panel Admin Desa' };
const BADGE = { umkm: 'UMKM', admin: 'Admin Desa' };

module.exports.mount = function mount(app, { db, auth, PUBLIC }) {
  migrate(db);

  /* ---- API: akses selalu divalidasi di server dari role di database ---- */
  const api = express.Router();
  api.use(auth.load);
  api.get('/me', (req, res) => {
    const u = req.user;
    if (!u || !['umkm', 'admin'].includes(u.role)) return res.status(u ? 403 : 401).json({ error: 'Tidak diizinkan.' });
    const biz = u.role === 'umkm'
      ? db.prepare('SELECT id,nama,verifikasi FROM businesses WHERE owner_id=?').get(u.id) || null
      : null;
    res.json({ user: { id: u.id, name: u.name, email: u.email, role: u.role }, label: ROLE_LABEL[u.role], badge: BADGE[u.role], business: biz });
  });
  const audit = require('./audit')(db);
  api.use('/umkm/ai', auth.requireUmkm, require('./bi')(db));
  api.use('/umkm', auth.requireUmkm, require('./umkm')(db, audit));
  api.use('/admin/ai', auth.requireAdmin, require('./village')(db));
  api.use('/admin', auth.requireAdmin, require('./admin')(db, audit));
  // Tahap berikutnya:
  //   api.use('/admin', auth.requireAdmin, require('./admin'));
  api.use((_req, res) => res.status(404).json({ error: 'Tidak ditemukan.' }));
  app.use('/api/panel', api);
  require('./checkout')(app, { db, auth });
  require('./assistant')(app, { db });
  // Foto produk: hanya berkas terdaftar dengan nama acak 24 heksa; nosniff agar tidak pernah ditafsirkan sebagai HTML/skrip.
  app.get('/uploads/:file', (req, res) => {
    const f = req.params.file;
    if (!up.NAME_RE.test(f) || !db.prepare('SELECT 1 FROM product_images WHERE file=?').get(f)) return res.status(404).end();
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'public, max-age=86400' }).sendFile(path.join(up.DIR, f));
  });
  // Etalase publik toko (halaman baru; tidak mengubah index.html).
  app.get('/toko/:id', (_req, res) => res.set('Cache-Control', 'no-cache').sendFile(path.join(PUBLIC, 'panel', 'toko.html')));

  /* ---- Halaman: satu berkas shell untuk kedua role (DashboardLayout membaca konfigurasi menu per role) ---- */
  const shell = path.join(PUBLIC, 'panel', 'shell.html');
  const denied = (msg) => '<!doctype html><meta charset="utf-8"><title>Akses ditolak</title><body style="font:16px system-ui;padding:40px"><h1>Akses ditolak</h1><p>' + msg + '</p><p><a href="/">Kembali ke beranda</a></p></body>';
  for (const role of ['umkm', 'admin']) {
    app.get(['/panel/' + role, '/panel/' + role + '/*splat'], auth.load, (req, res) => {
      if (!req.user) return res.redirect('/login/' + role + '?next=' + encodeURIComponent('/panel/' + role));
      if (req.user.role !== role) return res.status(403).type('html').send(denied('Halaman ini khusus ' + (role === 'umkm' ? 'akun pelaku UMKM' : 'admin desa') + '.'));
      res.set('Cache-Control', 'no-store').sendFile(shell);
    });
  }
};
