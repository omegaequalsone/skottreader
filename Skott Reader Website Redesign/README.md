# Skott Reader — Portfolio Site

Static site. No build step — open `index.html` or deploy the folder as-is (GitHub Pages, Netlify, etc.).

## Structure
- `index.html` — main site (home, work, about, contact, project details). Single-page app using in-page `#/…` routing.
- `cv.html` — printable CV.
- `work.html`, `about.html`, `contact.html` — section entry pages (redirect into `index.html`).
- `bitgo.html`, `citrix.html`, `uber.html`, … — per-project entry pages (redirect into the matching project detail).
- `support.js`, `doc-page.js` — runtime helpers (required).
- `uploads/`, `assets/` — images and static assets.

## Deploy to GitHub Pages
1. Push this folder to your repo.
2. Settings → Pages → deploy from branch → `/root`.
3. The included `.nojekyll` keeps GitHub from filtering any files.
