'use strict';
// Catat aksi penting (perubahan harga, persetujuan, status pesanan, dst.) ke audit_log.
module.exports = (db) => {
  const ins = db.prepare('INSERT INTO audit_log (user_id,role,aksi,objek,alasan) VALUES (?,?,?,?,?)');
  return (req, aksi, objek, alasan = '') => ins.run(req.user.id, req.user.role, aksi, objek, String(alasan).slice(0, 300));
};
