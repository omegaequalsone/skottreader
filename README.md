# Skott Reader — Portfolio Site

Static site. No build step — open `index.html` or deploy the folder as-is (GitHub Pages, Netlify, etc.).

## Structure
- `index.html` — main site (home, Standard Model case study, work, about, contact, project details). Single-page app using in-page `#/…` routing.
- `cv.html` — printable CV.
- `work.html`, `about.html`, `contact.html` — section entry pages (redirect into `index.html`).
- `bitgo.html`, `citrix.html`, `uber.html`, … — per-project entry pages (redirect into the matching project detail; filenames match project ids, e.g. `ssc-advent.html`, `movementlabs.html`). `standardmodel.html` redirects to the case study.
- `support.js`, `doc-page.js` — runtime helpers (required).
- `assets/portrait.png` — Skott's photo (home + about).
- `assets/thumbs/` — project thumbnails, one per project id (`bitgo.png`, `ssc-advent.png`, …; `swimlane.png` is shared by both Swimlane projects).
- `assets/swimlane-logo.svg` — Swimlane's previous logo (shown on the Swimlane brand page).
- `assets/galleries/<project>/NN.jpg` — full gallery/hero images for each project detail page (all local; nothing hot-linked).

## Deploy to GitHub Pages
1. Push this folder to your repo.
2. Settings → Pages → deploy from branch → `/root`.
3. The included `.nojekyll` keeps GitHub from filtering any files.
