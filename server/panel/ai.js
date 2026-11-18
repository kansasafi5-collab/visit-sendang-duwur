'use strict';
// Pemanggil AI bersama. Kunci hanya dibaca dari environment di server. Tanpa kunci → unavailable (tidak pernah jawaban simulasi).
const unavailable = (msg) => Object.assign(new Error(msg), { unavailable: true });
module.exports = {
  available: () => !!process.env.ANTHROPIC_API_KEY,
  async ask({ system, messages, maxTokens = 700 }) {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw unavailable('Layanan AI belum dikonfigurasi di server.');
    let r;
    try {
      r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', signal: AbortSignal.timeout(25000),
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || 'claude-haiku-5-5', max_tokens: maxTokens, system, messages }),
      });
    } catch { throw unavailable('Layanan AI sedang tidak dapat dihubungi.'); }
    if (!r.ok) { console.error('AI error status', r.status); throw unavailable('Layanan AI sedang tidak dapat digunakan.'); }
    const j = await r.json().catch(() => ({}));
    const text = (j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    if (!text) throw unavailable('AI tidak memberi jawaban.');
    return text;
  },
};
