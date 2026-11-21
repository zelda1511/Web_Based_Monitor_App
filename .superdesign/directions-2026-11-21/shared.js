// Fixed mock data (same real numbers as the current Dashboard) and tiny helpers, so all five directions show identical content.
const rnd = (() => { let s = 7; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
const cpu = Array.from({ length: 60 }, (_, i) => Math.max(2, Math.min(60, 8 + Math.sin(i / 4) * 5 + rnd() * 10 + (i > 40 && i < 46 ? 28 : 0))));
const ram = Array.from({ length: 60 }, (_, i) => 49 + Math.sin(i / 11) * 1.5 + rnd() * 1.2);
function path(data, w, h, max = 100, close = false) {
  const st = w / (data.length - 1);
  const pts = data.map((v, i) => `${(i * st).toFixed(1)},${(h - (v / max) * h).toFixed(1)}`);
  const d = 'M' + pts.join(' L');
  return close ? `${d} L${w},${h} L0,${h} Z` : d;
}
function spark(el, data, w, h, color, fill) {
  el.setAttribute('viewBox', `0 0 ${w} ${h}`);
  el.innerHTML = (fill ? `<path d="${path(data, w, h, 100, true)}" style="fill:${fill}"/>` : '') + `<path d="${path(data, w, h)}" fill="none" style="stroke:${color}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>`;
}
const ICON = {
  home: '<path d="M3 11 12 4l9 7M5 10v10h14V10"/>',
  apps: '<path d="M12 3 4 7v10l8 4 8-4V7zM4 7l8 4 8-4M12 11v10"/>',
  pulse: '<path d="M3 12h4l2-6 4 12 2-6h6"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/>',
  cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
  mem: '<rect x="3" y="8" width="18" height="8" rx="1.5"/><path d="M7 16v3M12 16v3M17 16v3M7 11v2M12 11v2M17 11v2"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  batt: '<rect x="2" y="7" width="17" height="10" rx="2"/><path d="M22 11v2M6 10v4M10 10v4"/>',
  disk: '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  gpu: '<rect x="2" y="7" width="20" height="10" rx="2"/><circle cx="9" cy="12" r="2.5"/><path d="M15 10h4M15 14h4"/>',
  board: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9 9h6v6H9z"/>',
  os: '<path d="M3 4.5l8-1.2v8H3zM12 3.1l9-1.4v9.6h-9zM3 12.6h8v8l-8-1.2zM12 12.6h9v9.7l-9-1.4z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19"/>',
};
const ic = (n, s = 18, extra = '') => `<svg class="ic" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" ${extra}>${ICON[n]}</svg>`;
const DISKS = [{ n: 'C:', used: 112, size: 475, free: 363 }, { n: 'D:', used: 269, size: 931, free: 662 }, { n: 'E:', used: 144, size: 466, free: 322 }];
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('[data-ic]').forEach((e) => (e.innerHTML = ic(e.dataset.ic, +e.dataset.s || 18)));
  document.querySelectorAll('svg[data-spark]').forEach((e) => { const [w, h, c, f] = e.dataset.spark.split('|'); spark(e, e.dataset.src === 'ram' ? ram : cpu, +w, +h, c, f || null); });
});
