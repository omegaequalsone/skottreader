# Static page generation

`index.html` is a client-rendered SPA, so search engines see an empty shell.
These scripts render each route headlessly and write it out as a real page.

**Re-run after editing the `PROJECTS` array in `index.html`:**

```bash
npm install jsdom@26.1.0 react@18.3.1 react-dom@18.3.1 @babel/standalone@7.29.0
NM=./node_modules SR_SITE=.. node build-all.js
```

Generates the 16 project pages plus `work.html`, `about.html`, `contact.html`,
and `sitemap.xml`. `verify.js` diffs a generated page against the live SPA
render and reports any style difference.

**jsdom is pinned on purpose.** Later versions discard `clamp()` values, which
would strip every responsive font-size and padding from the generated pages.
`build.js` checks for this on startup and refuses to run rather than ship
flattened type.

Note: the nav lockup is measured at runtime, so generated pages carry a small
vanilla port of that fitter (see `LOCKUP_FIT` in `build.js`). jsdom has no
layout engine, so this cannot be baked in at build time.
