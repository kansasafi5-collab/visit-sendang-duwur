# Visit Sendang Duwur

Situs wisata Desa Sendang Duwur (Paciran, Lamongan) lengkap dengan backend, database, login, dan panel admin.

## Menjalankan

Cara cepat: klik dua kali `jalankan.bat` (Windows) atau jalankan `./jalankan.sh` (Mac/Linux). File `.env` sudah berisi password admin.

Cara manual:

```bash
npm install
cp .env.example .env     # isi ADMIN_EMAIL / ADMIN_PASSWORD
npm start                # http://localhost:3000
```

Pertama kali jalan, database `data/sendangduwur.db` dibuat otomatis (SQLite), diisi data awal
(28 usaha, 8 lokasi, 3 pengumuman) dan satu akun admin. Bila `ADMIN_PASSWORD` kosong, password acak dicetak di konsol.

## Halaman

| URL | Fungsi |
|---|---|
| `/` | Situs publik |
| `/login` | Masuk / daftar (`#daftar`) |
| `/admin` | Panel admin (hanya role admin) |
| `/umkm` | Dashboard pelaku UMKM (hanya role umkm) |
| `/login` | Masuk/daftar pengunjung & warga desa (`#daftar` untuk mendaftar) |
| `/login/umkm` | Masuk/daftar pelaku UMKM |
| `/login/admin` | Masuk admin desa (tanpa pendaftaran) |

## Yang sekarang benar-benar jalan

- **Akun**: daftar, masuk, keluar, "ingat saya 30 hari". Password di-hash scrypt, sesi cookie `httpOnly`, rate limit, proteksi CSRF (cek Origin).
- **Login Google**: aktif bila `GOOGLE_CLIENT_ID` dan `GOOGLE_CLIENT_SECRET` diisi (redirect URI: `{BASE_URL}/api/auth/google/callback`). Tanpa itu, tombol menampilkan pesan "belum diaktifkan".
- **Heritage Passport**: stempel tersimpan di akun (sinkron lintas perangkat); tanpa akun tetap di perangkat.
- **Marketplace UMKM**: daftar dari database, dikelola admin (tambah/ubah/sembunyikan/hapus). Pesanan dicatat di server lalu pembeli diarahkan ke WhatsApp penjual.
- **Laporan fasilitas**: dicatat di server dengan nomor tiket, pelapor bisa melihat statusnya; admin mengubah status (Baru, Diproses, Selesai).
- **Pengumuman**: ditulis/diterbitkan admin, tampil di bagian "Kabar terbaru".
- **Lokasi di peta**: jam buka, parkir, toilet diisi admin dan muncul di detail peta.
- **Asisten wisata**: jawaban lokal; bila `ANTHROPIC_API_KEY` diisi, memakai AI lewat `/api/chat` (kunci tetap di server).
- **Admin**: ringkasan, laporan, pesanan, pengumuman, usaha warga, lokasi, pengguna.

## Jenis akun (3 role)

| Role | Cara dapat akun | Akses |
|---|---|---|
| `user` (pengunjung / warga) | Daftar sendiri, atau Google | Situs publik + fitur personal |
| `umkm` | Daftar sendiri di tab "Pelaku UMKM" (isi data usaha) | `/umkm`: profil usaha, pesanan usahanya sendiri |
| `admin` | **Tidak bisa daftar sendiri.** Dibuat dari `ADMIN_EMAIL`/`ADMIN_PASSWORD` di `.env` | `/admin` |

- Role dibaca dari database di setiap request; pilihan tab di halaman login hanya dicocokkan dengan role di database (tab tidak memberi akses).
- Usaha dari akun UMKM berstatus `pending` dan **tidak tampil di marketplace** sampai admin menyetujui (menu Usaha warga). Bila ditolak, alasan dilihat pemilik; setelah data diperbaiki otomatis diajukan ulang.
- Database lama dimigrasi otomatis saat server dijalankan (tabel `users` dibangun ulang tanpa kehilangan data; usaha lama otomatis `verified`). Cadangkan `data/sendangduwur.db` sebelum menjalankan versi ini pertama kali.
- Login Google berlaku di ketiga halaman masuk (aturan lengkap di `GOOGLE_SETUP.md`). Admin tidak bisa dibuat lewat Google, dan email Google wajib terverifikasi.
- Pendaftar pengunjung memilih *Pengunjung* atau *Warga desa*; ini hanya atribut akun, bukan role.
- Admin bisa menonaktifkan akun (sesi langsung dicabut) dari menu Pengguna.
- Pesanan punya 5 status: Menunggu konfirmasi, Diproses, Siap dikirim, Selesai, Dibatalkan. Pembeli boleh mengisi WhatsApp agar penjual bisa menghubungi balik.

## Ilustrasi

`public/assets/ilus/*.svg` (batik-tulis, batik-kain, bordir, sablon, warung, toko, jamu, pasar) dipakai pada kartu UMKM dan dashboard UMKM, dengan label **Ilustrasi** supaya tidak dikira foto asli usaha. Ganti dengan foto asli usaha bila sudah ada izin/dokumentasi.

## Deploy

Perlu hosting Node.js dengan disk persisten (Railway, Render, VPS). Set `NODE_ENV=production`, `TRUST_PROXY=true`
bila di belakang proxy, `BASE_URL` ke alamat publik (HTTPS), dan arahkan `DATA_DIR` ke volume persisten.
Cadangkan file `sendangduwur.db` secara berkala.

## Struktur

```
server/   index.js (app), routes.js (API), auth.js, db.js (skema), seed.js
public/   index.html, login.html, admin.html, assets/img/*
```

## Catatan

- Konten editorial (sejarah, batik, perangkat desa, loker, sumber) masih tertulis di `public/index.html`.
- Reset password lewat email belum ada; admin bisa mengatur ulang akun lewat database.
- Foto asal media/Disparbud perlu izin atau diganti dokumentasi sendiri sebelum publikasi (catatan dari situs aslinya).
