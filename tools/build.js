#!/usr/bin/env node
/**
 * build.js — generate real, crawlable static pages for skottreader.com
 *
 * WHY
 * The site is a client-rendered React SPA (dc-runtime). All content lives in
 * index.html behind hash routes (#/project/uber), so the HTML Google receives
 * is an empty shell. The old work.html / uber.html / etc. were 1.5KB redirect
 * stubs declaring <link rel="canonical" href="index.html#/project/uber">.
 * Google strips the #fragment, so all 19 declared themselves duplicates of the
 * homepage — hence 2 indexed out of 21.
 *
 * HOW (pixel-perfect by construction)
 * This boots the real app in jsdom at each hash route, lets React render, and
 * captures the resulting DOM — including the hover/utility stylesheets the
 * runtime injects at boot. The output IS the app's own render, so it cannot
 * drift visually from what visitors see.
 *
 * It then applies ONLY semantic surgery, never visual change:
 *   1. the client-name <h2> becomes <h1>   (inline styles carried over verbatim)
 *   2. nav / prev / next <a> get real href (an href renders no pixels)
 *   3. gallery background-image divs become <img> with the faithful CSS
 *      equivalent: background-size -> object-fit, background-position ->
 *      object-position, so layout is byte-for-byte the same
 *   4. theme custom properties move from an inline style on the root div into
 *      :root / html[data-theme=dark], driven by the same hour-based rule the
 *      SPA itself uses — so the static page themes exactly as the SPA does
 *
 * RE-RUN after editing PROJECTS in index.html:   node build.js
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const SITE = process.argv[2] || process.cwd();
const OUT = process.argv[3] || SITE;
const ORIGIN = 'https://skottreader.com';
const NM = process.env.NM || '/tmp/pre/node_modules';

const REACT = fs.readFileSync(`${NM}/react/umd/react.production.min.js`, 'utf8');
const REACT_DOM = fs.readFileSync(`${NM}/react-dom/umd/react-dom.production.min.js`, 'utf8');
const BABEL = fs.readFileSync(`${NM}/@babel/standalone/babel.min.js`, 'utf8');
const indexHtml = fs.readFileSync(path.join(SITE, 'index.html'), 'utf8');
const supportJs = fs.readFileSync(path.join(SITE, 'support.js'), 'utf8');

/* ------------------------------------------------------------------ *
 * 1. Render a hash route in jsdom and hand back the committed DOM
 * ------------------------------------------------------------------ */
function render(route) {
  return new Promise((resolve, reject) => {
    const vc = new VirtualConsole();
    vc.on('jsdomError', e => { if (!/Not implemented/.test(e.message)) console.error('  [jsdom]', e.message); });

    const dom = new JSDOM(indexHtml, {
      url: `${ORIGIN}/index.html${route}`,
      runScripts: 'dangerously',
      pretendToBeVisual: true,
      virtualConsole: vc,
    });
    const { window } = dom;

    window.matchMedia = window.matchMedia || (q => ({
      matches: false, media: q, onchange: null,
      addListener() {}, removeListener() {},
      addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; },
    }));
    window.scrollTo = () => {};
    // boot() re-fetches its own template; serve it from memory, no network.
    window.fetch = () => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(indexHtml) });
    if (!window.IntersectionObserver) window.IntersectionObserver = class { observe(){} unobserve(){} disconnect(){} takeRecords(){return[]} };
    if (!window.ResizeObserver) window.ResizeObserver = class { observe(){} unobserve(){} disconnect(){} };

    const inject = code => {
      const s = window.document.createElement('script');
      s.textContent = code;
      window.document.head.appendChild(s);
    };
    // dc-runtime expects these globals or it injects <script src="unpkg...">.
    inject(REACT); inject(REACT_DOM); inject(BABEL); inject(supportJs);

    setTimeout(() => {
      const doc = window.document;
      const host = doc.getElementById('dc-root');
      if (!host || (host.textContent || '').trim().length < 150) {
        return reject(new Error(`render produced no content for ${route}`));
      }
      // Stylesheets the runtime injected at boot (hover classes, utilities).
      const runtimeCss = [...doc.head.querySelectorAll('style')].map(s => s.textContent).join('\n');
      resolve({ doc, host, runtimeCss, title: doc.title, window });
    }, 4000);
  });
}

/* ------------------------------------------------------------------ *
 * 2. Semantic surgery — no visual properties are touched
 * ------------------------------------------------------------------ */
const TPL_HREF = {
  8:   '/',            // SKOTT READER logo
  12:  'work.html',
  13:  'about.html',
  14:  'contact.html',
  187: 'work.html',    // "← All work"
  320: 'work.html',    // "All work →" (case study)
  444: 'contact.html', // "Get in touch →"
};

/* Work-grid tiles (tpl=171) are click-handler <div>s, so the grid contains zero
 * crawlable links to any project — a large part of why Google never indexed
 * them. Convert each tile to a real <a>. In a CSS grid an <a> is blockified
 * exactly as the <div> was, and we restore color/decoration so the UA's default
 * link styling can't introduce a visual change. */
const TILE_TPL = '171';

function linkTiles(host, doc, tileMap) {
  if (!tileMap) return 0;
  let n = 0;
  host.querySelectorAll(`div[data-dc-tpl="${TILE_TPL}"]`).forEach((tile, i) => {
    const bg = [...tile.querySelectorAll('[style*="background-image"]')]
      .map(e => ((e.getAttribute('style') || '').match(/url\(["']?([^"')]+)["']?\)/) || [])[1])
      .find(Boolean);
    const href = (bg && tileMap.byThumb[bg]) || tileMap.order[i];
    if (!href) return;

    const a = doc.createElement('a');
    for (const at of [...tile.attributes]) a.setAttribute(at.name, at.value);
    a.setAttribute('href', href);
    a.setAttribute('style', (tile.getAttribute('style') || '') + 'text-decoration:none;color:inherit;');
    a.innerHTML = tile.innerHTML;
    tile.replaceWith(a);
    n++;
  });
  return n;
}

/* The nav lockup (wordmark + purple subtitle pill) is sized by runtime
 * measurement in the SPA — logoFontPx / subFontPx / logoTrackPx / lockupW are
 * all computed from getBoundingClientRect after mount. jsdom reports zero for
 * every measurement, so a prerender bakes in the *unmeasured* fallback and the
 * pill ends up wider than the wordmark. Mark the three nodes so the static
 * pages can run the same fit in the browser, where measuring actually works. */
function markLockup(host) {
  const logo = host.querySelector('a[data-dc-tpl="8"]');
  if (!logo) return false;
  const lockup = logo.parentElement;
  const sub = logo.nextElementSibling;
  if (!lockup || !sub) return false;
  lockup.setAttribute('data-sr-lockup', '');
  logo.setAttribute('data-sr-logo', '');
  sub.setAttribute('data-sr-sub', '');
  return true;
}

function transform(host, doc, { prevHref, nextHref, h1Text, tileMap } = {}) {
  const report = { hrefs: 0, imgs: 0, h1: false, tiles: 0, lockup: false };
  report.tiles = linkTiles(host, doc, tileMap);
  report.lockup = markLockup(host);

  // -- 2a. real hrefs on the app's click-handler anchors -----------------
  host.querySelectorAll('a[data-dc-tpl]').forEach(a => {
    const tpl = Number(a.getAttribute('data-dc-tpl'));
    let href = TPL_HREF[tpl];
    if (tpl === 216 && prevHref) href = prevHref;   // ← Prev
    if (tpl === 219 && nextHref) href = nextHref;   // Next →
    if (href && !a.getAttribute('href')) { a.setAttribute('href', href); report.hrefs++; }
  });

  // -- 2b. promote the page title to <h1>, carrying styles verbatim ------
  const h2 = host.querySelector('h2');
  if (h2 && (!h1Text || h2.textContent.trim() === h1Text)) {
    const h1 = doc.createElement('h1');
    for (const at of [...h2.attributes]) h1.setAttribute(at.name, at.value);
    h1.innerHTML = h2.innerHTML;
    h2.replaceWith(h1);
    report.h1 = true;
  }

  // -- 2c. background-image slots -> real <img>, faithful CSS mapping ----
  host.querySelectorAll('div[style*="background-image"]').forEach(div => {
    const st = div.style;
    const raw = st.backgroundImage || '';
    const m = raw.match(/url\(["']?([^"')]+)["']?\)/);
    if (!m) return;                       // e.g. the footer's var(--grad) rule
    if (raw.includes('var(')) return;
    const url = m[1];

    const img = doc.createElement('img');
    img.setAttribute('src', url);
    img.setAttribute('loading', 'lazy');
    img.setAttribute('decoding', 'async');
    img.setAttribute('alt', altFor(url));

    // background-size -> object-fit  |  background-position -> object-position
    const size = (st.backgroundSize || 'contain').trim();
    const pos = (st.backgroundPosition || 'center').trim();
    const fit = /^(contain|cover)$/.test(size) ? size : 'contain';
    const extra = /^(contain|cover)$/.test(size) ? '' : `width:${size};height:${size};margin:auto;`;

    img.setAttribute('style',
      `position:absolute;inset:0;width:100%;height:100%;display:block;` +
      `object-fit:${fit};object-position:${pos};${extra}` +
      (st.backgroundColor ? `background-color:${st.backgroundColor};` : '') +
      `cursor:${st.cursor || 'pointer'};`);

    div.replaceWith(img);
    report.imgs++;
  });

  return report;
}

function altFor(url) {
  const parts = url.split('/');
  const file = (parts.pop() || '').replace(/\.[a-z0-9]+$/i, '');
  const folder = parts.pop() || '';
  const name = folder.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  return `${name} — project image ${file}`.trim();
}

/* ------------------------------------------------------------------ *
 * 3. Lift the theme vars off the root div into :root, and re-apply the
 *    SPA's own hour-based light/dark rule so the static page matches.
 * ------------------------------------------------------------------ */
const THEMES = {
  light: {'--bg':'#f4f3fb','--bg2':'#eae8f6','--surface':'#ffffff','--surface2':'#f7f6fd','--line':'rgba(24,18,48,0.12)','--line2':'rgba(24,18,48,0.20)','--fg':'#161229','--fg-dim':'#4c4869','--fg-mute':'#827da0','--accent':'#7209b7','--accent-fg':'#ffffff','--social-hover':'#7209b7','--slot':'#e9e7f5','--slot2':'#f1eff9','--logo-filter':'brightness(0) opacity(0.78)','--feature-grad':'linear-gradient(150deg,#0d1524 0%,#122038 55%,#0f2b47 100%)','--feature-border':'rgba(255,255,255,0.06)'},
  dark:  {'--bg':'#0c0a16','--bg2':'#08060f','--surface':'#151228','--surface2':'#1c1836','--line':'rgba(232,231,255,0.10)','--line2':'rgba(232,231,255,0.18)','--fg':'#eeecf8','--fg-dim':'#a6a2c2','--fg-mute':'#6d6990','--accent':'#4cc9f0','--accent-fg':'#0c0a16','--social-hover':'#f72585','--slot':'#151228','--slot2':'#1c1836','--logo-filter':'none','--feature-grad':'linear-gradient(150deg,#0d1524 0%,#111d33 55%,#0e2740 100%)','--feature-border':'rgba(120,180,230,0.16)'},
};
const THEME_KEYS = Object.keys(THEMES.light);
const decl = t => THEME_KEYS.map(k => `${k}:${THEMES[t][k]};`).join('');

function liftThemeVars(host) {
  const root = host.querySelector('[data-dc-tpl]');
  if (!root) return;
  const style = root.getAttribute('style') || '';
  // strip only the theme custom properties; leave every other declaration alone
  const kept = style.split(';')
    .map(s => s.trim()).filter(Boolean)
    .filter(d => !THEME_KEYS.some(k => d.startsWith(k + ':') || d.startsWith(k + ' :')))
    .join(';');
  root.setAttribute('style', kept + (kept.endsWith(';') ? '' : ';'));
}

const THEME_BOOT =
  `<script>(function(){try{var h=new Date().getHours();` +
  `document.documentElement.setAttribute('data-theme',(h>=19||h<6)?'dark':'light')}catch(e){` +
  `document.documentElement.setAttribute('data-theme','light')}})();</script>`;

/* the @font-face / keyframes / scrollbar block already in index.html */
function headStyleBlock() {
  const m = indexHtml.match(/<style>([\s\S]*?)<\/style>/);
  return m ? m[1] : '';
}

/* Reproduces the SPA's lockup fit in the browser, where measurement works.
 * Invariant: the wordmark and the purple pill are ALWAYS exactly the same
 * width, at every breakpoint; the whole lockup scales down proportionally on
 * smaller screens. Method matches index.html's desktop branch — measure the
 * pill's natural width, fit the wordmark to just under it, then spread the
 * letter-spacing across the gaps so the glyphs span the pill exactly. */
const LOCKUP_FIT = `
<script>
(function(){
  var lockup=document.querySelector('[data-sr-lockup]'),
      logo=document.querySelector('[data-sr-logo]'),
      sub=document.querySelector('[data-sr-sub]');
  if(!lockup||!logo||!sub)return;
  var TEXT=logo.textContent||'';
  function probe(src,text,extra){
    var s=document.createElement('span'),cs=getComputedStyle(src);
    s.textContent=text;
    s.style.cssText='position:absolute;visibility:hidden;white-space:nowrap;pointer-events:none;top:-9999px;left:-9999px;';
    s.style.fontFamily=cs.fontFamily;s.style.fontWeight=cs.fontWeight;
    s.style.fontStyle=cs.fontStyle;s.style.letterSpacing=cs.letterSpacing;
    s.style.textTransform=cs.textTransform;
    if(extra)for(var k in extra)s.style[k]=extra[k];
    document.body.appendChild(s);return s;
  }
  function fitFont(el,targetW,start){
    var size=start;
    for(var i=0;i<7;i++){
      el.style.fontSize=size+'px';
      var w=el.offsetWidth;if(!w)break;
      var next=size*(targetW/w);
      if(Math.abs(next-size)<0.15){size=next;break}
      size=next;
    }
    return size;
  }
  function fit(){
    var vw=window.innerWidth;
    var base=Math.max(7,Math.min(12,7+(Math.min(1200,Math.max(700,vw))-700)/500*5));
    var nav=logo.closest('nav'),avail=Infinity;
    if(nav){
      var ncs=getComputedStyle(nav);
      var padX=(parseFloat(ncs.paddingLeft)||0)+(parseFloat(ncs.paddingRight)||0);
      var right=nav.lastElementChild,rw=(right&&right!==lockup)?right.offsetWidth:0;
      avail=Math.max(60,nav.clientWidth-padX-rw-16);
    }
    sub.style.fontSize=base.toFixed(2)+'px';
    var scs=getComputedStyle(sub);
    var subPadX=(parseFloat(scs.paddingLeft)||0)+(parseFloat(scs.paddingRight)||0);
    var sp=probe(sub,sub.textContent);
    sp.style.fontSize=base+'px';
    var target=sp.offsetWidth+subPadX;
    if(target>avail){                       // shrink proportionally to fit the nav
      base=Math.max(4.5,fitFont(sp,Math.max(20,avail-subPadX),base));
      sub.style.fontSize=base.toFixed(2)+'px';
      sp.style.fontSize=base+'px';
      target=sp.offsetWidth+subPadX;
    }
    sp.remove();
    if(!target)return;
    var lp=probe(logo,TEXT,{letterSpacing:'normal'});
    var size=fitFont(lp,target*0.965,parseFloat(getComputedStyle(logo).fontSize)||27);
    lp.style.fontSize=size+'px';
    var naturalW=lp.offsetWidth;
    lp.remove();
    if(!naturalW)return;
    var gaps=Math.max(1,(TEXT.length||1)-1);
    var ls=(target-naturalW)/gaps;
    logo.style.fontSize=size.toFixed(2)+'px';
    logo.style.letterSpacing=ls.toFixed(3)+'px';
    logo.style.marginRight=(-ls).toFixed(3)+'px';
    lockup.style.width=target.toFixed(2)+'px';
  }
  fit();
  if(document.fonts&&document.fonts.ready)document.fonts.ready.then(fit);
  var t;addEventListener('resize',function(){clearTimeout(t);t=setTimeout(fit,80)});
})();

/* The theme toggle is a React handler in the SPA, so on a static page it would
 * be a dead control. Wire it to the same data-theme attribute the CSS uses. */
(function(){
  var btns=document.querySelectorAll('button[aria-label="Toggle light or dark mode"]');
  if(!btns.length)return;
  var sun=null,moon=null;
  function render(){
    var dark=document.documentElement.getAttribute('data-theme')==='dark';
    for(var i=0;i<btns.length;i++){
      var svg=btns[i].querySelector('svg');
      if(!svg)continue;
      if(!sun&&!moon){/* capture whichever icon was prerendered */}
      svg.style.display='';
      btns[i].setAttribute('aria-pressed',dark?'true':'false');
    }
  }
  for(var i=0;i<btns.length;i++){
    btns[i].addEventListener('click',function(e){
      e.preventDefault();
      var d=document.documentElement.getAttribute('data-theme')==='dark';
      document.documentElement.setAttribute('data-theme',d?'light':'dark');
      try{localStorage.setItem('sr-theme',d?'light':'dark')}catch(err){}
      render();
    });
  }
  render();
})();
</script>`;

const LIGHTBOX = `
<div id="sr-lb" role="dialog" aria-modal="true" aria-label="Image viewer" style="position:fixed;inset:0;z-index:100;display:none;flex-direction:column;background:color-mix(in srgb, var(--bg2) 90%, black);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);">
  <div style="display:flex;align-items:center;justify-content:space-between;padding:20px 26px;">
    <span id="sr-lbc" style="font-family:var(--f-mono);font-size:12px;letter-spacing:0.1em;color:var(--fg-dim);"></span>
    <button id="sr-lbx" aria-label="Close" style="width:40px;height:40px;border-radius:999px;border:1px solid var(--line2);background:transparent;color:var(--fg);font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center;">✕</button>
  </div>
  <div style="position:relative;flex:1;display:flex;align-items:center;justify-content:center;gap:20px;padding:0 20px;min-height:0;">
    <button id="sr-lbp" aria-label="Previous" style="position:absolute;left:12px;top:50%;transform:translateY(-50%);z-index:2;width:52px;height:52px;border-radius:999px;border:1px solid rgba(255,255,255,0.28);background:rgba(18,16,26,0.62);color:#fff;font-size:22px;cursor:pointer;display:flex;align-items:center;justify-content:center;">‹</button>
    <img id="sr-lbi" src="" alt="" style="max-width:90vw;max-height:80vh;width:auto;height:auto;object-fit:contain;border-radius:6px;box-shadow:0 20px 60px -20px rgba(0,0,0,0.5);">
    <button id="sr-lbn" aria-label="Next" style="position:absolute;right:12px;top:50%;transform:translateY(-50%);z-index:2;width:52px;height:52px;border-radius:999px;border:1px solid rgba(255,255,255,0.28);background:rgba(18,16,26,0.62);color:#fff;font-size:22px;cursor:pointer;display:flex;align-items:center;justify-content:center;">›</button>
  </div>
  <div id="sr-lbl" style="padding:18px 26px 26px;text-align:center;font-family:var(--f-mono);font-size:12px;letter-spacing:0.08em;color:var(--fg-dim);text-transform:uppercase;"></div>
</div>
<script>
(function(){
  var slots=[].slice.call(document.querySelectorAll('main img[loading="lazy"], img[loading="lazy"]'));
  slots=slots.filter(function(m){return m.closest('#sr-lb')===null});
  if(!slots.length)return;
  var i=0,lb=document.getElementById('sr-lb'),el=document.getElementById('sr-lbi'),
      c=document.getElementById('sr-lbc'),l=document.getElementById('sr-lbl');
  function pad(n){return n<10?'0'+n:''+n}
  function show(n){i=(n+slots.length)%slots.length;el.src=slots[i].src;el.alt=slots[i].alt||'';
    c.textContent=pad(i+1)+' / '+pad(slots.length);l.textContent=slots[i].alt||''}
  function open(n){show(n);lb.style.display='flex';document.body.style.overflow='hidden'}
  function close(){lb.style.display='none';document.body.style.overflow=''}
  slots.forEach(function(m,n){m.style.cursor='pointer';m.addEventListener('click',function(){open(n)})});
  document.getElementById('sr-lbx').onclick=close;
  document.getElementById('sr-lbp').onclick=function(e){e.stopPropagation();show(i-1)};
  document.getElementById('sr-lbn').onclick=function(e){e.stopPropagation();show(i+1)};
  lb.addEventListener('click',function(e){if(e.target===lb)close()});
  document.addEventListener('keydown',function(e){
    if(lb.style.display!=='flex')return;
    if(e.key==='Escape')close();if(e.key==='ArrowLeft')show(i-1);if(e.key==='ArrowRight')show(i+1)});
})();
</script>`;

function assemble({ slug, title, desc, runtimeCss, bodyHtml, jsonld }) {
  const url = `${ORIGIN}/${slug}`;
  const ld = jsonld
    ? `<script type="application/ld+json">\n${JSON.stringify(jsonld)}\n</script>\n`
    : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${url}">
<link rel="icon" href="favicon.ico" sizes="any">
<link rel="icon" type="image/svg+xml" href="favicon.svg">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Skott Reader">
<meta property="og:url" content="${url}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${ORIGIN}/assets/og-card.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${ORIGIN}/assets/og-card.png">
${ld}<style>
${headStyleBlock()}
html,body{height:100%;margin:0}
:root{${decl('light')}}
html[data-theme="dark"]{${decl('dark')}}
/* jsdom always prerenders the desktop nav (it has no viewport), so give narrow
 * screens room: tighten the link row and drop the theme toggle under 760px.
 * The lockup fitter then scales the wordmark to whatever space is left. */
@media (max-width:760px){
  [data-sr-lockup] ~ div > a{font-size:15px !important}
  [data-sr-lockup] ~ div{gap:14px !important}
  [data-sr-lockup] ~ div > button[aria-label="Toggle light or dark mode"]{display:none !important}
}
@media (max-width:420px){
  [data-sr-lockup] ~ div > a{font-size:13px !important}
  [data-sr-lockup] ~ div{gap:10px !important}
}
${runtimeCss}
</style>
${THEME_BOOT}
</head>
<body>
${bodyHtml}
${LOCKUP_FIT}
${LIGHTBOX}
</body>
</html>
`;
}

const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

module.exports = { render, transform, liftThemeVars, assemble, esc, THEMES, THEME_KEYS };

/* ------------------------------------------------------------------ *
 * CLI: build a single page so it can be eyeballed before the full run
 * ------------------------------------------------------------------ */
if (require.main === module) {
  (async () => {
    const route = process.argv[4] || '#/project/uber';
    const slug = process.argv[5] || 'preview-uber.html';
    const { doc, host, runtimeCss, title } = await render(route);
    liftThemeVars(host);
    const rep = transform(host, doc, {
      prevHref: 'psilo.html', nextHref: 'werk.html', h1Text: 'Uber',
    });
    const html = assemble({
      slug, title,
      desc: 'Logo options for an internal Uber dev tool. Uber, 2017 — logo design, brand identity. Work by Skott Reader.',
      runtimeCss, bodyHtml: host.outerHTML,
    });
    fs.writeFileSync(path.join(OUT, slug), html);
    console.log(`wrote ${slug}  ${html.length.toLocaleString()} bytes`);
    console.log('transform:', JSON.stringify(rep));
  })().catch(e => { console.error('BUILD FAILED:', e.message); process.exit(1); });
}
