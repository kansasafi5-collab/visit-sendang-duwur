'use strict';
// Endpoint publik: etalase toko, pratinjau harga, dan checkout. Pesanan dicatat lalu pembeli diarahkan ke WhatsApp penjual.
// Belum ada payment gateway: server TIDAK menyatakan pembayaran berhasil.
const rateLimit = require('express-rate-limit');
const { price, activePromos } = require('./promo');

const int = (v) => (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '') ? (Number.isInteger(Number(v)) ? Number(v) : NaN) : NaN);
const str = (v, m) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, m) : '');
const wa = (raw) => { const d = String(raw || '').replace(/\D/g, ''); return !d ? '' : d.startsWith('62') ? d : d.startsWith('0') ? '62' + d.slice(1) : d.startsWith('8') ? '62' + d : d; };
const PHONE_RE = /^[0-9+\-\s]{8,20}$/;

function readItems(body) {
  const raw = Array.isArray(body && body.items) ? body.items.slice(0, 20) : [];
  const m = new Map();
  for (const x of raw) { const id = int(x && x.productId), q = int(x && x.qty); if (!(id > 0) || !(q >= 1 && q <= 999)) return null; m.set(id, Math.min(999, (m.get(id) || 0) + q)); }
  return m.size ? [...m].map(([productId, qty]) => ({ productId, qty })) : null;
}

module.exports = function mountCheckout(app, { db, auth }) {
  const limiter = rateLimit({ windowMs: 10 * 60 * 1000, limit: 40, standardHeaders: true, legacyHeaders: false, message: { error: 'Terlalu banyak permintaan. Coba lagi nanti.' } });
  const shop = (id) => (id > 0 ? db.prepare("SELECT id,nama,kategori,alamat,whatsapp FROM businesses WHERE id=? AND aktif=1 AND verifikasi='verified'").get(id) : null);

  // Daftar toko yang punya produk disetujui; dipakai marketplace untuk menampilkan tautan "Lihat produk". Tanpa data pribadi.
  app.get('/api/toko', (_req, res) => res.json({ items: db.prepare("SELECT b.id, COUNT(p.id) produk FROM businesses b JOIN products p ON p.business_id=b.id AND p.persetujuan='approved' AND p.tersedia=1 WHERE b.aktif=1 AND b.verifikasi='verified' GROUP BY b.id").all().map((x) => ({ id: x.id, produk: x.produk, promo: activePromos(db, x.id).some((p) => !p.kode) })) }));

  app.get('/api/toko/:id', (req, res) => {
    const b = shop(int(req.params.id)); if (!b) return res.status(404).json({ error: 'Toko tidak ditemukan.' });
    const promos = activePromos(db, b.id).filter((p) => !p.kode); // kode voucher tidak ditampilkan publik
    const produk = db.prepare("SELECT id,nama,deskripsi,kategori,harga,stok FROM products WHERE business_id=? AND persetujuan='approved' AND tersedia=1 ORDER BY nama COLLATE NOCASE").all(b.id)
      .map((p) => ({ ...p, fotos: db.prepare('SELECT file FROM product_images WHERE product_id=? ORDER BY urutan,id').all(p.id).map((x) => x.file), promo: promos.filter((x) => x.produk.has(p.id)).map((x) => ({ nama: x.nama, tipe: x.tipe, nilai: x.nilai, min_belanja: x.min_belanja, selesai: x.selesai })) }));
    res.json({ toko: { id: b.id, nama: b.nama, kategori: b.kategori, alamat: b.alamat, wa: wa(b.whatsapp) }, produk });
  });

  const run = (req, res, commit) => {
    const b = shop(int(req.body && req.body.businessId));
    if (!b) return res.status(404).json({ error: 'Toko tidak ditemukan.' });
    const items = readItems(req.body); if (!items) return res.status(400).json({ error: 'Pilih minimal satu produk (jumlah 1–999).' });
    const pemesan = str(req.body.pemesan, 60), kontak = str(req.body.kontak, 20), fields = {};
    if (commit) { if (pemesan.length < 2) fields.pemesan = 'Tulis nama Anda.'; if (kontak && !PHONE_RE.test(kontak)) fields.kontak = 'Nomor WhatsApp harus angka.'; }
    if (Object.keys(fields).length) return res.status(400).json({ error: 'Data belum lengkap.', fields });
    try {
      const out = db.transaction(() => {
        const q = price(db, b, items, req.body.voucher); // dihitung ulang di dalam transaksi: stok & batas pakai terbaru
        if (q.error) throw Object.assign(new Error(q.error), { user: true, status: q.status || 400 });
        if (!commit) return q;
        for (const l of q.lines) { // potong stok bersyarat: gagal bila stok sudah berubah
          if (!db.prepare("UPDATE products SET stok=stok-? WHERE id=? AND stok>=?").run(l.qty, l.productId, l.qty).changes) throw Object.assign(new Error(`Stok "${l.nama}" tidak mencukupi.`), { user: true, status: 409 });
        }
        const ringkas = q.lines.map((l) => `${l.qty}× ${l.nama}`).join(', ').slice(0, 1000);
        const oid = Number(db.prepare('INSERT INTO orders (business_id,business_nama,pemesan,pesanan,jumlah,user_id,kontak) VALUES (?,?,?,?,?,?,?)').run(b.id, b.nama, pemesan, ringkas, q.lines.reduce((s, l) => s + l.qty, 0), req.user ? req.user.id : null, kontak).lastInsertRowid);
        for (const l of q.lines) {
          db.prepare('INSERT INTO order_items (order_id,product_id,nama,harga_satuan,qty,potongan) VALUES (?,?,?,?,?,?)').run(oid, l.productId, l.nama, l.harga, l.qty, l.potongan);
          db.prepare("INSERT INTO stock_movements (product_id,delta,alasan,order_id) VALUES (?,?,'pesanan',?)").run(l.productId, -l.qty, oid);
        }
        if (q.promo) db.prepare('INSERT INTO promo_usage (promotion_id,order_id,potongan) VALUES (?,?,?)').run(q.promo.id, oid, q.potongan);
        return { ...q, id: oid };
      })();
      res.status(commit ? 201 : 200).json({ ...out, wa: commit ? wa(b.whatsapp) : undefined });
    } catch (e) {
      if (e.user) return res.status(e.status).json({ error: e.message });
      throw e;
    }
  };
  app.post('/api/checkout/preview', limiter, (req, res) => run(req, res, false));
  app.post('/api/checkout', limiter, auth.load, (req, res) => run(req, res, true));
};
