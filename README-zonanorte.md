# ZONA-NORTE Championship Index System

This repository contains an automated system for managing and displaying ZONA-NORTE championship data for the Campeonato Distrital Sub-12 (Futebol 9 - Zona Norte) tournament.

## Overview

The system provides:
- **Automated data fetching** from the FPF website (when access is available)
- **Structured JSON index file** containing all championship data
- **JavaScript updater** that runs automatically and maintains data freshness
- **HTML display page** that shows championship standings and match results
- **Backup and validation** mechanisms to ensure data integrity

## Current Status

The fetcher now reads the FPF competition page and keeps only the block identified as `ZONA-NORTE` (`htmlSerieId_100601`). It follows that block's fixture links (`GetClassificationAndMatchesByFixture`) to collect the classification and all played matches. If the FPF portal is temporarily unavailable, the previous JSON data is retained through the fallback flow.

### Championship Information
- **Name**: Campeonato Distrital Sub-12 (Futebol 9 - Zona Norte) • 2026/2027
- **Season**: 2026/2027
- **Format**: Futebol 9 (9-a-side football)
- **Age Group**: Sub-12
- **Zone**: ZONA-NORTE
- **Teams**: 9 teams
- **Current Season Progress**: determined from the played matches returned by the FPF fixture endpoints

## Files

### Core Files

1. **`zonanorte-championship-index.json`**
   - Main championship data index file
   - Contains team standings, match results, top scorers
   - Updated automatically via the updater system

2. **`fetch-zonanorte-data.js`**
   - Data fetcher class
   - Attempts to fetch data from FPF website
   - Provides fallback to cached and local data
   - Handles website access issues gracefully

3. **`update-zonanorte-index.js`**
   - Main updater script
   - Runs automated updates on schedule
   - Creates backups before updates
   - Validates data integrity

4. **`index.html`**
   - Responsive championship display page
   - Loads `zonanorte-championship-index.json` when served over HTTP
   - Shows results, standings, and locally entered Valpacinhos scorers

5. **`README-zonanorte.md`**
   - This documentation file

### Data Files

6. **`data/` directory**
   - Contains `zonanorte-championship-index.json` (main index)
   - Contains `update.log` (update history)

7. **`backups/` directory**
   - Contains backup versions of the index file

## Usage

### Quick Start

Install the optional browser synchronizer once:
```bash
npm install
npx playwright install chromium
```

The updater first tries a direct request. If FPF returns `403`, it automatically retries through a headless Chromium browser, which handles the portal's browser checks and session cookies.

1. **View Current Championship Status**
   ```bash
   node update-zonanorte-index.js status
   ```

2. **Manually Update Championship Data**
   ```bash
   node update-zonanorte-index.js update
   ```

3. **Check for Updates and Update if Needed**
   ```bash
   node update-zonanorte-index.js check
   ```

4. **Validate Current Index**
   ```bash
   node update-zonanorte-index.js validate
   ```

5. **Set Up Automated Updates**
   ```bash
   node update-zonanorte-index.js setup
   ```

### Automated Updates

The system is designed to run automatically:

**Unix/Linux/macOS (Cron):**
```bash
crontab -e
# Add this line to run every 6 hours at minute 0
0 */6 * * * cd "/path/to/this/repo" && node update-zonanorte-index.js check
```

**Windows Task Scheduler:**
- Create a new task
- Set trigger: "On a schedule", repeat every 6 hours
- Action: "Start a program"
- Program: `node`
- Arguments: `update-zonanorte-index.js check`

### Data Flow

1. **Updater Script (`update-zonanorte-index.js`)**
   - Triggers automatic data update
   - Runs fetcher (`fetch-zonanorte-data.js`)
   - Downloads and processes data
   - Saves to `zonanorte-championship-index.json`

2. **Data Fetcher (`fetch-zonanorte-data.js`)**
   - Attempts to fetch from FPF website
   - Falls back to cached data
   - Uses local fallback data from `index.html`
   - Handles website access issues

3. **Index File (`zonanorte-championship-index.json`)**
   - Stores all championship data in JSON format
   - Contains metadata, teams, matches, scorers
   - Updated automatically

## Technical Details

### Data Structure

The `zonanorte-championship-index.json` file contains:

#### Metadata
- `source`: Data source (fpf_website, fallback_index_html, etc.)
- `competitionId`: FPF competition identifier
- `seasonId`: FPF season identifier
- `zona`: Zone name (ZONA-NORTE)
- `lastUpdated`: Timestamp of last data update
- `championship`: Championship configuration

#### Teams
- Complete list of 9 teams in ZONA-NORTE
- Current standings, matches played, results
- Goals for/against, goal difference, points

#### Matches
- Match results (jornada 1 and 2 completed)
- Home/away teams, goals scored
- Match dates

#### Top Scorers
- Players with most goals scored
- Team affiliation and goal counts

#### Standings
- Sorted team standings (points, goal difference, goals)
- Position rankings

### Error Handling

The system includes comprehensive error handling:

1. **Website Access Failures**
   - Graceful fallback to cached data
   - Uses local data from `index.html` as final fallback
   - Logs all errors for troubleshooting

2. **Data Validation**
   - Validates required fields in index file
   - Checks consistency between teams and standings
   - Logs warnings for data inconsistencies

3. **Backup Creation**
   - Creates backup before each update
   - Prevents data loss
   - Allows recovery from corrupted updates

### File Paths

| File | Path | Purpose |
|------|------|---------|
| Main Index | `zonanorte-championship-index.json` | Primary data storage |
| Root Index | `zonanorte-championship-index.json` (root) | Backward compatibility |
| Updater Script | `update-zonanorte-index.js` | Automated updates |
| Fetcher Script | `fetch-zonanorte-data.js` | Data fetching logic |
| Original Display | `index.html` | Championship display |
| Backups | `backups/zonanorte-championship-index-backup.json` | Data backups |
| Logs | `data/update.log` | Update history |

## Troubleshooting

### Common Issues

1. **"403 Forbidden" Error**
   - The FPF website blocks automated access
   - Solution: System falls back to cached/local data
   - Expected behavior when website is not accessible

2. **Missing Files**
   - Ensure all required files are present
   - Run: `node update-zonanorte-index.js validate`

3. **Node.js Issues**
   - Ensure Node.js is installed (v14+ recommended)
   - All scripts use modern JavaScript features

### Manual Data Updates

When the FPF website becomes accessible, you can:

1. **Run manual update**:
   ```bash
   node update-zonanorte-index.js update
   ```

The update command fetches the FPF page, extracts only the Zona Norte series, follows its fixture endpoints, and writes both `data/zonanorte-championship-index.json` and the root `zonanorte-championship-index.json` used by the web page.

It also embeds the latest JSON in `index.html`. This means the page can be opened directly from the file system after an update; serving the folder over HTTP remains useful for live JSON reloads.

### Plantel e marcadores

The page includes a manager area for adding and removing players from the Valpacinhos squad. Only authenticated managers can select a squad player when recording goals. The initial local password is `Valpacinhos2026!`; change `initialManagerPassword` in `index.html` before distributing the page.

This is a local static-page restriction. A real permission boundary requires a server login and a database/API; anyone who can edit the HTML or browser storage can bypass this local lock.

2. **Check website manually**:
   https://resultados.fpf.pt/Competition/Details?competitionId=30614&seasonId=106

3. **Monitor logs**:
   Check `data/update.log` for update attempts and results

## Future Enhancements

The system can be extended with:

1. **Real Website Integration**
   - When FPF website access is available, fetch real-time data
   - Parse HTML to extract ZONA-NORTE specific results

2. **Multiple Zones Support**
   - Extend to support other zones (ZONA-SUL, ZONA-Centro, etc.)

3. **Advanced Statistics**
   - Head-to-head records
   - Home/away records
   - Recent form tracking

4. **Web Interface**
   - Enhanced web page with filters and search
   - Mobile-responsive design
   - Real-time updates via WebSocket

5. **API Endpoint**
   - JSON API for external integrations
   - Webhook notifications for data changes

## License

This project is part of the Valpacinhos Sub-12 Championship management system.

Copyright (c) 2026 Valpacinhos Football Club

All rights reserved. Data may not be redistributed without permission.

## Contact

For support or questions about the ZONA-NORTE Championship Index System:

- File issues in this repository
- Check the update logs in `data/update.log`
- Review the git history for recent changes

## Update History

### Recent Changes
- **2026-10-25**: Initial implementation with fallback data
- **2026-10-25**: Added automated updater with backup system
- **2026-10-25**: Implemented comprehensive error handling
- **2026-10-25**: Added validation and logging mechanisms

### Next Steps
- Monitor FPF website access status
- Implement real website integration when available
- Add automated deployment to web server
- Extend to other zones and competitions
