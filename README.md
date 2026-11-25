# agenttrustlayer.com living map (preview)

Static page built from `../data/entries.json` and `../data/changelog.json` (the data folder sits next to this repo on the build box; copies ship in `docs/data/`).

- Build: `node build.mjs` writes `docs/` (GitHub Pages serves `docs/` on `main`).
- Add rows: append to the data files, then rebuild. No code change needed.
- Preview only: every page has `noindex,nofollow` and `robots.txt` disallows all.
- No trackers, cookies, accounts, forms or third-party requests.
