'use strict';
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite'); // bawaan Node (>= 22.5), tanpa kompilasi

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'sendangduwur.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
// Pembungkus transaksi sederhana: db.transaction(fn)(...args)
db.transaction = (fn) => (...args) => {
  db.exec('BEGIN');
  try { const r = fn(...args); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
};

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pass_hash TEXT,
  google_id TEXT UNIQUE,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','umkm','admin')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS password_resets (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_resets_user ON password_resets(user_id);
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  jenis TEXT NOT NULL,
  lokasi TEXT NOT NULL,
  keterangan TEXT NOT NULL,
  pelapor TEXT NOT NULL DEFAULT 'Tanpa nama',
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'baru' CHECK (status IN ('baru','proses','selesai')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  judul TEXT NOT NULL,
  kategori TEXT NOT NULL DEFAULT 'Umum',
  isi TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Draf' CHECK (status IN ('Draf','Terbit')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS businesses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nama TEXT NOT NULL,
  pemilik TEXT NOT NULL,
  kategori TEXT NOT NULL CHECK (kategori IN ('Batik','Bordir & sablon','Kuliner & toko')),
  alamat TEXT NOT NULL DEFAULT '',
  whatsapp TEXT NOT NULL DEFAULT '',
  aktif INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nama TEXT NOT NULL UNIQUE,
  kategori TEXT NOT NULL,
  buka TEXT NOT NULL DEFAULT '',
  parkir TEXT NOT NULL DEFAULT '',
  toilet TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS stamps (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, idx)
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER REFERENCES businesses(id) ON DELETE SET NULL,
  business_nama TEXT NOT NULL,
  pemesan TEXT NOT NULL,
  pesanan TEXT NOT NULL,
  jumlah INTEGER NOT NULL DEFAULT 1,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  kontak TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'baru' CHECK (status IN ('baru','proses','siap','selesai','batal')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

/* ---- Migrasi aman untuk database lama ----
   1) Tabel users lama hanya mengizinkan role 'user'/'admin'. SQLite tidak bisa mengubah CHECK,
      jadi tabel dibangun ulang (prosedur resmi SQLite) tanpa kehilangan data.
   2) businesses mendapat pemilik (owner_id) dan status verifikasi. Usaha lama otomatis 'verified'. */
(function migrate() {
  const usersSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get().sql;
  if (!/'umkm'/.test(usersSql)) {
    db.exec('PRAGMA foreign_keys = OFF');
    try {
      db.exec('BEGIN');
      db.exec(`CREATE TABLE users_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE COLLATE NOCASE,
        pass_hash TEXT,
        google_id TEXT UNIQUE,
        role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','umkm','admin')),
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`);
      db.exec('INSERT INTO users_new (id,name,email,pass_hash,google_id,role,created_at) SELECT id,name,email,pass_hash,google_id,role,created_at FROM users');
      db.exec('DROP TABLE users');
      db.exec('ALTER TABLE users_new RENAME TO users');
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    finally { db.exec('PRAGMA foreign_keys = ON'); }
  }
  const cols = db.prepare('PRAGMA table_info(businesses)').all().map((c) => c.name);
  if (!cols.includes('owner_id')) db.exec('ALTER TABLE businesses ADD COLUMN owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL');
  if (!cols.includes('verifikasi')) db.exec("ALTER TABLE businesses ADD COLUMN verifikasi TEXT NOT NULL DEFAULT 'verified' CHECK (verifikasi IN ('pending','verified','rejected'))");
  if (!cols.includes('catatan')) db.exec("ALTER TABLE businesses ADD COLUMN catatan TEXT NOT NULL DEFAULT ''");
  // users: asal (pengunjung/warga, hanya atribut) dan aktif (admin bisa menonaktifkan akun).
  const ucols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (!ucols.includes('asal')) db.exec("ALTER TABLE users ADD COLUMN asal TEXT NOT NULL DEFAULT 'pengunjung'");
  if (!ucols.includes('aktif')) db.exec('ALTER TABLE users ADD COLUMN aktif INTEGER NOT NULL DEFAULT 1');
  // orders: kontak pembeli + status 'siap' dan 'batal'. CHECK lama dibangun ulang tanpa kehilangan data.
  const ocols = db.prepare('PRAGMA table_info(orders)').all().map((c) => c.name);
  if (!ocols.includes('kontak')) db.exec("ALTER TABLE orders ADD COLUMN kontak TEXT NOT NULL DEFAULT ''");
  const ordersSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='orders'").get().sql;
  if (!/'siap'/.test(ordersSql)) {
    db.exec('PRAGMA foreign_keys = OFF');
    try {
      db.exec('BEGIN');
      db.exec(`CREATE TABLE orders_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        business_id INTEGER REFERENCES businesses(id) ON DELETE SET NULL,
        business_nama TEXT NOT NULL,
        pemesan TEXT NOT NULL,
        pesanan TEXT NOT NULL,
        jumlah INTEGER NOT NULL DEFAULT 1,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        kontak TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'baru' CHECK (status IN ('baru','proses','siap','selesai','batal')),
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`);
      db.exec('INSERT INTO orders_new (id,business_id,business_nama,pemesan,pesanan,jumlah,user_id,kontak,status,created_at) SELECT id,business_id,business_nama,pemesan,pesanan,jumlah,user_id,kontak,status,created_at FROM orders');
      db.exec('DROP TABLE orders');
      db.exec('ALTER TABLE orders_new RENAME TO orders');
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    finally { db.exec('PRAGMA foreign_keys = ON'); }
  }
  // Verifikasi admin sudah dihapus: usaha yang masih 'pending' atau 'rejected' langsung dianggap aktif.
  db.exec("UPDATE businesses SET verifikasi='verified', catatan='' WHERE verifikasi<>'verified'");
  db.exec('CREATE INDEX IF NOT EXISTS idx_orders_business ON orders(business_id, created_at)');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_business_owner ON businesses(owner_id) WHERE owner_id IS NOT NULL');
})();

module.exports = db;
