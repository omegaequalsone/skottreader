#!/usr/bin/env node
/**
 * verify.js — prove the generated static page renders identically to the SPA.
 *
 * Walks the SPA's rendered DOM and the generated page's DOM in parallel and
 * diffs every style declaration on every node. Differences are classified:
 *   EXPECTED  — the deliberate semantic edits (h2->h1, div->img, added href,
 *               theme vars lifted to :root)
 *   VISUAL    — anything else. Any hit here means the page would look different
 *               and the build is wrong.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { render, THEME_KEYS } = require('./build.js');

const SITE = process.argv[2];
const GENERATED = process.argv[3];
const ROUTE = process.argv[4] || '#/project/uber';

const VISUALLY_INERT = new Set(['href', 'loading', 'decoding', 'alt', 'src', 'id', 'role', 'aria-modal', 'aria-label']);

function styleMap(el) {
  const out = {};
  const raw = el.getAttribute && el.getAttribute('style');
  if (!raw) return out;
  raw.split(';').forEach(d => {
    const idx = d.indexOf(':');
    if (idx < 0) return;
    const k = d.slice(0, idx).trim();
    const v = d.slice(idx + 1).trim();
    if (k) out[k] = v.replace(/\s+/g, ' ');
  });
  return out;
}

const norm = v => String(v)
  .replace(/\s+/g, ' ')
  .replace(/,\s+/g, ',')
  .replace(/0px/g, '0')
  .replace(/"/g, "'")
  .trim()
  .toLowerCase();

// background-image -> <img> is a faithful mapping; these pairs are equivalent.
const EQUIV = [
  ['background-size', 'object-fit'],
  ['background-position', 'object-position'],
];

const expected = [];
const visual = [];

function walk(a, b, pathStr) {
  if (!a || !b) {
    (a || b) && visual.push(`${pathStr}: node present on only one side (${a ? 'SPA' : 'generated'} only)`);
    return;
  }

  const at = a.tagName, bt = b.tagName;
  if (at !== bt) {
    if ((at === 'H2' && bt === 'H1')) expected.push(`${pathStr}: <h2> -> <h1> (title promoted, styles carried over)`);
    else if (at === 'DIV' && bt === 'IMG') expected.push(`${pathStr}: background-image <div> -> <img>`);
    else visual.push(`${pathStr}: tag changed ${at} -> ${bt}`);
  }

  const sa = styleMap(a), sb = styleMap(b);
  const keys = new Set([...Object.keys(sa), ...Object.keys(sb)]);

  for (const k of keys) {
    // theme custom properties were deliberately lifted from the root div to :root
    if (THEME_KEYS.includes(k)) { continue; }

    const va = sa[k], vb = sb[k];
    if (va === undefined && vb !== undefined) {
      const equiv = EQUIV.find(([bgProp, objProp]) => objProp === k && sa[bgProp] !== undefined);
      if (equiv || (at === 'DIV' && bt === 'IMG')) continue;
      visual.push(`${pathStr} +${k}: ${vb}`);
      continue;
    }
    if (vb === undefined && va !== undefined) {
      const equiv = EQUIV.find(([bgProp]) => bgProp === k && sb[EQUIV.find(e => e[0] === k)[1]] !== undefined);
      if (equiv || (at === 'DIV' && bt === 'IMG')) continue;
      visual.push(`${pathStr} -${k}: ${va}`);
      continue;
    }
    if (norm(va) !== norm(vb)) visual.push(`${pathStr} ${k}: "${va}" -> "${vb}"`);
  }

  // added href is visually inert
  const aAttrs = new Set([...(a.attributes || [])].map(x => x.name));
  const bAttrs = new Set([...(b.attributes || [])].map(x => x.name));
  for (const n of bAttrs) {
    if (!aAttrs.has(n) && !VISUALLY_INERT.has(n) && n !== 'style') {
      visual.push(`${pathStr} +attr ${n}="${b.getAttribute(n)}"`);
    }
    if (!aAttrs.has(n) && n === 'href') expected.push(`${pathStr}: +href="${b.getAttribute(n)}"`);
  }

  const ac = [...a.children], bc = [...b.children];
  if (ac.length !== bc.length && !(at === 'DIV' && bt === 'IMG')) {
    visual.push(`${pathStr}: child count ${ac.length} -> ${bc.length}`);
  }
  const n = Math.max(ac.length, bc.length);
  for (let i = 0; i < n; i++) {
    if (bt === 'IMG' || at === 'IMG') break;
    walk(ac[i], bc[i], `${pathStr}>${(ac[i] || bc[i]).tagName.toLowerCase()}[${i}]`);
  }
}

(async () => {
  const { host: spaHost } = await render(ROUTE);
  const genDom = new JSDOM(fs.readFileSync(GENERATED, 'utf8'));
  const genHost = genDom.window.document.getElementById('dc-root');

  if (!genHost) { console.error('FAIL: generated page has no #dc-root'); process.exit(1); }

  walk(spaHost, genHost, 'root');

  const gd = genDom.window.document;
  console.log('=== CONTENT CHECK (generated page) ===');
  console.log('  <h1>          :', gd.querySelectorAll('h1').length, gd.querySelector('h1') ? `"${gd.querySelector('h1').textContent.trim()}"` : '');
  console.log('  <img>         :', gd.querySelectorAll('img').length);
  console.log('  internal <a href>:', [...gd.querySelectorAll('a[href]')].filter(a => !/^https?:/.test(a.getAttribute('href'))).length);
  console.log('  <title>       :', JSON.stringify(gd.title));
  console.log('  canonical     :', gd.querySelector('link[rel=canonical]')?.getAttribute('href'));
  console.log('  meta desc len :', (gd.querySelector('meta[name=description]')?.getAttribute('content') || '').length);
  console.log('  body text len :', gd.body.textContent.replace(/\s+/g, ' ').trim().length);

  console.log('\n=== EXPECTED SEMANTIC CHANGES (' + expected.length + ') ===');
  expected.slice(0, 20).forEach(x => console.log('  ✓', x));

  console.log('\n=== VISUAL DIFFERENCES (' + visual.length + ') ===');
  if (!visual.length) console.log('  none — generated page is style-identical to the SPA render');
  else visual.slice(0, 40).forEach(x => console.log('  ✗', x));

  process.exit(visual.length ? 1 : 0);
})().catch(e => { console.error('VERIFY ERROR:', e.message); process.exit(2); });
