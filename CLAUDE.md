# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ZONA-NORTE Sub-12 Championship Index System — automated data management for the Campeonato Distrital Sub-12 (Futebol 9 - Zona Norte) tournament (season 2026/2027). Manages team standings, match results, and top scorers for 9 teams, sourced from the FPF results portal (`resultados.fpf.pt`).

## Common Commands

**Install dependencies (required for browser fallback):**
```bash
npm install
npx playwright install chromium
```

**Update championship data (Node updater):**
```bash
node update-zonanorte-index.js update
```

**Validate index integrity:**
```bash
node update-zonanorte-index.js validate
```

**Check status / print current standings:**
```bash
node update-zonanorte-index.js status
```

**Check for updates (used in scheduled runs):**
```bash
node update-zonanorte-index.js check
```

**Set up automated updates (prints cron/task commands):**
```bash
node update-zonanorte-index.js setup
```

**Package shortcuts:**
```bash
npm run update    # same as node update-zonanorte-index.js update
npm run validate  # same as node update-zonanorte-index.js validate
```

**Python updater (independent loop with fallback):**
```bash
python3 keep-data-updated.py --once
python3 keep-data-updated.py --interval 60
```

**Serve the static display page:**
```bash
python3 -m http.server 8000
```

**Automated scheduling:**
- Unix: `0 */6 * * * cd "/path/to/repo" && node update-zonanorte-index.js check`
- Windows Task Scheduler: run `node` with argument `update-zonanorte-index.js check` every 6 hours.

## Architecture

**Dual maintenance pipeline:** Both Node (`update-zonanorte-index.js` + `fetch-zonanorte-data.js`) and Python (`keep-data-updated.py`) maintain the same championship index. The Python script runs continuously/interval-based and handles 403 errors via cached HTML embedded in `index.html`; the Node script is invoked manually or via cron.

**Fetcher fallback chain (`fetch-zonanorte-data.js`):**
1. Direct `fetch()` to `https://resultados.fpf.pt/Competition/Details?competitionId=30614&seasonId=106` with browser-like headers.
2. If `403` or network failure, retry through headless Chromium via `playwright` (`fetchFromBrowser`).
3. If browser fails, fall back to cached data / embedded JSON in `index.html`.
4. Parsed HTML targets the `ZONA-NORTE` block (`htmlSerieId_100601`) and follows fixture links for classification and played matches.

**Index file dual-writing (`update-zonanorte-index.js`):**
- Primary: `data/zonanorte-championship-index.json`
- Root copy: `zonanorte-championship-index.json` (used by static page when served over HTTP, and also embedded in HTML)
- Before each update, a backup is written to `backups/zonanorte-championship-index-backup.json`
- Logs go to `data/update.log` (Node) and `data/updater.log` (Python)

**Static page data embedding (`index.html`):** The updater performs regex replacement on markers `/* EMBEDDED_DATA_START */` and `/* EMBEDDED_DATA_END */` inside `window.__ZONANORTE_DATA__`. The display page reads this embedded object when loaded locally (without HTTP server), and loads the root JSON file when served via HTTP.

**Data structure (from `zonanorte-championship-index.json`):**
- `metadata`: source (`fpf_website` / `fallback_index_html`), competition/season IDs, `zona`, `lastUpdated`, championship config
- `teams`: 9 teams with standings (points, GD, goals for/against, matches played)
- `matches`: played results (jornada 1, 2) with home/away, scores, dates
- `topScorers`: player names, team, goal counts (includes locally entered Valpacinhos scorers)
- `standings`: sorted by points/goal difference

**Python updater (`keep-data-updated.py`) specifics:** Uses `requests`, maintains its own `Config` with paths, writes to `data/updater.log`, creates backups, and embeds data back into `index.html` and root JSON. It can run with `--interval` in a loop or `--once` for a single pass.

## Important Notes

- The FPF portal frequently returns `403 Forbidden`; Playwright (`npm install` + `npx playwright install chromium`) is required for reliable updates.
- The `fetch-zonanorte-data.js` module exports `{ zonanorteFetcher }`; the updater requires it via `require('./fetch-zonanorte-data.js')`.
- Never delete `index.html` embedded markers — the updater depends on them for static-page updates.
- Backup files in `backups/` are overwritten each run; they are not versioned.
