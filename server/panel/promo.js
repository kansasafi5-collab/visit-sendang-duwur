'use strict';
// Mesin harga & diskon: SATU-SATUNYA tempat diskon dihitung. Harga selalu dibaca dari database, tidak pernah dari klien.
// Aturan: maksimal SATU promo per pesanan. Voucher (kode) menggantikan promo otomatis; tanpa voucher dipilih promo otomatis terbaik.
const today = (db) => db.prepare("SELECT date('now','+7 hours') d").get().d;

function statusOf(p, d) {
  if (p.dinonaktifkan_admin) return 'dinonaktifkan_admin';
  if (!p.aktif) return 'nonaktif';
  if (d < p.mulai) return 'terjadwal';
  if (d > p.selesai) return 'berakhir';
  if (p.batas_pakai != null && p.dipakai >= p.batas_pakai) return 'habis';
  return 'aktif';
}

function activePromos(db, bizId) {
  const d = today(db);
  return db.prepare(`SELECT p.*, (SELECT kode FROM vouchers WHERE promotion_id=p.id) kode,
      (SELECT COUNT(*) FROM promo_usage u JOIN orders o ON o.id=u.order_id WHERE u.promotion_id=p.id AND o.status<>'batal') dipakai
    FROM promotions p WHERE p.business_id=? AND p.aktif=1 AND p.dinonaktifkan_admin=0 AND ? BETWEEN p.mulai AND p.selesai`).all(bizId, d)
    .filter((p) => statusOf(p, d) === 'aktif')
    .map((p) => ({ ...p, produk: new Set(db.prepare('SELECT product_id FROM promotion_products WHERE promotion_id=?').all(p.id).map((x) => x.product_id)) }));
}

// lines: [{productId, harga, qty}] → { total, per: Map(productId → potongan) } atau null bila tidak memenuhi syarat.
function discountFor(promo, lines) {
  const el = lines.filter((l) => promo.produk.has(l.productId));
  const sub = el.reduce((s, l) => s + l.harga * l.qty, 0);
  if (!el.length || sub <= 0 || sub < promo.min_belanja) return null;
  const per = new Map(); let total = 0;
  if (promo.tipe === 'persen') {
    for (const l of el) { const d = Math.floor((l.harga * l.qty * promo.nilai) / 100); per.set(l.productId, d); total += d; }
  } else {
    total = Math.min(promo.nilai, sub); let left = total; // potongan nominal tidak melebihi harga barang
    for (const l of el) { const d = Math.min(left, l.harga * l.qty); per.set(l.productId, d); left -= d; }
  }
  return total > 0 ? { total, per } : null;
}

// items: [{productId, qty}] sudah tervalidasi bentuknya. Mengembalikan { error } atau { lines, subtotal, potongan, total, promo }.
function price(db, biz, items, voucher) {
  const lines = [];
  for (const it of items) {
    const p = db.prepare('SELECT id,nama,harga,stok,persetujuan,tersedia FROM products WHERE id=? AND business_id=?').get(it.productId, biz.id);
    if (!p || p.persetujuan !== 'approved' || !p.tersedia) return { error: 'Ada produk yang tidak tersedia.' };
    if (p.stok < it.qty) return { error: `Stok "${p.nama}" tidak mencukupi (tersisa ${p.stok}).`, status: 409 };
    lines.push({ productId: p.id, nama: p.nama, harga: p.harga, qty: it.qty });
  }
  const promos = activePromos(db, biz.id);
  let pick = null;
  const kode = String(voucher || '').trim().toUpperCase();
  if (kode) {
    const pr = promos.find((p) => p.kode && p.kode.toUpperCase() === kode);
    if (!pr) return { error: 'Kode voucher tidak valid atau sudah berakhir.' };
    const d = discountFor(pr, lines);
    if (!d) return { error: 'Voucher tidak memenuhi syarat (produk atau minimal belanja).' };
    pick = { pr, d };
  } else {
    for (const pr of promos.filter((p) => !p.kode)) { const d = discountFor(pr, lines); if (d && (!pick || d.total > pick.d.total)) pick = { pr, d }; }
  }
  const subtotal = lines.reduce((s, l) => s + l.harga * l.qty, 0);
  for (const l of lines) l.potongan = pick ? pick.d.per.get(l.productId) || 0 : 0;
  const potongan = pick ? pick.d.total : 0;
  return { lines, subtotal, potongan, total: subtotal - potongan, promo: pick ? { id: pick.pr.id, nama: pick.pr.nama, kode: pick.pr.kode || null } : null };
}

module.exports = { today, statusOf, activePromos, discountFor, price };
