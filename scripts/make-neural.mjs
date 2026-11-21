// Generates Stockroom's "Pip brain" artwork: web/pip-orb.svg (Pip inside his network) and web/constellation.svg (page backdrop).
// Run: node scripts/make-neural.mjs
import {readFileSync, writeFileSync} from 'node:fs';
const rng = seed => () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
const f = n => n.toFixed(1);

// ---------- Pip in his network ----------
{
  const rand = rng(7), nodes = [];
  for (let i = 0; i < 46; i++) { const a = (i / 46) * Math.PI * 2 + rand() * .5, r = 56 + rand() * 52; nodes.push([120 + Math.cos(a) * r, 120 + Math.sin(a) * r]); }
  const links = [];
  nodes.forEach((a, i) => nodes.forEach((b, j) => { if (j > i && Math.hypot(a[0] - b[0], a[1] - b[1]) < 38) links.push([a, b]); }));
  const pip = readFileSync('web/pip.svg', 'utf8');
  const pipInner = pip.slice(pip.indexOf('<defs>'), pip.lastIndexOf('</svg>')).replace(/id="(\w+)"/g, 'id="p_$1"').replace(/url\(#(\w+)\)/g, 'url(#p_$1)');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240" width="240" height="240">
<style>
.ring{fill:none;stroke:rgba(155,140,255,.28);stroke-width:1;stroke-dasharray:2 6;transform-origin:120px 120px;animation:spin 60s linear infinite}
.ring2{animation-duration:40s;animation-direction:reverse}
.l line{stroke:rgba(155,140,255,.32);stroke-width:.7}
.n circle{fill:#cdc5ff;animation:pulse 3.2s ease-in-out infinite}
.n .a{animation-delay:.5s}.n .b{animation-delay:1s}.n .c{animation-delay:1.5s}.n .d{animation-delay:2s}.n .e{animation-delay:2.5s}
.pip{animation:float 6s ease-in-out infinite;transform-origin:120px 120px}
@keyframes spin{to{transform:rotate(360deg)}}@keyframes pulse{0%,100%{opacity:.35}50%{opacity:1}}@keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}
@media (prefers-reduced-motion:reduce){*{animation:none!important}}
</style>
<defs><radialGradient id="core" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#9b8cff" stop-opacity=".6"/><stop offset=".55" stop-color="#3987e5" stop-opacity=".14"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient></defs>
<circle cx="120" cy="120" r="118" fill="url(#core)"/>
<circle class="ring" cx="120" cy="120" r="102"/><circle class="ring ring2" cx="120" cy="120" r="80"/>
<g class="l">${links.map(([a, b]) => `<line x1="${f(a[0])}" y1="${f(a[1])}" x2="${f(b[0])}" y2="${f(b[1])}"/>`).join('')}</g>
<g class="n">${nodes.map(([x, y], i) => `<circle cx="${f(x)}" cy="${f(y)}" r="${i % 5 === 0 ? 2.7 : 1.6}" class="${'abcde'[i % 6] || ''}"/>`).join('')}</g>
<g class="pip"><svg x="76" y="78" width="88" height="83" viewBox="0 0 160 150">${pipInner}</svg></g>
</svg>`;
  writeFileSync('web/pip-orb.svg', svg);
}

// ---------- Constellation backdrop ----------
{
  const rand = rng(31), W = 1200, H = 420, nodes = [];
  for (let i = 0; i < 70; i++) {
    const x = rand() * W, y = rand() * H;
    const weight = Math.pow(x / W, 1.4) * (1 - y / H * .6); // denser towards the top right
    if (rand() < weight + .08) nodes.push([x, y, rand()]);
  }
  const links = [];
  nodes.forEach((a, i) => nodes.forEach((b, j) => { if (j > i && Math.hypot(a[0] - b[0], a[1] - b[1]) < 150) links.push([a, b]); }));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" preserveAspectRatio="xMaxYMin slice">
<style>.l line{stroke:#9b8cff;stroke-opacity:.24;stroke-width:.9}.n circle{fill:#cdc5ff;animation:p 4s ease-in-out infinite}.n .s{animation-delay:1.3s}.n .t{animation-delay:2.6s}@keyframes p{0%,100%{opacity:.25}50%{opacity:.9}}@media (prefers-reduced-motion:reduce){*{animation:none!important}}</style>
<defs><radialGradient id="g" cx="85%" cy="10%" r="60%"><stop offset="0" stop-color="#9b8cff" stop-opacity=".22"/><stop offset="1" stop-color="#9b8cff" stop-opacity="0"/></radialGradient></defs>
<rect width="${W}" height="${H}" fill="url(#g)"/>
<g class="l">${links.map(([a, b]) => `<line x1="${f(a[0])}" y1="${f(a[1])}" x2="${f(b[0])}" y2="${f(b[1])}"/>`).join('')}</g>
<g class="n">${nodes.map(([x, y, r], i) => `<circle cx="${f(x)}" cy="${f(y)}" r="${r > .8 ? 2.6 : 1.5}" class="${['', 's', 't'][i % 3]}"/>`).join('')}</g>
</svg>`;
  writeFileSync('web/constellation.svg', svg);
}
console.log('Wrote web/pip-orb.svg and web/constellation.svg');
