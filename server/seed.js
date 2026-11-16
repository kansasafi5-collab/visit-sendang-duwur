'use strict';
// Data awal yang diambil dari situs prototipe (direktori SIMDes & data lokasi).
// Hanya dijalankan bila tabel masih kosong.
const crypto = require('crypto');
const db = require('./db');
const { hashPassword } = require('./auth');

const BATIK = [
  ['Batik Jayyida', 'Siti Enifah'], ['Batik Mutiara Sendang', 'Sholihatun', 'Jl. Sunan Muria No. 7, RT 01/RW 01', '0857-3029-9739'],
  ['Batik Tulis Duvan', 'Mohammad Khoiri', 'Jl. Raden Fatah, RT 02/RW 01', '0856-4817-9695'], ['Batik Tulis Mekarsari', 'Irma Nur Faizah'],
  ['Batik Tulis Tunggal Fitri', 'Lailatul Fitriyah'], ['Batik Tulis Chotifa', 'Chotimah', 'Jl. Raden Fatah, RT 03/RW 02', '0856-4583-9311'],
  ['Batik Tulis Sopan', 'Anik Pujiati'], ['Batik Tulis Afredo', 'Afredo'], ['Batik Tulis Fatiha', 'Siti Zumaroh'],
  ['Batik Tulis Mugi Barokah', 'Mulifah'], ['Batik Tulis Mitra Sejati', 'Saminten'], ['Batik Tulis Dinamel', 'Siti Nur Azizah'],
  ['Batik Tulis Afiq Jaya', 'Latifah Lutfiana'], ['Batik Tulis Warna Indah', 'Harsono'], ['Batik Tulis Faradus Collection', 'Hj. Ruhayatin'],
  ['Batik Tulis Sayyidan', 'Siti Khotimah'], ['Batik Tulis Az Zifa', 'Supriyatin'], ['Batik Tulis Istiqomah', 'Siti Inayah'],
  ['Batik Tulis Nafisah', 'Ahmad Munir'],
];
const BORDIR = [['Muizz Collection Bordir', 'Abdul Muiz'], ['Aliya Collection', 'Elfira Agustina'], ['Az Zahra Collection', 'Puji Rahayu'], ['Semongko Sablon Bedjo', 'Muhammad Faiqul Ihtirom']];
const KULINER = [
  ['Latar Cendhani Sendangduwur', 'Barrur Rohim, S.Pd.', 'Pusat kuliner & pasar tradisional', '0859-6728-7080'],
  ['Warung Cakto', 'Suryanto'], ['Warung Mboktun', 'Nisfatun Aya'], ['Toko Bismillah', 'Abdul Hafidz Khoiri'], ['Obat Jamu Sawan', 'Nur Rohmawati'],
];
const LOCS = [
  ['Gapura Bersayap Sunan Sendang', 'Gapura', ''], ['Masjid Sendang Duwur', 'Masjid', ''], ['Makam Sunan Sendang Duwur', 'Makam', ''],
  ['Sumur Giling', 'Sejarah', ''], ['Bukit Amitunon', 'Sejarah', ''], ['Pasar Latar Cendhani', 'UMKM', 'Setiap Minggu Legi'],
  ['Sentra Batik Tulis Sendang Duwur', 'Sentra batik', ''], ['Kantor Desa Sendang Duwur', 'Fasilitas', ''],
];
const ANN = [
  ['Pasar Latar Cendhani buka lagi', 'Kalender', 'Kuliner, jajanan, dan kerajinan lokal. Datang pagi agar kebagian jumbrek.', 'Terbit'],
  ['Ruwahan dan Haul Sunan Sendang', 'Kalender', 'Pawai budaya, sedekah kuliner, dan bazar UMKM. Tanggal tahun ini menunggu konfirmasi panitia.', 'Draf'],
  ['Mangan Sego Langgi', 'Kalender', 'Makan bersama Sego Langgi pada malam 15 Sya’ban.', 'Terbit'],
];

function run() {
  const tx = db.transaction(() => {
    if (!db.prepare('SELECT 1 FROM businesses LIMIT 1').get()) {
      const ins = db.prepare('INSERT INTO businesses (nama,pemilik,kategori,alamat,whatsapp) VALUES (?,?,?,?,?)');
      for (const [k, list] of [['Batik', BATIK], ['Bordir & sablon', BORDIR], ['Kuliner & toko', KULINER]])
        for (const r of list) ins.run(r[0], r[1], k, r[2] || '', r[3] || '');
    }
    if (!db.prepare('SELECT 1 FROM locations LIMIT 1').get()) {
      const ins = db.prepare('INSERT INTO locations (nama,kategori,buka) VALUES (?,?,?)');
      for (const l of LOCS) ins.run(...l);
    }
    if (!db.prepare('SELECT 1 FROM announcements LIMIT 1').get()) {
      const ins = db.prepare('INSERT INTO announcements (judul,kategori,isi,status) VALUES (?,?,?,?)');
      for (const a of ANN) ins.run(...a);
    }
  });
  tx();
}

async function ensureAdmin() {
  if (db.prepare("SELECT 1 FROM users WHERE role='admin' LIMIT 1").get()) return;
  const email = (process.env.ADMIN_EMAIL || 'admin@sendangduwur.local').toLowerCase();
  const name = process.env.ADMIN_NAME || 'Admin Desa';
  let pw = process.env.ADMIN_PASSWORD;
  let generated = false;
  if (!pw) { pw = crypto.randomBytes(9).toString('base64url'); generated = true; }
  const hash = await hashPassword(pw);
  const ex = db.prepare('SELECT id FROM users WHERE email=?').get(email);
  if (ex) db.prepare("UPDATE users SET role='admin' WHERE id=?").run(ex.id);
  else db.prepare("INSERT INTO users (name,email,pass_hash,role) VALUES (?,?,?,'admin')").run(name, email, hash);
  console.log('\n========================================================');
  console.log(' Akun admin dibuat');
  console.log('   Email    : ' + email);
  console.log('   Password : ' + (generated ? pw + '   (dibuat acak; simpan, tidak ditampilkan lagi)' : '(dari ADMIN_PASSWORD)'));
  console.log('========================================================\n');
}

module.exports = { run, ensureAdmin };
