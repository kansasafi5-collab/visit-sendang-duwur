/* Banner pengumuman desa di website publik. Mengambil /api/pengumuman; bila kosong atau gagal, tidak menampilkan apa pun. */
(function () {
  var KEY = 'sd_pengumuman_ditutup';
  fetch('/api/pengumuman').then(function (r) { return r.ok ? r.json() : { items: [] }; }).then(function (d) {
    var a = (d.items || [])[0]; if (!a) return;
    var seen = ''; try { seen = localStorage.getItem(KEY) || ''; } catch (e) {}
    if (seen === String(a.id)) return;
    var bar = document.createElement('div');
    bar.setAttribute('role', 'status');
    bar.style.cssText = 'position:relative;z-index:9999;display:flex;gap:12px;align-items:center;justify-content:center;padding:10px 44px 10px 16px;font:500 14px/1.4 "DM Sans",system-ui,sans-serif;color:#fff;text-align:center;background:linear-gradient(90deg,#0e2440,#18385f)';
    if (a.jenis === 'penting') bar.style.background = 'linear-gradient(90deg,#8e2f22,#a63a2b)';
    var icon = { info: 'ℹ️', penting: '📣', acara: '🎉' }[a.jenis] || 'ℹ️';
    var t = document.createElement('span'); t.textContent = icon + ' ' + a.judul + (a.isi ? ' — ' + a.isi : '');
    var x = document.createElement('button'); x.type = 'button'; x.setAttribute('aria-label', 'Tutup pengumuman'); x.textContent = '×';
    x.style.cssText = 'position:absolute;right:10px;top:50%;transform:translateY(-50%);width:30px;height:30px;border:0;border-radius:50%;background:rgba(255,255,255,.18);color:#fff;font-size:18px;cursor:pointer';
    x.onclick = function () { bar.remove(); try { localStorage.setItem(KEY, String(a.id)); } catch (e) {} };
    bar.append(t, x); document.body.insertBefore(bar, document.body.firstChild);
  }).catch(function () {});
})();
