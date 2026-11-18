'use strict';
// AI Business Intelligence untuk UMKM. Prinsip: SEMUA angka dihitung server dari data nyata; AI hanya menjelaskan angka itu.
// Bila AI tidak tersedia, hasil hitungan tetap dikirim.
const express = require('express');
const ai = require('./ai');

const num = (v) => (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '') ? Number(v) : NaN);
const str = (v, m) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, m) : '');
const rp = (n) => 'Rp' + Math.round(n).toLocaleString('id-ID');
const NET = 'i.harga_satuan*i.qty-i.potongan';

async function narrate(db, req, fitur, periode, system, data) {
  if (!ai.available()) return { tersedia: false, alasan: 'Penjelasan AI belum tersedia (ANTHROPIC_API_KEY belum diisi). Angka di atas tetap berasal dari data Anda.' };
  try {
    const teks = await ai.ask({ system, maxTokens: 700, messages: [{ role: 'user', content: 'Data hasil hitungan (JSON):\n' + JSON.stringify(data) }] });
    db.prepare('INSERT INTO ai_history (user_id,fitur,pertanyaan,jawaban,periode) VALUES (?,?,?,?,?)').run(req.user.id, fitur, fitur, teks.slice(0, 4000), periode);
    return { tersedia: true, teks };
  } catch (e) { if (e.unavailable) return { tersedia: false, alasan: e.message }; throw e; }
}
const RULES = 'Jawab dalam bahasa Indonesia yang sederhana untuk pemilik usaha kecil. Gunakan HANYA angka dalam data; jangan mengarang harga pasar, tren pasar, atau angka lain. Jangan menjanjikan hasil pasti. Jangan menulis markdown berat; paragraf pendek atau daftar bernomor.';

module.exports = function biRouter(db) {
  const r = express.Router();
  r.use((req, res, next) => {
    const b = db.prepare('SELECT id,nama FROM businesses WHERE owner_id=?').get(req.user.id);
    if (!b) return res.status(404).json({ error: 'Akun ini belum memiliki usaha.' });
    req.biz = b; next();
  });

  /* ---------- A. Profit & Pricing Advisor ---------- */
  r.post('/harga', async (req, res) => {
    const b = req.body || {}, f = {};
    const bahan = (Array.isArray(b.bahan) ? b.bahan : []).slice(0, 30).map((x) => ({ nama: str(x && x.nama, 60), harga: num(x && x.harga), jumlah: num(x && x.jumlah) }));
    if (!bahan.length) f.bahan = 'Isi minimal satu bahan baku.';
    else if (bahan.some((x) => !x.nama || !(x.harga >= 0 && x.harga <= 1e9) || !(x.jumlah > 0 && x.jumlah <= 1e6))) f.bahan = 'Setiap bahan perlu nama, harga satuan ≥ 0, dan jumlah > 0.';
    const biaya = {}; for (const k of ['tenaga_kerja', 'operasional', 'tambahan']) { const v = b[k] === '' || b[k] == null ? 0 : num(b[k]); if (!(v >= 0 && v <= 1e10)) f[k] = 'Isi angka rupiah ≥ 0.'; biaya[k] = v; }
    const n = num(b.jumlah_produk); if (!(Number.isInteger(n) && n >= 1 && n <= 1e6)) f.jumlah_produk = 'Jumlah produk yang dihasilkan harus bilangan bulat ≥ 1.';
    const rencana = b.harga_jual === '' || b.harga_jual == null ? null : num(b.harga_jual); if (rencana !== null && !(rencana >= 0 && rencana <= 1e9)) f.harga_jual = 'Harga jual harus angka ≥ 0, atau kosongkan.';
    if (Object.keys(f).length) return res.status(400).json({ error: 'Data belum valid.', fields: f });

    const totalBahan = bahan.reduce((s, x) => s + Math.round(x.harga * x.jumlah), 0);
    const total = totalBahan + Math.round(biaya.tenaga_kerja + biaya.operasional + biaya.tambahan);
    const hpp = total / n;
    // Harga = HPP / (1 - margin), dibulatkan ke atas ke Rp500 agar margin aktual tidak di bawah target.
    const naik = (v) => Math.ceil(v / 500) * 500;
    const sim = [20, 30, 40, 50].map((m) => { const harga = naik(hpp / (1 - m / 100)); return { target: m, harga, untung: harga - hpp, margin: hpp ? ((harga - hpp) / harga) * 100 : 100, untungTotal: (harga - hpp) * n }; });
    const hasil = { totalBahan, totalBiaya: total, hpp, jumlah: n, hargaMinimum: naik(hpp), simulasi: sim,
      rencana: rencana === null ? null : { harga: rencana, untung: rencana - hpp, margin: rencana > 0 ? ((rencana - hpp) / rencana) * 100 : null, untungTotal: (rencana - hpp) * n } };
    db.prepare('INSERT INTO cost_calculations (business_id,input_json,hasil_json) VALUES (?,?,?)').run(req.biz.id, JSON.stringify({ bahan, ...biaya, jumlah_produk: n, harga_jual: rencana }), JSON.stringify(hasil));
    const sys = `Anda penasihat harga untuk UMKM batik/bordir/kuliner desa. Jelaskan hasil hitungan: apa itu HPP, mengapa tiap pilihan margin menghasilkan harga tersebut, dan apa risikonya (harga terlalu rendah menekan untung, terlalu tinggi bisa mengurangi pembeli). Jika ada harga rencana, nilai apakah di atas atau di bawah HPP. Ingatkan bahwa harga terbaik juga bergantung pada pembeli dan pesaing yang tidak ada dalam data. ${RULES}`;
    res.json({ hasil, ai: await narrate(db, req, 'harga', '', sys, hasil) });
  });
  r.get('/harga/riwayat', (req, res) => res.json({ items: db.prepare('SELECT id,input_json,hasil_json,created_at FROM cost_calculations WHERE business_id=? ORDER BY id DESC LIMIT 20').all(req.biz.id).map((x) => ({ id: x.id, created_at: x.created_at, input: JSON.parse(x.input_json), hasil: JSON.parse(x.hasil_json) })) }));

  /* ---------- C. Business Analytics ---------- */
  r.post('/analitik', async (req, res) => {
    const N = { 7: 1, 30: 5, 90: 15 }[req.body && req.body.hari]; // hari → lebar batch grafik (hari)
    const hari = Number(req.body && req.body.hari);
    if (!N) return res.status(400).json({ error: 'Pilih periode 7, 30, atau 90 hari.' });
    const id = req.biz.id, D = "date(o.created_at,'+7 hours')";
    const win = (a, b) => `${D}>=date('now','+7 hours','-${a} days') AND ${D}<=date('now','+7 hours','-${b} days')`;
    // Pembatalan tidak dihitung. Hanya pesanan yang memuat produk (ber-nilai rupiah).
    const agg = (w) => db.prepare(`SELECT COALESCE(SUM(${NET}),0) pendapatan, COUNT(DISTINCT o.id) pesanan, COALESCE(SUM(i.qty),0) unit FROM order_items i JOIN orders o ON o.id=i.order_id WHERE o.business_id=? AND o.status<>'batal' AND ${w}`).get(id);
    const now = agg(win(hari - 1, 0)), prev = agg(win(hari * 2 - 1, hari));
    const daily = new Map(db.prepare(`SELECT ${D} d, SUM(${NET}) v FROM order_items i JOIN orders o ON o.id=i.order_id WHERE o.business_id=? AND o.status<>'batal' AND ${win(hari - 1, 0)} GROUP BY d`).all(id).map((x) => [x.d, x.v]));
    const seri = [];
    for (let s = hari - 1; s >= 0; s -= N) { let sum = 0, start = ''; for (let k = s; k > s - N && k >= 0; k--) { const d = db.prepare("SELECT date('now','+7 hours',?) d").get(`-${k} days`).d; if (k === s) start = d; sum += daily.get(d) || 0; } seri.push({ label: start.slice(8) + '/' + start.slice(5, 7), value: sum }); }
    const produk = db.prepare(`SELECT p.id,p.nama,p.stok,p.stok_min,COALESCE(SUM(CASE WHEN o.status<>'batal' AND ${win(hari - 1, 0)} THEN i.qty END),0) qty,
        COALESCE(SUM(CASE WHEN o.status<>'batal' AND ${win(hari - 1, 0)} THEN ${NET} END),0) omzet
      FROM products p LEFT JOIN order_items i ON i.product_id=p.id LEFT JOIN orders o ON o.id=i.order_id WHERE p.business_id=? AND p.persetujuan='approved' AND p.tersedia=1 GROUP BY p.id`).all(id);
    const terlaris = [...produk].filter((x) => x.qty > 0).sort((a, b) => b.qty - a.qty).slice(0, 5).map((x) => ({ nama: x.nama, qty: x.qty, omzet: x.omzet }));
    const kurang = [...produk].filter((x) => x.qty === 0 && x.stok > 0).slice(0, 5).map((x) => ({ nama: x.nama, stok: x.stok }));
    const stok = produk.filter((x) => x.qty > 0).map((x) => ({ nama: x.nama, stok: x.stok, hariHabis: Math.floor(x.stok / (x.qty / hari)) })).filter((x) => x.hariHabis < 14).sort((a, b) => a.hariHabis - b.hariHabis)
      .concat(produk.filter((x) => x.stok <= x.stok_min && x.qty === 0).map((x) => ({ nama: x.nama, stok: x.stok, hariHabis: null }))).slice(0, 8);
    const promo = db.prepare(`SELECT p.nama,p.tipe,p.nilai, COUNT(DISTINCT o.id) dipakai, COALESCE(SUM(u.potongan),0) potongan, COALESCE((SELECT SUM(${NET}) FROM order_items i WHERE i.order_id IN (SELECT o2.id FROM orders o2 JOIN promo_usage u2 ON u2.order_id=o2.id WHERE u2.promotion_id=p.id AND o2.status<>'batal' AND date(o2.created_at,'+7 hours')>=date('now','+7 hours','-${hari - 1} days'))),0) omzet
      FROM promotions p LEFT JOIN promo_usage u ON u.promotion_id=p.id LEFT JOIN orders o ON o.id=u.order_id AND o.status<>'batal' AND ${win(hari - 1, 0)} WHERE p.business_id=? GROUP BY p.id HAVING dipakai>0`).all(id);
    const rataPromo = db.prepare(`SELECT COUNT(*) n, AVG(t) rata FROM (SELECT o.id, SUM(${NET}) t FROM orders o JOIN order_items i ON i.order_id=o.id JOIN promo_usage u ON u.order_id=o.id WHERE o.business_id=? AND o.status<>'batal' AND ${win(hari - 1, 0)} GROUP BY o.id)`).get(id);
    const rataBiasa = db.prepare(`SELECT COUNT(*) n, AVG(t) rata FROM (SELECT o.id, SUM(${NET}) t FROM orders o JOIN order_items i ON i.order_id=o.id WHERE o.business_id=? AND o.status<>'batal' AND ${win(hari - 1, 0)} AND o.id NOT IN (SELECT order_id FROM promo_usage) GROUP BY o.id)`).get(id);
    // Prediksi hanya bila data cukup: rentang ≥ 28 hari sejak pesanan bernilai pertama DAN ≥ 10 pesanan dalam 60 hari terakhir.
    const rentang = db.prepare(`SELECT CAST(julianday(date('now','+7 hours'))-julianday(MIN(${D})) AS INTEGER) hari, COUNT(*) n FROM orders o WHERE o.business_id=? AND o.status<>'batal' AND EXISTS (SELECT 1 FROM order_items WHERE order_id=o.id)`).get(id);
    const n60 = db.prepare(`SELECT COUNT(DISTINCT o.id) n FROM orders o JOIN order_items i ON i.order_id=o.id WHERE o.business_id=? AND o.status<>'batal' AND ${win(59, 0)}`).get(id).n;
    const a28 = agg(win(27, 0)).pendapatan;
    const prediksi = rentang.hari >= 28 && n60 >= 10 ? { tersedia: true, tujuhHari: Math.round((a28 / 28) * 7), dasar: 'Rata-rata pendapatan harian 28 hari terakhir × 7. Perkiraan kasar, bukan jaminan.' }
      : { tersedia: false, alasan: `Prediksi belum dapat dibuat: butuh riwayat pesanan minimal 28 hari dan 10 pesanan dalam 60 hari terakhir (saat ini ${rentang.hari ?? 0} hari, ${n60} pesanan).` };
    const perubahan = prev.pendapatan > 0 ? ((now.pendapatan - prev.pendapatan) / prev.pendapatan) * 100 : null;
    const data = { periodeHari: hari, sekarang: now, sebelumnya: prev, perubahanPersen: perubahan, seri, terlaris, kurangDiminati: kurang, stok, promo,
      rataPesananPromo: rataPromo.n ? { n: rataPromo.n, rata: Math.round(rataPromo.rata) } : null, rataPesananTanpaPromo: rataBiasa.n ? { n: rataBiasa.n, rata: Math.round(rataBiasa.rata) } : null, prediksi };
    const cukup = now.pesanan >= 3; // tanpa data cukup, AI tidak dipanggil dan tidak menyimpulkan tren
    const sys = `Anda analis bisnis untuk satu UMKM desa. Dari data hasil hitungan, tulis: (1) ringkasan kondisi penjualan, (2) 3 rekomendasi konkret tentang stok, promo, atau strategi penjualan. Bila jumlah pesanan sedikit, katakan tren belum bisa disimpulkan. Efektivitas promo hanya boleh dinilai bila ada pesanan dengan dan tanpa promo; selain itu katakan datanya belum cukup. ${RULES}`;
    res.json({ data, cukup, ai: cukup ? await narrate(db, req, 'analitik', String(hari) + ' hari', sys, data) : { tersedia: false, alasan: 'Data belum cukup untuk analisis: kurang dari 3 pesanan bernilai pada periode ini.' } });
  });

  r.get('/riwayat', (req, res) => res.json({ items: db.prepare("SELECT id,fitur,periode,jawaban,created_at FROM ai_history WHERE user_id=? ORDER BY id DESC LIMIT 10").all(req.user.id) }));
  return r;
};
