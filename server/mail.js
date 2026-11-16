'use strict';
// Pengiriman email lewat SMTP (nodemailer). Aktif bila SMTP_HOST, SMTP_USER, SMTP_PASS diisi di .env.
const nodemailer = require('nodemailer');

const enabled = () => !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
let transport;
function getTransport() {
  if (!transport) {
    const port = Number(process.env.SMTP_PORT) || 587;
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST, port, secure: port === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
  return transport;
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function sendReset(to, name, link) {
  if (!enabled()) {
    // Tanpa SMTP, tautan hanya dicetak di konsol server (tidak pernah dikirim ke browser).
    console.log(`\n[RESET KATA SANDI] SMTP belum diatur, email TIDAK terkirim. Tautan untuk ${to}:\n${link}\n`);
    return false;
  }
  const from = process.env.SMTP_FROM || `Visit Sendang Duwur <${process.env.SMTP_USER}>`;
  await getTransport().sendMail({
    from, to, subject: 'Atur ulang kata sandi – Visit Sendang Duwur',
    text: `Halo ${name},\n\nKami menerima permintaan untuk mengatur ulang kata sandi akun Anda. Buka tautan berikut (berlaku 1 jam):\n\n${link}\n\nJika Anda tidak memintanya, abaikan email ini; kata sandi Anda tidak berubah.\n\nVisit Sendang Duwur`,
    html: `<div style="font:16px/1.5 system-ui,sans-serif;color:#1b231f;max-width:480px"><p>Halo ${esc(name)},</p><p>Kami menerima permintaan untuk mengatur ulang kata sandi akun Anda. Klik tombol berikut (berlaku 1 jam):</p><p><a href="${esc(link)}" style="display:inline-block;background:#9c2a1e;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:700">Atur ulang kata sandi</a></p><p style="font-size:14px;color:#555">Atau salin tautan ini:<br>${esc(link)}</p><p style="font-size:14px;color:#555">Jika Anda tidak memintanya, abaikan email ini; kata sandi Anda tidak berubah.</p></div>`,
  });
  return true;
}

module.exports = { enabled, sendReset };
