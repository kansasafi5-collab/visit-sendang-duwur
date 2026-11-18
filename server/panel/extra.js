'use strict';
// Modul tambahan Dashboard: Inventaris, Laporan, Profil Toko, Pengaturan (UMKM) dan Laporan, Konten Website,
// Pengaturan (Admin). Migrasi bersifat ADITIF (tabel baru + 1 kolom baru), data lama tidak diubah.
const express = require('express');
const { hashPassword, verifyPassword } = require('../auth');

const str = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const txt = (v, max) => (typeof v === 'string' ? v.replace(/\r/g, '').trim().slice(0, max) : '');
const int = (v) => (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '') ? (Number.isInteger(Number(v)) ? Number(v) : NaN) : NaN);
const wa = (raw) => { const d = String(raw || '').replace(/\D/g, ''); return !d ? '' : d.startsWith('62') ? d : d.startsWith('0') ? '62' + d.slice(1) : d.startsWith('8') ? '62' + d : d; };
const NET = 'i.harga_satuan*i.qty-i.potongan';
const HARI = (v) => ([7, 30, 90].includes(int(v)) ? int(v) : 30);
const csvCell = (v) => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const csv = (res, nama, head, rows) => {
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${nama}"` });
  res.send('﻿' + [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n'));
};

function migrate(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS pengumuman (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    judul TEXT NOT NULL,
    isi TEXT NOT NULL DEFAULT '',
    jenis TEXT NOT NULL DEFAULT 'info' CHECK (jenis IN ('info','penting','acara')),
    tampil INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );`);
  const cols = db.prepare('PRAGMA table_info(businesses)').all().map((c) => c.name);
  if (!cols.includes('deskripsi')) db.exec("ALTER TABLE businesses ADD COLUMN deskripsi TEXT NOT NULL DEFAULT ''");
}

// Pengaturan akun: ganti kata sandi. Dipakai kedua role.
function accountRouter(db, audit) {
  const r = express.Router();
  r.post('/password', async (req, res) => {
    const lama = typeof req.body?.lama === 'string' ? req.body.lama : '', baru = typeof req.body?.baru === 'string' ? req.body.baru : '';
    if (baru.length < 8 || baru.length > 128) return res.status(400).json({ error: 'Data belum valid.', fields: { baru: 'Kata sandi baru minimal 8 karakter.' } });
    const u = db.prepare('SELECT id,pass_hash FROM users WHERE id=?').get(req.user.id);
    if (u.pass_hash && !(await verifyPassword(lama, u.pass_hash))) return res.status(400).json({ error: 'Kata sandi lama salah.', fields: { lama: 'Kata sandi lama salah.' } });
    db.prepare('UPDATE users SET pass_hash=? WHERE id=?').run(await hashPassword(baru), u.id);
    audit(req, 'akun.ganti_sandi', 'users:' + u.id);
    res.json({ ok: true });
  });
  return r;
}

function umkmRouter(db, audit) {
  const r = express.Router();
  r.use(accountRouter(db, audit));
  r.use((req, res, next) => {
    const b = db.prepare('SELECT id,nama,verifikasi,aktif FROM businesses WHERE owner_id=?').get(req.user.id);
    if (!b) return res.status(404).json({ error: 'Akun ini belum memiliki usaha.' });
    req.biz = b; next();
  });

  /* ---------- Inventaris ---------- */
  r.get('/inventory', (req, res) => {
    const items = db.prepare(`SELECT id,nama,kategori,harga,stok,stok_min,tersedia,persetujuan,
        (SELECT file FROM product_images WHERE product_id=products.id ORDER BY urutan,id LIMIT 1) foto
        FROM products WHERE business_id=? AND persetujuan<>'disabled' ORDER BY (stok<=stok_min) DESC, stok ASC, nama`).all(req.biz.id);
    const gerak = db.prepare(`SELECT m.id,m.delta,m.alasan,m.order_id,m.created_at,p.nama FROM stock_movements m JOIN products p ON p.id=m.product_id
        WHERE p.business_id=? ORDER BY m.id DESC LIMIT 40`).all(req.biz.id);
    const nilai = items.reduce((a, p) => a + p.stok * p.harga, 0);
    res.json({ items, gerak, ringkas: { jenis: items.length, unit: items.reduce((a, p) => a + p.stok, 0), nilai, menipis: items.filter((p) => p.stok <= p.stok_min && p.stok > 0).length, habis: items.filter((p) => p.stok === 0).length } });
  });

  /* ---------- Laporan penjualan ---------- */
  const laporan = (bizId, hari) => {
    const w = `o.business_id=? AND o.status<>'batal' AND date(o.created_at,'+7 hours')>=date('now','+7 hours',?)`;
    const dari = `-${hari - 1} days`;
    const tot = db.prepare(`SELECT COUNT(DISTINCT o.id) pesanan, COALESCE(SUM(i.qty),0) unit, COALESCE(SUM(i.harga_satuan*i.qty),0) kotor, COALESCE(SUM(i.potongan),0) potongan, COALESCE(SUM(${NET}),0) bersih FROM orders o JOIN order_items i ON i.order_id=o.id WHERE ${w}`).get(bizId, dari);
    const harian = db.prepare(`SELECT date(o.created_at,'+7 hours') d, COALESCE(SUM(${NET}),0) v, COUNT(DISTINCT o.id) n FROM orders o JOIN order_items i ON i.order_id=o.id WHERE ${w} GROUP BY d ORDER BY d`).all(bizId, dari);
    const produk = db.prepare(`SELECT i.product_id id, i.nama, SUM(i.qty) qty, SUM(${NET}) omzet FROM orders o JOIN order_items i ON i.order_id=o.id WHERE ${w} GROUP BY i.product_id, i.nama ORDER BY omzet DESC`).all(bizId, dari);
    const status = db.prepare(`SELECT status, COUNT(*) n FROM orders WHERE business_id=? AND date(created_at,'+7 hours')>=date('now','+7 hours',?) GROUP BY status`).all(bizId, dari);
    return { hari, tot: { ...tot, rata: tot.pesanan ? Math.round(tot.bersih / tot.pesanan) : 0 }, harian, produk, status };
  };
  r.get('/report', (req, res) => res.json(laporan(req.biz.id, HARI(req.query.hari))));
  r.get('/report.csv', (req, res) => {
    const h = HARI(req.query.hari), d = laporan(req.biz.id, h);
    csv(res, `laporan-penjualan-${h}hari.csv`, ['Produk', 'Terjual', 'Omzet (Rp)'], d.produk.map((p) => [p.nama, p.qty, p.omzet]));
  });

  /* ---------- Profil toko ---------- */
  r.get('/profile', (req, res) => res.json(db.prepare('SELECT id,nama,pemilik,kategori,alamat,whatsapp,deskripsi,verifikasi,aktif FROM businesses WHERE id=?').get(req.biz.id)));
  r.put('/profile', (req, res) => {
    const b = req.body || {}, f = {};
    const nama = str(b.nama, 100), pemilik = str(b.pemilik, 100), alamat = str(b.alamat, 150), deskripsi = txt(b.deskripsi, 600), whatsapp = wa(b.whatsapp);
    if (nama.length < 2) f.nama = 'Nama usaha minimal 2 huruf.';
    if (pemilik.length < 2) f.pemilik = 'Nama pemilik minimal 2 huruf.';
    if (!/^\d{8,20}$/.test(whatsapp)) f.whatsapp = 'Nomor WhatsApp harus angka (8–20 digit).';
    if (Object.keys(f).length) return res.status(400).json({ error: 'Data belum valid.', fields: f });
    db.prepare('UPDATE businesses SET nama=?,pemilik=?,alamat=?,whatsapp=?,deskripsi=? WHERE id=?').run(nama, pemilik, alamat, whatsapp, deskripsi, req.biz.id);
    audit(req, 'toko.ubah_profil', 'businesses:' + req.biz.id);
    res.json({ ok: true });
  });
  return r;
}

function adminRouter(db, audit) {
  const r = express.Router();
  r.use(accountRouter(db, audit));

  /* ---------- Laporan desa ---------- */
  const laporan = (hari) => {
    const w = `o.status<>'batal' AND date(o.created_at,'+7 hours')>=date('now','+7 hours',?)`, dari = `-${hari - 1} days`;
    const tot = db.prepare(`SELECT COUNT(DISTINCT o.id) pesanan, COALESCE(SUM(i.qty),0) unit, COALESCE(SUM(${NET}),0) omzet, COALESCE(SUM(i.potongan),0) potongan, COUNT(DISTINCT o.business_id) usaha FROM orders o JOIN order_items i ON i.order_id=o.id WHERE ${w}`).get(dari);
    const harian = db.prepare(`SELECT date(o.created_at,'+7 hours') d, COALESCE(SUM(${NET}),0) v FROM orders o JOIN order_items i ON i.order_id=o.id WHERE ${w} GROUP BY d ORDER BY d`).all(dari);
    const usaha = db.prepare(`SELECT b.id,b.nama,b.kategori, COUNT(DISTINCT o.id) pesanan, COALESCE(SUM(i.qty),0) unit, COALESCE(SUM(${NET}),0) omzet FROM orders o JOIN order_items i ON i.order_id=o.id JOIN businesses b ON b.id=o.business_id WHERE ${w} GROUP BY b.id ORDER BY omzet DESC`).all(dari);
    const kategori = db.prepare(`SELECT b.kategori, COALESCE(SUM(${NET}),0) omzet, COUNT(DISTINCT o.id) pesanan FROM orders o JOIN order_items i ON i.order_id=o.id JOIN businesses b ON b.id=o.business_id WHERE ${w} GROUP BY b.kategori ORDER BY omzet DESC`).all(dari);
    const produk = db.prepare(`SELECT i.nama, SUM(i.qty) qty, SUM(${NET}) omzet FROM orders o JOIN order_items i ON i.order_id=o.id WHERE ${w} GROUP BY i.product_id, i.nama ORDER BY qty DESC LIMIT 8`).all(dari);
    const baru = db.prepare("SELECT COUNT(*) n FROM businesses WHERE date(created_at,'+7 hours')>=date('now','+7 hours',?)").get(dari).n;
    return { hari, tot: { ...tot, rata: tot.pesanan ? Math.round(tot.omzet / tot.pesanan) : 0, baru }, harian, usaha, kategori, produk };
  };
  r.get('/report', (req, res) => res.json(laporan(HARI(req.query.hari))));
  r.get('/report.csv', (req, res) => {
    const h = HARI(req.query.hari), d = laporan(h);
    csv(res, `laporan-desa-${h}hari.csv`, ['Usaha', 'Kategori', 'Pesanan', 'Unit', 'Omzet (Rp)'], d.usaha.map((u) => [u.nama, u.kategori, u.pesanan, u.unit, u.omzet]));
  });

  /* ---------- Konten website: pengumuman ---------- */
  r.get('/content', (_req, res) => res.json({ items: db.prepare('SELECT id,judul,isi,jenis,tampil,created_at,updated_at FROM pengumuman ORDER BY id DESC').all() }));
  const baca = (b) => {
    const f = {}, judul = str(b.judul, 90), isi = txt(b.isi, 600), jenis = ['info', 'penting', 'acara'].includes(b.jenis) ? b.jenis : 'info';
    if (judul.length < 3) f.judul = 'Judul minimal 3 huruf.';
    return { f, v: { judul, isi, jenis, tampil: b.tampil === false || b.tampil === 0 ? 0 : 1 } };
  };
  r.post('/content', (req, res) => {
    const { f, v } = baca(req.body || {}); if (Object.keys(f).length) return res.status(400).json({ error: 'Data belum valid.', fields: f });
    const id = Number(db.prepare('INSERT INTO pengumuman (judul,isi,jenis,tampil) VALUES (?,?,?,?)').run(v.judul, v.isi, v.jenis, v.tampil).lastInsertRowid);
    audit(req, 'konten.tambah', 'pengumuman:' + id, v.judul); res.status(201).json({ id });
  });
  r.put('/content/:id', (req, res) => {
    const id = int(req.params.id); if (!(id > 0) || !db.prepare('SELECT 1 FROM pengumuman WHERE id=?').get(id)) return res.status(404).json({ error: 'Pengumuman tidak ditemukan.' });
    const { f, v } = baca(req.body || {}); if (Object.keys(f).length) return res.status(400).json({ error: 'Data belum valid.', fields: f });
    db.prepare("UPDATE pengumuman SET judul=?,isi=?,jenis=?,tampil=?,updated_at=datetime('now') WHERE id=?").run(v.judul, v.isi, v.jenis, v.tampil, id);
    audit(req, 'konten.ubah', 'pengumuman:' + id, v.judul); res.json({ ok: true });
  });
  r.delete('/content/:id', (req, res) => {
    const id = int(req.params.id); if (!(id > 0) || !db.prepare('SELECT 1 FROM pengumuman WHERE id=?').get(id)) return res.status(404).json({ error: 'Pengumuman tidak ditemukan.' });
    db.prepare('DELETE FROM pengumuman WHERE id=?').run(id); audit(req, 'konten.hapus', 'pengumuman:' + id); res.json({ ok: true });
  });

  /* ---------- Pengaturan: status layanan (tanpa membuka nilai rahasia) ---------- */
  r.get('/system', (_req, res) => {
    const n = (t) => db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n;
    res.json({
      layanan: [
        ['Login Google', !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)],
        ['Email reset kata sandi (SMTP)', !!(process.env.SMTP_USER && process.env.SMTP_PASS)],
        ['Asisten AI (Anthropic)', !!process.env.ANTHROPIC_API_KEY],
        ['Mode produksi (HTTPS)', process.env.NODE_ENV === 'production'],
      ],
      data: { pengguna: n('users'), usaha: n('businesses'), produk: n('products'), pesanan: n('orders'), pengumuman: n('pengumuman') },
      baseUrl: process.env.BASE_URL || '', node: process.version,
    });
  });
  return r;
}

// Publik: pengumuman yang ditampilkan (tanpa data pribadi).
function publicRouter(db) {
  const r = express.Router();
  r.get('/pengumuman', (_req, res) => res.json({ items: db.prepare('SELECT id,judul,isi,jenis,created_at FROM pengumuman WHERE tampil=1 ORDER BY id DESC LIMIT 5').all() }));
  return r;
}

module.exports = { migrate, umkmRouter, adminRouter, publicRouter };
