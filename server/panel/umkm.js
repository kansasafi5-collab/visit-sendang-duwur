'use strict';
// API Dashboard UMKM. Semua query dibatasi ke usaha milik sesi (owner_id = req.user.id); id dari klien tidak dipercaya.
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const up = require('./uploads');
const { today, statusOf } = require('./promo');

const str = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const txt = (v, max) => (typeof v === 'string' ? v.replace(/\r/g, '').trim().slice(0, max) : '');
const int = (v) => (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '') ? (Number.isInteger(Number(v)) ? Number(v) : NaN) : NaN);
const wa = (raw) => { const d = String(raw || '').replace(/\D/g, ''); return !d ? '' : d.startsWith('62') ? d : d.startsWith('0') ? '62' + d.slice(1) : d.startsWith('8') ? '62' + d : d; };
// Alur status pesanan: hanya maju, atau dibatalkan sebelum selesai.
const FLOW = { baru: ['proses', 'batal'], proses: ['siap', 'batal'], siap: ['selesai', 'batal'], selesai: [], batal: [] };
const NET = 'i.harga_satuan*i.qty-i.potongan';

module.exports = function umkmRouter(db, audit) {
  const r = express.Router();
  r.use((req, res, next) => {
    const b = db.prepare('SELECT id,nama,verifikasi,aktif FROM businesses WHERE owner_id=?').get(req.user.id);
    if (!b) return res.status(404).json({ error: 'Akun ini belum memiliki usaha.' });
    req.biz = b; next();
  });
  const canSell = (req, res, next) => (req.biz.verifikasi === 'verified' ? next() : res.status(403).json({ error: 'Usaha harus diverifikasi admin sebelum mengelola produk.' }));
  const myProduct = (req) => { const id = int(req.params.id); return id > 0 ? db.prepare('SELECT * FROM products WHERE id=? AND business_id=?').get(id, req.biz.id) : null; };
  const bad = (res, fields) => res.status(400).json({ error: 'Data belum valid.', fields });

  /* ---------- ringkasan: semua angka dari database ---------- */
  r.get('/summary', (req, res) => {
    const id = req.biz.id;
    const p = db.prepare("SELECT COUNT(*) total, COALESCE(SUM(persetujuan='approved' AND tersedia=1),0) aktif, COALESCE(SUM(persetujuan='pending'),0) pending, COALESCE(SUM(stok<=stok_min AND persetujuan<>'disabled'),0) menipis FROM products WHERE business_id=?").get(id);
    const o = db.prepare("SELECT COUNT(*) total, COALESCE(SUM(status='baru'),0) baru FROM orders WHERE business_id=?").get(id);
    // Pembatalan tidak dihitung sebagai penjualan. Pendapatan = pesanan selesai.
    const m = db.prepare(`SELECT COALESCE(SUM(${NET}),0) penjualan, COALESCE(SUM(CASE WHEN o.status='selesai' THEN ${NET} END),0) pendapatan, COUNT(DISTINCT o.id) pesanan FROM order_items i JOIN orders o ON o.id=i.order_id WHERE o.business_id=? AND o.status<>'batal'`).get(id);
    const days = new Map(db.prepare(`SELECT date(o.created_at,'+7 hours') d, SUM(${NET}) v FROM order_items i JOIN orders o ON o.id=i.order_id WHERE o.business_id=? AND o.status<>'batal' AND date(o.created_at,'+7 hours')>=date('now','+7 hours','-6 days') GROUP BY d`).all(id).map((x) => [x.d, x.v]));
    const harian = [];
    for (let k = 6; k >= 0; k--) { const d = db.prepare("SELECT date('now','+7 hours',?) d").get(`-${k} days`).d; harian.push({ d, v: days.get(d) || 0 }); }
    const terlaris = db.prepare("SELECT i.nama, SUM(i.qty) qty FROM order_items i JOIN orders o ON o.id=i.order_id WHERE o.business_id=? AND o.status<>'batal' GROUP BY COALESCE(i.product_id,i.nama) ORDER BY qty DESC LIMIT 5").all(id);
    const terbaru = db.prepare('SELECT id,pemesan,status,created_at FROM orders WHERE business_id=? ORDER BY id DESC LIMIT 5').all(id);
    res.json({ toko: { nama: req.biz.nama, verifikasi: req.biz.verifikasi, aktif: !!req.biz.aktif }, produk: p, pesanan: { ...o, bernilai: m.pesanan }, penjualan: m.penjualan, pendapatan: m.pendapatan, harian, terlaris, terbaru });
  });

  /* ---------- produk ---------- */
  function readProduct(b, partial) {
    const f = {}, v = {
      nama: str(b.nama, 100), kategori: str(b.kategori, 60), deskripsi: txt(b.deskripsi, 1000),
      harga: int(b.harga), stok_min: b.stok_min === undefined || b.stok_min === '' ? 5 : int(b.stok_min),
    };
    if (v.nama.length < 2) f.nama = 'Tulis nama produk (min. 2 huruf).';
    if (!(v.harga >= 0 && v.harga <= 100000000)) f.harga = 'Harga harus bilangan bulat rupiah 0–100.000.000.';
    if (!(v.stok_min >= 0 && v.stok_min <= 100000)) f.stok_min = 'Batas stok menipis 0–100.000.';
    if (!partial) { v.stok = b.stok === undefined || b.stok === '' ? 0 : int(b.stok); if (!(v.stok >= 0 && v.stok <= 100000)) f.stok = 'Stok awal 0–100.000.'; }
    return { v, f };
  }
  r.get('/products', (req, res) => {
    const imgs = db.prepare('SELECT i.id,i.product_id,i.file FROM product_images i JOIN products p ON p.id=i.product_id WHERE p.business_id=? ORDER BY i.urutan,i.id').all(req.biz.id);
    res.json({ items: db.prepare('SELECT * FROM products WHERE business_id=? ORDER BY id DESC').all(req.biz.id).map((p) => ({ ...p, fotos: imgs.filter((i) => i.product_id === p.id).map((i) => ({ id: i.id, file: i.file })) })) });
  });

  r.post('/products', canSell, (req, res) => {
    const { v, f } = readProduct(req.body || {}, false);
    if (Object.keys(f).length) return bad(res, f);
    const id = db.transaction(() => {
      const pid = Number(db.prepare('INSERT INTO products (business_id,nama,deskripsi,kategori,harga,stok,stok_min) VALUES (?,?,?,?,?,?,?)').run(req.biz.id, v.nama, v.deskripsi, v.kategori, v.harga, v.stok, v.stok_min).lastInsertRowid);
      if (v.stok > 0) db.prepare("INSERT INTO stock_movements (product_id,delta,alasan) VALUES (?,?,'manual')").run(pid, v.stok);
      audit(req, 'produk.tambah', 'products:' + pid);
      return pid;
    })();
    res.status(201).json({ id, persetujuan: 'pending' }); // wajib disetujui admin sebelum tampil di halaman publik
  });

  r.put('/products/:id', canSell, (req, res) => {
    const p = myProduct(req); if (!p) return res.status(404).json({ error: 'Produk tidak ditemukan.' });
    const { v, f } = readProduct(req.body || {}, true);
    if (Object.keys(f).length) return bad(res, f);
    const tersedia = req.body.tersedia === false || req.body.tersedia === 0 ? 0 : 1;
    // Perubahan isi (nama/deskripsi/kategori) pada produk yang sudah disetujui harus ditinjau ulang. Harga dan stok tidak.
    const isiBerubah = v.nama !== p.nama || v.deskripsi !== p.deskripsi || v.kategori !== p.kategori;
    const persetujuan = isiBerubah && p.persetujuan === 'approved' ? 'pending' : p.persetujuan;
    db.transaction(() => {
      db.prepare("UPDATE products SET nama=?,deskripsi=?,kategori=?,harga=?,stok_min=?,tersedia=?,persetujuan=?,updated_at=datetime('now') WHERE id=?").run(v.nama, v.deskripsi, v.kategori, v.harga, v.stok_min, tersedia, persetujuan, p.id);
      audit(req, 'produk.ubah', 'products:' + p.id, v.harga !== p.harga ? `harga ${p.harga} -> ${v.harga}` : '');
    })();
    res.json({ ok: true, persetujuan, ditinjauUlang: persetujuan !== p.persetujuan });
  });

  r.post('/products/:id/stok', canSell, (req, res) => {
    const p = myProduct(req); if (!p) return res.status(404).json({ error: 'Produk tidak ditemukan.' });
    const delta = int(req.body && req.body.delta), alasan = ['manual', 'koreksi'].includes(req.body.alasan) ? req.body.alasan : 'manual';
    if (!delta || Math.abs(delta) > 100000) return bad(res, { delta: 'Isi angka bukan nol (positif menambah, negatif mengurangi).' });
    if (p.stok + delta < 0) return bad(res, { delta: `Stok tidak boleh negatif (stok sekarang ${p.stok}).` });
    db.transaction(() => {
      db.prepare("UPDATE products SET stok=stok+?,updated_at=datetime('now') WHERE id=?").run(delta, p.id);
      db.prepare('INSERT INTO stock_movements (product_id,delta,alasan) VALUES (?,?,?)').run(p.id, delta, alasan);
      audit(req, 'stok.' + alasan, 'products:' + p.id, `${delta > 0 ? '+' : ''}${delta}`);
    })();
    res.json({ ok: true, stok: p.stok + delta });
  });

  r.delete('/products/:id', canSell, (req, res) => {
    const p = myProduct(req); if (!p) return res.status(404).json({ error: 'Produk tidak ditemukan.' });
    // Produk yang pernah dipesan tidak dihapus (riwayat transaksi harus utuh): diarsipkan sebagai tidak tersedia.
    const pernah = db.prepare('SELECT 1 FROM order_items WHERE product_id=? LIMIT 1').get(p.id);
    if (pernah) db.prepare("UPDATE products SET tersedia=0,updated_at=datetime('now') WHERE id=?").run(p.id);
    else {
      for (const x of db.prepare('SELECT file FROM product_images WHERE product_id=?').all(p.id)) { try { fs.unlinkSync(path.join(up.DIR, x.file)); } catch { /* berkas sudah tidak ada */ } }
      db.prepare('DELETE FROM products WHERE id=?').run(p.id);
    }
    audit(req, pernah ? 'produk.arsip' : 'produk.hapus', 'products:' + p.id);
    res.json({ ok: true, diarsipkan: !!pernah });
  });

  /* ---------- pesanan ---------- */
  r.get('/orders', (req, res) => {
    const rows = db.prepare('SELECT id,pemesan,pesanan,jumlah,kontak,status,created_at FROM orders WHERE business_id=? ORDER BY id DESC LIMIT 300').all(req.biz.id);
    const items = new Map();
    if (rows.length) for (const it of db.prepare(`SELECT order_id,nama,harga_satuan,qty,potongan FROM order_items WHERE order_id IN (${rows.map(() => '?').join(',')})`).all(...rows.map((x) => x.id))) (items.get(it.order_id) || items.set(it.order_id, []).get(it.order_id)).push(it);
    res.json({ items: rows.map((o) => { const it = items.get(o.id) || []; return { ...o, wa: wa(o.kontak), items: it, total: it.length ? it.reduce((s, x) => s + x.harga_satuan * x.qty - x.potongan, 0) : null, next: FLOW[o.status] }; }) });
  });

  r.patch('/orders/:id', (req, res) => {
    const id = int(req.params.id), to = req.body && req.body.status;
    const o = id > 0 ? db.prepare('SELECT id,status FROM orders WHERE id=? AND business_id=?').get(id, req.biz.id) : null;
    if (!o) return res.status(404).json({ error: 'Pesanan tidak ditemukan.' });
    if (!FLOW[o.status].includes(to)) return res.status(400).json({ error: `Status "${o.status}" tidak dapat diubah menjadi "${to}".` });
    db.transaction(() => {
      db.prepare('UPDATE orders SET status=? WHERE id=?').run(to, o.id);
      if (to === 'batal') // stok yang dipotong saat pemesanan dikembalikan
        for (const it of db.prepare('SELECT product_id,qty FROM order_items WHERE order_id=? AND product_id IS NOT NULL').all(o.id)) {
          db.prepare('UPDATE products SET stok=stok+? WHERE id=?').run(it.qty, it.product_id);
          db.prepare("INSERT INTO stock_movements (product_id,delta,alasan,order_id) VALUES (?,?,'batal',?)").run(it.product_id, it.qty, o.id);
        }
      audit(req, 'pesanan.' + to, 'orders:' + o.id);
    })();
    res.json({ ok: true, status: to });
  });

  /* ---------- promo & diskon (perhitungan ada di promo.js, dipakai juga oleh checkout) ---------- */
  const validDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + 'T00:00:00Z'));
  const USED = "(SELECT COUNT(*) FROM promo_usage u JOIN orders o ON o.id=u.order_id WHERE u.promotion_id=p.id AND o.status<>'batal')";
  r.get('/promos', (req, res) => {
    const d = today(db);
    const rows = db.prepare(`SELECT p.*, (SELECT kode FROM vouchers WHERE promotion_id=p.id) kode, ${USED} dipakai,
        (SELECT COALESCE(SUM(u.potongan),0) FROM promo_usage u JOIN orders o ON o.id=u.order_id WHERE u.promotion_id=p.id AND o.status<>'batal') total_potongan,
        (SELECT COALESCE(SUM(i.harga_satuan*i.qty-i.potongan),0) FROM order_items i JOIN promo_usage u ON u.order_id=i.order_id JOIN orders o ON o.id=i.order_id WHERE u.promotion_id=p.id AND o.status<>'batal') omzet
      FROM promotions p WHERE p.business_id=? ORDER BY p.id DESC`).all(req.biz.id);
    const prods = db.prepare('SELECT pp.promotion_id pid,p.nama FROM promotion_products pp JOIN products p ON p.id=pp.product_id WHERE p.business_id=?').all(req.biz.id);
    res.json({ items: rows.map((p) => ({ ...p, status: statusOf(p, d), produk: prods.filter((x) => x.pid === p.id).map((x) => x.nama) })) });
  });

  r.post('/promos', canSell, (req, res) => {
    const b = req.body || {}, f = {};
    const nama = str(b.nama, 80), tipe = ['persen', 'nominal'].includes(b.tipe) ? b.tipe : null, nilai = int(b.nilai);
    const min = b.min_belanja === '' || b.min_belanja == null ? 0 : int(b.min_belanja), batas = b.batas_pakai === '' || b.batas_pakai == null ? null : int(b.batas_pakai);
    const kode = str(b.kode, 20).toUpperCase().replace(/\s/g, ''), ids = [...new Set((Array.isArray(b.productIds) ? b.productIds : []).map(int))].filter((x) => x > 0);
    if (nama.length < 3) f.nama = 'Tulis nama promo (min. 3 huruf).';
    if (!tipe) f.tipe = 'Pilih jenis diskon.';
    else if (tipe === 'persen' ? !(nilai >= 1 && nilai <= 90) : !(nilai >= 1 && nilai <= 100000000)) f.nilai = tipe === 'persen' ? 'Persen diskon 1–90.' : 'Potongan 1–100.000.000 rupiah.';
    if (!validDate(b.mulai)) f.mulai = 'Tanggal mulai tidak valid.';
    if (!validDate(b.selesai)) f.selesai = 'Tanggal berakhir tidak valid.';
    else if (validDate(b.mulai) && b.selesai < b.mulai) f.selesai = 'Tanggal berakhir tidak boleh sebelum tanggal mulai.';
    if (!(min >= 0 && min <= 100000000)) f.min_belanja = 'Minimum belanja harus bilangan bulat ≥ 0.';
    if (batas !== null && !(batas >= 1 && batas <= 1000000)) f.batas_pakai = 'Batas pemakaian minimal 1, atau kosongkan.';
    if (kode && !/^[A-Z0-9]{3,20}$/.test(kode)) f.kode = 'Kode 3–20 huruf/angka tanpa spasi.';
    else if (kode && db.prepare('SELECT 1 FROM vouchers WHERE kode=?').get(kode)) f.kode = 'Kode ini sudah dipakai.';
    const own = ids.length ? db.prepare(`SELECT id FROM products WHERE business_id=? AND id IN (${ids.map(() => '?').join(',')})`).all(req.biz.id, ...ids) : [];
    if (!ids.length || own.length !== ids.length) f.productIds = 'Pilih minimal satu produk milik Anda.';
    if (Object.keys(f).length) return res.status(400).json({ error: 'Data belum valid.', fields: f });
    const id = db.transaction(() => {
      const pid = Number(db.prepare('INSERT INTO promotions (business_id,nama,tipe,nilai,mulai,selesai,min_belanja,batas_pakai) VALUES (?,?,?,?,?,?,?,?)').run(req.biz.id, nama, tipe, nilai, b.mulai, b.selesai, min, batas).lastInsertRowid);
      for (const x of ids) db.prepare('INSERT INTO promotion_products (promotion_id,product_id) VALUES (?,?)').run(pid, x);
      if (kode) db.prepare('INSERT INTO vouchers (promotion_id,kode) VALUES (?,?)').run(pid, kode);
      audit(req, 'promo.buat', 'promotions:' + pid, `${tipe} ${nilai}`);
      return pid;
    })();
    res.status(201).json({ id });
  });

  r.patch('/promos/:id/aktif', canSell, (req, res) => {
    const id = int(req.params.id), p = id > 0 ? db.prepare('SELECT id,dinonaktifkan_admin FROM promotions WHERE id=? AND business_id=?').get(id, req.biz.id) : null;
    if (!p) return res.status(404).json({ error: 'Promo tidak ditemukan.' });
    if (p.dinonaktifkan_admin) return res.status(403).json({ error: 'Promo ini dinonaktifkan admin desa dan tidak dapat diaktifkan sendiri.' });
    const on = req.body && req.body.aktif ? 1 : 0;
    db.prepare('UPDATE promotions SET aktif=? WHERE id=?').run(on, p.id); audit(req, on ? 'promo.aktifkan' : 'promo.nonaktifkan', 'promotions:' + p.id);
    res.json({ ok: true });
  });

  /* ---------- foto produk (maks. 5 per produk, 3 MB, JPG/PNG/WebP) ---------- */
  const MAX_FOTO = 5;
  r.post('/products/:id/foto', canSell, express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '3mb' }), (req, res) => {
    const p = myProduct(req); if (!p) return res.status(404).json({ error: 'Produk tidak ditemukan.' });
    const buf = Buffer.isBuffer(req.body) ? req.body : null;
    if (!buf || !buf.length) return res.status(400).json({ error: 'Pilih berkas gambar JPG, PNG, atau WebP (maksimal 3 MB).' });
    const ext = up.kind(buf);
    if (!ext) return res.status(400).json({ error: 'Berkas bukan gambar JPG, PNG, atau WebP yang valid.' });
    if (db.prepare('SELECT COUNT(*) n FROM product_images WHERE product_id=?').get(p.id).n >= MAX_FOTO) return res.status(400).json({ error: `Maksimal ${MAX_FOTO} foto per produk.` });
    const name = crypto.randomBytes(12).toString('hex') + '.' + ext;
    fs.writeFileSync(path.join(up.DIR, name), buf, { flag: 'wx' });
    let id;
    try {
      db.transaction(() => {
        id = Number(db.prepare('INSERT INTO product_images (product_id,file,urutan) VALUES (?,?,?)').run(p.id, name, Date.now() % 1e9).lastInsertRowid);
        // Foto baru pada produk yang sudah disetujui perlu ditinjau ulang admin (admin memeriksa foto).
        if (p.persetujuan === 'approved') db.prepare("UPDATE products SET persetujuan='pending',updated_at=datetime('now') WHERE id=?").run(p.id);
        audit(req, 'produk.foto_tambah', 'products:' + p.id);
      })();
    } catch (e) { try { fs.unlinkSync(path.join(up.DIR, name)); } catch { /* abaikan */ } throw e; }
    res.status(201).json({ id, file: name, ditinjauUlang: p.persetujuan === 'approved' });
  });
  r.delete('/products/:id/foto/:fid', canSell, (req, res) => {
    const p = myProduct(req), fid = int(req.params.fid);
    const f = p && fid > 0 ? db.prepare('SELECT id,file FROM product_images WHERE id=? AND product_id=?').get(fid, p.id) : null;
    if (!f) return res.status(404).json({ error: 'Foto tidak ditemukan.' });
    db.prepare('DELETE FROM product_images WHERE id=?').run(f.id);
    try { fs.unlinkSync(path.join(up.DIR, f.file)); } catch { /* sudah tidak ada */ }
    audit(req, 'produk.foto_hapus', 'products:' + p.id);
    res.json({ ok: true });
  });
  r.use((err, _req, res, next) => (err && err.type === 'entity.too.large' ? res.status(413).json({ error: 'Ukuran foto maksimal 3 MB.' }) : next(err)));

  return r;
};
