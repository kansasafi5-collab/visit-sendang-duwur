'use strict';
// Menyisipkan 2 perubahan kecil ke berkas lama Anda (idempoten, dengan cadangan .bak-tahap8):
//   server/index.js    : +1 baris pemasangan dashboard baru
//   public/index.html  : +3 potongan agar kartu marketplace menampilkan tombol "Lihat produk & promo"
// Jalankan dari akar repo:  node terapkan-tahap8.js
const fs = require('fs');
const path = require('path');

const PLAN = {
  'server/index.js': [{
    nama: 'pemasangan dashboard', sudah: "require('./panel').mount(",
    cari: "app.use('/api', router);",
    ganti: "// Dashboard baru (UMKM + Admin Desa). Harus sebelum router lama karena router lama menutup /api dengan 404.\nrequire('./panel').mount(app, { db, auth, PUBLIC });\napp.use('/api', router);",
  }],
  'public/index.html': [
    { nama: 'penampung daftar toko', sudah: 'const TK=new Map();',
      cari: "let uc='Semua',uq='',ucon=false,usort='az';let ordU=null;", ganti: "let uc='Semua',uq='',ucon=false,usort='az';let ordU=null;const TK=new Map();" },
    { nama: 'tombol Lihat produk pada kartu', sudah: 'TK.get(u.id)',
      cari: 'ac.appendChild(bt);', ganti: "ac.appendChild(bt);{const tk=TK.get(u.id);if(tk){const a=el('a','xbtn a','Lihat produk'+(tk.promo?' & promo':''));a.href='/toko/'+u.id;ac.insertBefore(a,bt)}}" },
    { nama: 'pengambilan daftar toko', sudah: "api('/api/toko')",
      cari: '}catch(e){U=[];err=true}buildTiles();umr();', ganti: "}catch(e){U=[];err=true}try{const t=await api('/api/toko');t.items.forEach(x=>TK.set(x.id,x))}catch(e){}buildTiles();umr();" },
  ],
};

const out = [];
for (const [file, edits] of Object.entries(PLAN)) {
  const p = path.join(process.cwd(), file);
  if (!fs.existsSync(p)) { console.error(`Tidak ditemukan: ${file}. Jalankan dari akar repo.`); process.exit(1); }
  let s = fs.readFileSync(p, 'utf8'), changed = false;
  for (const e of edits) {
    if (s.includes(e.sudah)) { console.log(`  sudah terpasang: ${file} → ${e.nama}`); continue; }
    if (s.split(e.cari).length !== 2) { console.error(`GAGAL: titik sisip "${e.nama}" tidak ditemukan tepat satu kali di ${file}. Tidak ada berkas yang diubah.`); process.exit(1); }
    s = s.replace(e.cari, () => e.ganti); changed = true; console.log(`  akan dipasang: ${file} → ${e.nama}`);
  }
  if (changed) out.push([p, s]);
}
for (const [p, s] of out) { fs.copyFileSync(p, p + '.bak-tahap8'); fs.writeFileSync(p, s); console.log('Ditulis: ' + path.relative(process.cwd(), p) + ' (cadangan: .bak-tahap8)'); }
console.log(out.length ? 'Selesai.' : 'Tidak ada yang perlu diubah.');
