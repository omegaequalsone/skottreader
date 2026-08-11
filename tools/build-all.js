#!/usr/bin/env node
/**
 * build-all.js — regenerate every static page for skottreader.com
 *
 * Usage:  SR_SITE=/path/to/skottreader node build-all.js [--dry]
 *
 * Renders each SPA route through jsdom, applies the semantic transforms from
 * build.js, and writes a real page per URL. Output is the app's own render, so
 * the pages cannot drift from what visitors see. See build.js for the why.
 */
process.env.SR_SITE = process.env.SR_SITE || process.argv[2];
process.argv[2] = process.env.SR_SITE;

const fs = require('fs');
const path = require('path');
const { render, transform, liftThemeVars, assemble } = require('./build.js');

const SITE = process.env.SR_SITE;
const DRY = process.argv.includes('--dry');
const ORIGIN = 'https://skottreader.com';

/* ---- read PROJECTS straight out of index.html (single source of truth) ---- */
const src = fs.readFileSync(path.join(SITE, 'index.html'), 'utf8');
const lines = src.split('\n');
const start = lines.findIndex(l => l.includes('PROJECTS = ['));
let end = start; while (!/^\s*\]\s*;?\s*$/.test(lines[end])) end++;
const PROJECTS = eval('(' + lines.slice(start, end + 1).join('\n')
  .replace(/^\s*PROJECTS\s*=\s*/, '').replace(/;\s*$/, '') + ')');

/* A caseStudy project lives on the #/case-study route, not #/project/<id>. */
const slugOf  = p => `${p.id}.html`;
const routeOf = p => p.caseStudy ? '#/case-study' : `#/project/${p.id}`;

const CATEGORY = { brand: 'Visual / Brand Design', pres: 'Presentation Design' };

function descFor(p) {
  const disc = (p.tags || []).join(', ');
  const base = p.tagline ? `${p.tagline} ` : '';
  const d = `${base}${p.client}, ${p.year} — ${disc}. ${CATEGORY[p.category] || 'Design'} by Skott Reader, independent brand and visual designer.`;
  return d.length > 300 ? d.slice(0, 297) + '…' : d;
}
function titleFor(p) {
  return `${p.client} — ${CATEGORY[p.category] || 'Design'} — Skott Reader`;
}

/* Per-project CreativeWork schema. Tells Google these are 16 distinct portfolio
 * pieces by one creator, rather than 16 similar-looking pages. */
const AUTHOR = {
  '@type': 'Person', name: 'Skott Reader', url: `${ORIGIN}/`,
  jobTitle: 'Brand, Visual & Presentation Designer',
};
function jsonldFor(p) {
  const imgs = (p.images || []).slice(0, 6).map(u => `${ORIGIN}/${u}`);
  const yearStart = String(p.year).match(/\d{4}/);
  return {
    '@context': 'https://schema.org',
    '@type': 'CreativeWork',
    name: `${p.client} — ${CATEGORY[p.category] || 'Design'}`,
    headline: p.tagline || `${p.client} — ${p.role}`,
    description: descFor(p),
    url: `${ORIGIN}/${slugOf(p)}`,
    creator: AUTHOR,
    author: AUTHOR,
    ...(yearStart ? { dateCreated: yearStart[0] } : {}),
    ...(p.client ? { about: { '@type': 'Organization', name: p.client } } : {}),
    keywords: (p.tags || []).join(', '),
    genre: CATEGORY[p.category] || 'Design',
    ...(imgs.length ? { image: imgs } : {}),
    isPartOf: { '@type': 'CollectionPage', name: 'Work', url: `${ORIGIN}/work.html` },
  };
}

/* Tile -> project page map for the Work grid (tiles carry a unique thumb URL). */
const NON_CASE = PROJECTS.filter(p => !p.caseStudy);
const TILE_MAP = {
  byThumb: Object.fromEntries(NON_CASE.filter(p => p.thumb).map(p => [p.thumb, slugOf(p)])),
  order: NON_CASE.map(slugOf),
};

/* ---- the three section pages ---- */
const SECTIONS = [
  { slug: 'work.html', route: '#/work',
    title: 'Work — Brand, Visual & Presentation Design — Skott Reader',
    desc: 'Selected brand identity, design system, and presentation design projects by Skott Reader — including Standard Model Bio, Swimlane, ServiceNow, BitGo, Sui, OpenAI and Movement Labs.' },
  { slug: 'about.html', route: '#/about',
    title: 'About — Skott Reader, Brand & Visual Designer',
    desc: 'Skott Reader is an independent brand, visual and presentation designer with two decades of experience across biopharma, fintech, blockchain, education, retail and AI — designing identities, design systems, and AI-accelerated websites.' },
  { slug: 'contact.html', route: '#/contact',
    title: 'Contact — Skott Reader',
    desc: 'Get in touch with Skott Reader about brand identity, design systems, presentation design, or an AI-accelerated design-to-build website project. Response within 24 hours.' },
];

(async () => {
  const results = [];
  const failures = [];

  /* ---------------- project pages ---------------- */
  for (let i = 0; i < PROJECTS.length; i++) {
    const p = PROJECTS[i];
    // The SPA cycles prev/next within a category, so walking the flat PROJECTS
    // array puts the wrong href on the last project of each category — the link
    // then disagrees with the label the SPA rendered right next to it.
    const sib = PROJECTS.filter(x => x.category === p.category && !x.caseStudy);
    const si = sib.findIndex(x => x.id === p.id);
    // At either end of a category the SPA renders an "All work" button instead
    // of a prev/next link, so there is no anchor to point anywhere; the
    // work.html fallback also covers case studies, which are not in the chain.
    const prev = (si > 0 ? sib[si - 1] : null) || { id: 'work' };
    const next = (si >= 0 ? sib[si + 1] : null) || { id: 'work' };
    const slug = slugOf(p);
    try {
      const { doc, host, runtimeCss, title } = await render(routeOf(p));
      liftThemeVars(host);
      const rep = transform(host, doc, {
        prevHref: slugOf(prev), nextHref: slugOf(next), h1Text: p.client, tileMap: TILE_MAP,
      });
      const html = assemble({
        slug, title: titleFor(p), desc: descFor(p), runtimeCss,
        bodyHtml: host.outerHTML, jsonld: jsonldFor(p),
      });
      if (!DRY) fs.writeFileSync(path.join(SITE, slug), html);
      const text = host.textContent.replace(/\s+/g, ' ').trim().length;
      results.push({ slug, bytes: html.length, text, ...rep });
      console.log(`  ✓ ${slug.padEnd(24)} ${String(html.length).padStart(7)}b  text=${String(text).padStart(5)}  h1=${rep.h1?'y':'n'} imgs=${String(rep.imgs).padStart(2)} hrefs=${rep.hrefs}`);
    } catch (e) {
      failures.push(`${slug}: ${e.message}`);
      console.error(`  ✗ ${slug}: ${e.message}`);
    }
  }

  /* ---------------- section pages ---------------- */
  for (const s of SECTIONS) {
    try {
      const { doc, host, runtimeCss } = await render(s.route);
      liftThemeVars(host);
      const rep = transform(host, doc, { tileMap: TILE_MAP });
      const ld = s.slug === 'work.html' ? {
        '@context': 'https://schema.org',
        '@type': 'CollectionPage',
        name: 'Work — Skott Reader',
        description: s.desc,
        url: `${ORIGIN}/work.html`,
        about: AUTHOR,
        hasPart: PROJECTS.map(p => ({
          '@type': 'CreativeWork', name: p.client,
          url: `${ORIGIN}/${slugOf(p)}`, genre: CATEGORY[p.category] || 'Design',
        })),
      } : null;
      const html = assemble({ slug: s.slug, title: s.title, desc: s.desc, runtimeCss, bodyHtml: host.outerHTML, jsonld: ld });
      if (!DRY) fs.writeFileSync(path.join(SITE, s.slug), html);
      const text = host.textContent.replace(/\s+/g, ' ').trim().length;
      results.push({ slug: s.slug, bytes: html.length, text, ...rep });
      console.log(`  ✓ ${s.slug.padEnd(24)} ${String(html.length).padStart(7)}b  text=${String(text).padStart(5)}  h1=${rep.h1?'y':'n'} imgs=${String(rep.imgs).padStart(2)} hrefs=${rep.hrefs}`);
    } catch (e) {
      failures.push(`${s.slug}: ${e.message}`);
      console.error(`  ✗ ${s.slug}: ${e.message}`);
    }
  }

  /* ---------------- sitemap ---------------- */
  const today = new Date().toISOString().slice(0, 10);
  const urls = [
    { loc: `${ORIGIN}/`, pri: '1.0' },
    { loc: `${ORIGIN}/work.html`, pri: '0.9' },
    { loc: `${ORIGIN}/cv.html`, pri: '0.9' },
    { loc: `${ORIGIN}/about.html`, pri: '0.8' },
    { loc: `${ORIGIN}/contact.html`, pri: '0.7' },
    ...PROJECTS.map(p => ({ loc: `${ORIGIN}/${slugOf(p)}`, pri: p.caseStudy ? '0.9' : '0.7' })),
  ];
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url>
    <loc>${u.loc}</loc>
    <lastmod>${today}</lastmod>
    <priority>${u.pri}</priority>
  </url>`).join('\n')}
</urlset>
`;
  if (!DRY) fs.writeFileSync(path.join(SITE, 'sitemap.xml'), sitemap);
  console.log(`\n  ✓ sitemap.xml  ${urls.length} URLs`);

  console.log(`\n${results.length} pages generated, ${failures.length} failures`);
  if (failures.length) { failures.forEach(f => console.error('  ' + f)); process.exit(1); }
})().catch(e => { console.error('BUILD FAILED:', e.stack); process.exit(1); });
