'use strict';
// API Dashboard Admin Desa. Tolak/nonaktifkan WAJIB beralasan (min. 5 huruf) dan selalu tercatat di audit_log.
const express = require('express');
const { today, statusOf } = require('./promo');

const int = (v) => (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '') ? (Number.isInteger(Number(v)) ? Number(v) : NaN) : NaN);
const why = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, 300) : '');

module.exports = function adminRouter(db, audit) {
  const r = express.Router();
  const need = (res, a) => (a.length < 5 ? (res.status(400).json({ error: 'Alasan wajib diisi (minimal 5 karakter).', fields: { alasan: 'Alasan wajib diisi.' } }), false) : true);
  const row = (res, sql, id) => { const x = id > 0 ? db.prepare(sql).get(id) : null; if (!x) res.status(404).json({ error: 'Data tidak ditemukan.' }); return x; };

  r.get('/summary', (_req, res) => {
    const one = (s) => db.prepare(s).get();
    const u = one("SELECT COUNT(*) total, COALESCE(SUM(verifikasi='verified' AND aktif=1),0) aktif, COALESCE(SUM(verifikasi='pending'),0) menunggu FROM businesses");
    const p = one("SELECT COUNT(*) total, COALESCE(SUM(persetujuan='pending'),0) menunggu FROM products");
    const o = one("SELECT COUNT(*) total, COALESCE(SUM(status<>'batal'),0) sah FROM orders");
    const promo = one("SELECT COUNT(*) n FROM promotions WHERE aktif=1 AND dinonaktifkan_admin=0 AND date('now','+7 hours') BETWEEN mulai AND selesai").n;
    const kategori = db.prepare("SELECT kategori, COUNT(*) n FROM businesses WHERE verifikasi='verified' AND aktif=1 GROUP BY kategori ORDER BY n DESC").all();
    // Pertumbuhan: jumlah usaha terdaftar per bulan (6 bulan terakhir).
    const tumbuh = db.prepare("SELECT strftime('%Y-%m',created_at,'+7 hours') bln, COUNT(*) n FROM businesses WHERE created_at>=date('now','-5 months','start of month') GROUP BY bln ORDER BY bln").all();
    // Omzet agregat: hanya dari pesanan bernilai (memuat produk), tanpa pesanan batal.
    const omzet = one("SELECT COALESCE(SUM(i.harga_satuan*i.qty-i.potongan),0) v FROM order_items i JOIN orders o ON o.id=i.order_id WHERE o.status<>'batal'").v;
    const terbaru = db.prepare('SELECT a.aksi,a.objek,a.alasan,a.created_at,u.name FROM audit_log a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 6').all();
    res.json({ umkm: u, produk: p, pesanan: o, promoAktif: promo, kategori, tumbuh, omzet, terbaru });
  });

  /* ---------- UMKM & verifikasi ---------- */
  r.get('/businesses', (_req, res) => res.json({ items: db.prepare(`SELECT b.id,b.nama,b.pemilik,b.kategori,b.alamat,b.whatsapp,b.aktif,b.verifikasi,b.catatan,b.created_at,
      (SELECT email FROM users WHERE id=b.owner_id) email,
      (SELECT COUNT(*) FROM products WHERE business_id=b.id) produk,
      (SELECT COUNT(*) FROM orders WHERE business_id=b.id) pesanan FROM businesses b ORDER BY b.id DESC`).all() }));

  r.patch('/businesses/:id/verifikasi', (req, res) => {
    const b = row(res, 'SELECT id,nama FROM businesses WHERE id=?', int(req.params.id)); if (!b) return;
    const st = req.body && req.body.status, a = why(req.body && req.body.alasan);
    if (!['verified', 'rejected'].includes(st)) return res.status(400).json({ error: 'Status tidak valid.' });
    if (st === 'rejected' && !need(res, a)) return;
    db.transaction(() => {
      db.prepare('UPDATE businesses SET verifikasi=?,catatan=? WHERE id=?').run(st, st === 'rejected' ? a : '', b.id);
      audit(req, st === 'verified' ? 'umkm.verifikasi' : 'umkm.tolak', 'businesses:' + b.id, a);
    })();
    res.json({ ok: true });
  });

  r.patch('/businesses/:id/aktif', (req, res) => {
    const b = row(res, 'SELECT id FROM businesses WHERE id=?', int(req.params.id)); if (!b) return;
    const on = req.body && req.body.aktif ? 1 : 0, a = why(req.body && req.body.alasan);
    if (!on && !need(res, a)) return;
    db.prepare('UPDATE businesses SET aktif=? WHERE id=?').run(on, b.id);
    audit(req, on ? 'umkm.aktifkan' : 'umkm.nonaktifkan', 'businesses:' + b.id, a);
    res.json({ ok: true });
  });

  /* ---------- persetujuan produk ---------- */
  r.get('/products', (_req, res) => res.json({ items: db.prepare(`SELECT p.id,p.nama,p.kategori,p.deskripsi,p.harga,p.stok,p.persetujuan,p.catatan,p.tersedia,p.updated_at,b.nama usaha,b.verifikasi,
      (SELECT COUNT(*) FROM product_images WHERE product_id=p.id) foto FROM products p JOIN businesses b ON b.id=p.business_id ORDER BY (p.persetujuan='pending') DESC, p.id DESC`).all().map((p) => ({ ...p, fotos: db.prepare('SELECT file FROM product_images WHERE product_id=? ORDER BY urutan,id').all(p.id).map((x) => x.file) })) }));

  r.patch('/products/:id/persetujuan', (req, res) => {
    const p = row(res, 'SELECT p.id,b.verifikasi FROM products p JOIN businesses b ON b.id=p.business_id WHERE p.id=?', int(req.params.id)); if (!p) return;
    const st = req.body && req.body.status, a = why(req.body && req.body.alasan);
    if (!['approved', 'rejected', 'disabled'].includes(st)) return res.status(400).json({ error: 'Status tidak valid.' });
    if (st !== 'approved' && !need(res, a)) return;
    if (st === 'approved' && p.verifikasi !== 'verified') return res.status(400).json({ error: 'Usaha pemilik produk belum terverifikasi.' });
    db.transaction(() => {
      db.prepare("UPDATE products SET persetujuan=?,catatan=?,updated_at=datetime('now') WHERE id=?").run(st, st === 'approved' ? '' : a, p.id);
      audit(req, 'produk.' + { approved: 'setujui', rejected: 'tolak', disabled: 'nonaktifkan' }[st], 'products:' + p.id, a);
    })();
    res.json({ ok: true });
  });

  /* ---------- pengguna ---------- */
  r.get('/users', (_req, res) => res.json({ items: db.prepare('SELECT u.id,u.name,u.email,u.role,u.asal,u.aktif,u.created_at,(SELECT nama FROM businesses WHERE owner_id=u.id) usaha FROM users u ORDER BY u.id DESC').all() }));

  r.patch('/users/:id/aktif', (req, res) => {
    const u = row(res, 'SELECT id,role FROM users WHERE id=?', int(req.params.id)); if (!u) return;
    if (u.id === req.user.id) return res.status(400).json({ error: 'Anda tidak dapat menonaktifkan akun sendiri.' });
    if (u.role === 'admin') return res.status(403).json({ error: 'Akun admin tidak dapat dinonaktifkan dari sini.' });
    const on = req.body && req.body.aktif ? 1 : 0, a = why(req.body && req.body.alasan);
    if (!on && !need(res, a)) return;
    db.transaction(() => {
      db.prepare('UPDATE users SET aktif=? WHERE id=?').run(on, u.id);
      if (!on) db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id); // sesi langsung dicabut
      audit(req, on ? 'pengguna.aktifkan' : 'pengguna.nonaktifkan', 'users:' + u.id, a);
    })();
    res.json({ ok: true });
  });

  /* ---------- monitoring promo ---------- */
  r.get('/promos', (_req, res) => {
    const d = today(db);
    const rows = db.prepare(`SELECT p.id,p.nama,p.tipe,p.nilai,p.mulai,p.selesai,p.min_belanja,p.batas_pakai,p.aktif,p.dinonaktifkan_admin,p.catatan_admin,b.nama usaha,
        (SELECT kode FROM vouchers WHERE promotion_id=p.id) kode,
        (SELECT COUNT(*) FROM promo_usage u JOIN orders o ON o.id=u.order_id WHERE u.promotion_id=p.id AND o.status<>'batal') dipakai
      FROM promotions p JOIN businesses b ON b.id=p.business_id ORDER BY p.id DESC`).all();
    res.json({ items: rows.map((p) => ({ ...p, status: statusOf(p, d) })) });
  });
  r.patch('/promos/:id/aktif', (req, res) => {
    const p = row(res, 'SELECT id FROM promotions WHERE id=?', int(req.params.id)); if (!p) return;
    const on = req.body && req.body.aktif ? 1 : 0, a = why(req.body && req.body.alasan);
    if (!on && !need(res, a)) return;
    db.transaction(() => {
      db.prepare('UPDATE promotions SET dinonaktifkan_admin=?,catatan_admin=? WHERE id=?').run(on ? 0 : 1, on ? '' : a, p.id);
      audit(req, on ? 'promo.pulihkan' : 'promo.nonaktifkan_admin', 'promotions:' + p.id, a);
    })();
    res.json({ ok: true });
  });

  r.get('/audit', (_req, res) => res.json({ items: db.prepare('SELECT a.id,a.role,a.aksi,a.objek,a.alasan,a.created_at,u.name FROM audit_log a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 300').all() }));
  return r;
};
