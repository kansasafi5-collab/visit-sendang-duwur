'use strict';
// AI Village Analytics (Admin Desa). Semua angka dihitung dari database dan bersifat AGREGAT:
// tidak ada nama pembeli, kontak, email, atau nama pemilik yang keluar dari modul ini, termasuk ke AI.
// Rekomendasi AI hanya masukan, bukan keputusan administratif.
const express = require('express');
const ai = require('./ai');

const NET = 'i.harga_satuan*i.qty-i.potongan';
const D = "date(o.created_at,'+7 hours')";
const win = (a, b) => `${D}>=date('now','+7 hours','-${a} days') AND ${D}<=date('now','+7 hours','-${b} days')`;
const BUCKET = { 30: 5, 90: 15, 180: 30 }; // hari → lebar batch grafik (selalu 6 batch)
const RULES = 'Jawab dalam bahasa Indonesia untuk perangkat desa. Gunakan HANYA angka dalam data JSON; jangan mengarang angka, nama, atau penyebab yang tidak ada di data. Sebutkan periode dan sumber data. Jika penjualanCukup=false, JANGAN menyimpulkan tren penjualan; katakan datanya belum cukup. Jika pembandingCukup=false, jangan menyatakan naik atau turun dibanding periode sebelumnya. Rekomendasi hanya masukan untuk dipertimbangkan, bukan keputusan. Jangan menebak data pribadi. Tulis ringkas, paragraf pendek atau daftar bernomor, tanpa markdown berat.';

function compute(db, hari) {
  const agg = (w) => db.prepare(`SELECT COALESCE(SUM(${NET}),0) omzet, COUNT(DISTINCT o.id) pesanan, COALESCE(SUM(i.qty),0) unit, COUNT(DISTINCT o.business_id) usaha FROM order_items i JOIN orders o ON o.id=i.order_id WHERE o.status<>'batal' AND ${w}`).get();
  const now = agg(win(hari - 1, 0)), prev = agg(win(hari * 2 - 1, hari));
  const tanggal = db.prepare("SELECT date('now','+7 hours',?) a, date('now','+7 hours') b").get(`-${hari - 1} days`);
  const N = BUCKET[hari], daily = new Map(db.prepare(`SELECT ${D} d, SUM(${NET}) v FROM order_items i JOIN orders o ON o.id=i.order_id WHERE o.status<>'batal' AND ${win(hari - 1, 0)} GROUP BY d`).all().map((x) => [x.d, x.v]));
  const omzetSeri = [];
  for (let s = hari - 1; s >= 0; s -= N) { let sum = 0, start = ''; for (let k = s; k > s - N && k >= 0; k--) { const d = db.prepare("SELECT date('now','+7 hours',?) d").get(`-${k} days`).d; if (k === s) start = d; sum += daily.get(d) || 0; } omzetSeri.push({ label: start.slice(8) + '/' + start.slice(5, 7), value: sum }); }

  const aktif = db.prepare("SELECT COUNT(*) n FROM businesses WHERE verifikasi='verified' AND aktif=1").get().n;
  const awal = db.prepare("SELECT COUNT(*) n FROM businesses WHERE verifikasi='verified' AND aktif=1 AND owner_id IS NULL").get().n;
  const mandiri = db.prepare("SELECT strftime('%Y-%m',created_at,'+7 hours') bln, COUNT(*) n FROM businesses WHERE owner_id IS NOT NULL AND created_at>=date('now','-5 months','start of month') GROUP BY bln ORDER BY bln").all();
  const menunggu = db.prepare("SELECT COUNT(*) n FROM businesses WHERE verifikasi='pending'").get().n;

  const kategori = db.prepare(`SELECT b.kategori, COUNT(DISTINCT b.id) usaha, COALESCE(SUM(CASE WHEN o.status<>'batal' AND ${win(hari - 1, 0)} THEN ${NET} END),0) omzet
    FROM businesses b LEFT JOIN orders o ON o.business_id=b.id LEFT JOIN order_items i ON i.order_id=o.id WHERE b.verifikasi='verified' AND b.aktif=1 GROUP BY b.kategori ORDER BY usaha DESC`).all();
  const produk = db.prepare(`SELECT i.nama, SUM(i.qty) qty, COUNT(DISTINCT o.business_id) usaha FROM order_items i JOIN orders o ON o.id=i.order_id WHERE o.status<>'batal' AND ${win(hari - 1, 0)} GROUP BY i.nama ORDER BY qty DESC LIMIT 5`).all();

  // Pertumbuhan per UMKM: hanya usaha yang punya pembanding (prev>0) dan ≥3 pesanan di kedua periode; hanya persen yang ditampilkan.
  const per = db.prepare(`SELECT b.nama, b.kategori,
      COALESCE(SUM(CASE WHEN ${win(hari - 1, 0)} THEN ${NET} END),0) now, COALESCE(SUM(CASE WHEN ${win(hari * 2 - 1, hari)} THEN ${NET} END),0) prev,
      COUNT(DISTINCT CASE WHEN ${win(hari - 1, 0)} THEN o.id END) pn, COUNT(DISTINCT CASE WHEN ${win(hari * 2 - 1, hari)} THEN o.id END) pp
    FROM businesses b JOIN orders o ON o.business_id=b.id JOIN order_items i ON i.order_id=o.id WHERE o.status<>'batal' AND b.verifikasi='verified' GROUP BY b.id`).all()
    .filter((x) => x.prev > 0 && x.pn + x.pp >= 3).map((x) => ({ nama: x.nama, kategori: x.kategori, persen: ((x.now - x.prev) / x.prev) * 100, pesananSekarang: x.pn, pesananSebelumnya: x.pp }));
  const naik = per.filter((x) => x.persen > 0).sort((a, b) => b.persen - a.persen).slice(0, 5);
  const turun = per.filter((x) => x.persen < 0).sort((a, b) => a.persen - b.persen).slice(0, 5);

  const pr = db.prepare(`SELECT COUNT(DISTINCT u.promotion_id) promo, COUNT(*) pemakaian, COALESCE(SUM(u.potongan),0) potongan FROM promo_usage u JOIN orders o ON o.id=u.order_id WHERE o.status<>'batal' AND ${win(hari - 1, 0)}`).get();
  const rata = (extra) => db.prepare(`SELECT COUNT(*) n, AVG(t) rata FROM (SELECT o.id, SUM(${NET}) t FROM orders o JOIN order_items i ON i.order_id=o.id WHERE o.status<>'batal' AND ${win(hari - 1, 0)} ${extra} GROUP BY o.id)`).get();
  const rp1 = rata('AND o.id IN (SELECT order_id FROM promo_usage)'), rp0 = rata('AND o.id NOT IN (SELECT order_id FROM promo_usage)');
  const promo = { ...pr, rataDenganPromo: rp1.n ? { n: rp1.n, rata: Math.round(rp1.rata) } : null, rataTanpaPromo: rp0.n ? { n: rp0.n, rata: Math.round(rp0.rata) } : null,
    bisaDibandingkan: rp1.n >= 3 && rp0.n >= 3 };

  // Persebaran: alamat hanya berupa teks, jadi dikelompokkan per RW bila alamat memuat "RT xx/RW yy".
  const rw = new Map(); let tanpa = 0;
  for (const b of db.prepare("SELECT alamat FROM businesses WHERE verifikasi='verified' AND aktif=1").all()) { const m = /RW\s*0*(\d+)/i.exec(b.alamat); if (m) rw.set('RW ' + m[1].padStart(2, '0'), (rw.get('RW ' + m[1].padStart(2, '0')) || 0) + 1); else tanpa++; }
  const lokasi = { perRw: [...rw].sort().map(([label, n]) => ({ label, n })), tanpaRw: tanpa, total: aktif };

  return {
    periode: { hari, dari: tanggal.a, sampai: tanggal.b }, sumber: 'Database Desa Sendang Duwur: tabel usaha, pesanan (hanya yang memuat produk, tanpa pesanan batal), dan promo. Data agregat.',
    penjualanCukup: now.pesanan >= 5, pembandingCukup: prev.pesanan >= 3,
    umkm: { aktif, awalImporAdmin: awal, pendaftarMandiriPerBulan: mandiri, menungguVerifikasi: menunggu },
    omzet: { sekarang: now, sebelumnya: prev, perubahanPersen: prev.omzet > 0 ? ((now.omzet - prev.omzet) / prev.omzet) * 100 : null, seri: omzetSeri },
    kategori, produkUnggulan: produk, umkmNaik: naik, umkmTurun: turun, promo, lokasi,
  };
}

module.exports = function villageRouter(db) {
  const r = express.Router();
  const hariOf = (b) => (BUCKET[Number(b && b.hari)] ? Number(b.hari) : null);
  const save = (req, fitur, q, a, periode) => db.prepare('INSERT INTO ai_history (user_id,fitur,pertanyaan,jawaban,periode) VALUES (?,?,?,?,?)').run(req.user.id, fitur, q.slice(0, 500), a.slice(0, 4000), periode);

  r.post('/analisis', async (req, res) => {
    const hari = hariOf(req.body); if (!hari) return res.status(400).json({ error: 'Pilih periode 30, 90, atau 180 hari.' });
    const data = compute(db, hari); let out;
    if (!ai.available()) out = { tersedia: false, alasan: 'Rekomendasi AI belum tersedia (ANTHROPIC_API_KEY belum diisi). Angka di atas tetap berasal dari database.' };
    else try {
      const teks = await ai.ask({ maxTokens: 800, system: `Anda analis ekonomi desa untuk pemerintah Desa Sendang Duwur. Tulis: (1) ringkasan kondisi ekonomi UMKM, (2) tiga rekomendasi program pemberdayaan yang bisa dipertimbangkan, masing-masing dikaitkan dengan angka di data. ${RULES}`, messages: [{ role: 'user', content: 'Data agregat (JSON):\n' + JSON.stringify(data) }] });
      save(req, 'village', 'analisis', teks, `${data.periode.dari} s/d ${data.periode.sampai}`); out = { tersedia: true, teks };
    } catch (e) { if (!e.unavailable) throw e; out = { tersedia: false, alasan: e.message }; }
    res.json({ data, ai: out });
  });

  r.post('/tanya', async (req, res) => {
    const hari = hariOf(req.body) || 30, q = String((req.body && req.body.pertanyaan) || '').replace(/\s+/g, ' ').trim().slice(0, 400);
    if (q.length < 3) return res.status(400).json({ error: 'Tulis pertanyaan Anda.' });
    const data = compute(db, hari);
    try {
      const jawaban = await ai.ask({ maxTokens: 600, system: `Anda analis ekonomi desa. Jawab pertanyaan admin desa hanya dari data agregat berikut. Jika pertanyaan tidak bisa dijawab dari data, katakan datanya belum tersedia. ${RULES}`, messages: [{ role: 'user', content: `Data agregat (JSON):\n${JSON.stringify(data)}\n\nPertanyaan admin: ${q}` }] });
      save(req, 'village', q, jawaban, `${data.periode.dari} s/d ${data.periode.sampai}`);
      res.json({ jawaban, periode: data.periode, sumber: data.sumber });
    } catch (e) { if (e.unavailable) return res.status(503).json({ error: e.message }); throw e; }
  });

  r.get('/riwayat', (_req, res) => res.json({ items: db.prepare("SELECT id,pertanyaan,jawaban,periode,created_at FROM ai_history WHERE fitur='village' ORDER BY id DESC LIMIT 10").all() }));
  return r;
};
module.exports.compute = compute;
