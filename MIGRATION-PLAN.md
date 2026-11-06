# Migration Plan: FPF Fetcher → Manual HTML + Supabase

**Project:** ZONA-NORTE Sub-12 Championship Index System  
**Date:** 2026-11-06  
**Status:** Planning Phase

---

## 📋 Executive Summary

Replace the automated FPF website fetching pipeline with a **manual HTML → Python extractors → Supabase → index.html** architecture. The 18 Jornada HTML files already exist in `data/jornadas/`. Two Python extractors (`extrair_jogos_html.py`, `extrair_estadios_html.py`) are ready. Supabase is already configured in `index.html` for `players` and `goal_entries` tables.

---

## 🗑️ Files That Will Become Obsolete

| File / Directory | Reason |
|------------------|--------|
| `fetch-zonanorte-data.js` | Core FPF fetching logic replaced by manual HTML + Python extractors |
| `update-zonanorte-index.js` | Node updater that calls fetcher; no longer needed |
| `keep-data-updated.py` | Python updater with FPF fetch logic; replaced by manual workflow |
| `zonanorte-championship-index.json` (root) | Embedded JSON no longer used |
| `data/zonanorte-championship-index.json` | Primary index file no longer used |
| `data/zonanorte-cache.json` | Cache for FPF fetcher; no longer needed |
| `data/update.log` / `data/updater.log` | Logs for automated fetchers; no longer needed |
| `backups/` directory | Backup system for index files; no longer needed |
| `.github/workflows/atualizar-fpf.yml` | GitHub Actions for automated FPF updates; no longer needed |
| `package.json` / `package-lock.json` | Node dependencies (Playwright); no longer needed |
| `node_modules/` | Playwright installation; no longer needed |
| Embedded data markers in `index.html` (`/* EMBEDDED_DATA_START */`) | No longer embedding JSON in HTML |

**Files to KEEP:**
- `index.html` (major rewrite to use Supabase)
- `data/jornadas/` (HTML source files + extractor scripts)
- `requirements.txt` (Python dependencies for extractors)
- `CLAUDE.md` (update to reflect new architecture)
- `README-zonanorte.md` (update or replace)
- `IMPLEMENTATION-SUMMARY.md` (archive or update)

---

## 🗄️ Supabase Table Design

### 1. `tblCalendario` (from `tblCalendario.csv`)

```sql
CREATE TABLE tblCalendario (
    IdJogo          SERIAL PRIMARY KEY,
    Jornada         INTEGER NOT NULL,
    Data            DATE NOT NULL,
    Hora            TIME,
    IdEquipaCasa    INTEGER NOT NULL REFERENCES tblEquipas(IdEquipa),
    IdEquipaFora    INTEGER NOT NULL REFERENCES tblEquipas(IdEquipa),
    ResultadoCasa   INTEGER,
    ResultadoFora   INTEGER,
    IdEstadio       INTEGER REFERENCES tblEstadios(IdEstadio),
    IdZona          INTEGER NOT NULL REFERENCES tblZonas(IdZona),
    CreatedAt       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_calendario_jornada ON tblCalendario(Jornada);
CREATE INDEX idx_calendario_zona ON tblCalendario(IdZona);
CREATE INDEX idx_calendario_data ON tblCalendario(Data);
CREATE INDEX idx_calendario_equipas ON tblCalendario(IdEquipaCasa, IdEquipaFora);
```

### 2. `tblEquipas` (from `/tmp/tblEquipas.csv` — **manual creation required**)

```sql
CREATE TABLE tblEquipas (
    IdEquipa        SERIAL PRIMARY KEY,
    NmEquipa        VARCHAR(100) NOT NULL UNIQUE,
    NmCurto         VARCHAR(30),
    IdZona          INTEGER NOT NULL REFERENCES tblZonas(IdZona),
    EmblemaUrl      VARCHAR(255),
    Activa          BOOLEAN DEFAULT TRUE,
    CreatedAt       TIMESTAMPTZ DEFAULT NOW()
);
```

> **Note:** CSV provided at `/tmp/tblEquipas.csv`. Format: `IdEquipa;NmEquipa;NmCurto;IdZona;EmblemaUrl`

### 3. `tblZonas` (from `tblZonas.csv` — **manual creation required**)

```sql
CREATE TABLE tblZonas (
    IdZona          SERIAL PRIMARY KEY,
    NmZona          VARCHAR(50) NOT NULL UNIQUE,
    NmCurto         VARCHAR(20),
    Ordem           INTEGER DEFAULT 0,
    Activa          BOOLEAN DEFAULT TRUE
);
```

Sample data:
```csv
IdZona;NmZona;NmCurto;Ordem
1;ZONA-NORTE;Norte;1
2;ZONA-CENTRO;Centro;2
3;ZONA-SUL;Sul;3
```

### 4. `tblEstadios` (from `tblEstadios.csv`)

```sql
CREATE TABLE tblEstadios (
    IdEstadio       SERIAL PRIMARY KEY,
    NmEstadio       VARCHAR(100) NOT NULL,
    IdEquipa        INTEGER REFERENCES tblEquipas(IdEquipa),
    Localidade      VARCHAR(100),
    Coordenadas     GEOGRAPHY(POINT),
    CreatedAt       TIMESTAMPTZ DEFAULT NOW()
);
```

### 5. Existing Tables (Keep As-Is)

- `players` — Valpacinhos roster (managed via manager panel)
- `goal_entries` — Goal records linked to `players` and `match_key` (maps to `tblCalendario.IdJogo`)

### 6. Helper View: `vw_standings`

```sql
CREATE OR REPLACE VIEW vw_standings AS
WITH match_points AS (
    SELECT 
        c.Jornada,
        c.IdZona,
        c.IdEquipaCasa AS IdEquipa,
        CASE 
            WHEN c.ResultadoCasa > c.ResultadoFora THEN 3
            WHEN c.ResultadoCasa = c.ResultadoFora THEN 1
            ELSE 0
        END AS Points,
        c.ResultadoCasa AS GF,
        c.ResultadoFora AS GA,
        1 AS Played
    FROM tblCalendario c
    WHERE c.ResultadoCasa IS NOT NULL AND c.ResultadoFora IS NOT NULL
    
    UNION ALL
    
    SELECT 
        c.Jornada,
        c.IdZona,
        c.IdEquipaFora AS IdEquipa,
        CASE 
            WHEN c.ResultadoFora > c.ResultadoCasa THEN 3
            WHEN c.ResultadoFora = c.ResultadoCasa THEN 1
            ELSE 0
        END AS Points,
        c.ResultadoFora AS GF,
        c.ResultadoCasa AS GA,
        1 AS Played
    FROM tblCalendario c
    WHERE c.ResultadoCasa IS NOT NULL AND c.ResultadoFora IS NOT NULL
),
aggregated AS (
    SELECT 
        IdZona,
        IdEquipa,
        SUM(Played) AS Played,
        SUM(CASE WHEN Points = 3 THEN 1 ELSE 0 END) AS Won,
        SUM(CASE WHEN Points = 1 THEN 1 ELSE 0 END) AS Drawn,
        SUM(CASE WHEN Points = 0 THEN 1 ELSE 0 END) AS Lost,
        SUM(GF) AS GoalsFor,
        SUM(GA) AS GoalsAgainst,
        SUM(GF) - SUM(GA) AS GoalDifference,
        SUM(Points) AS Points
    FROM match_points
    GROUP BY IdZona, IdEquipa
)
SELECT 
    a.IdZona,
    z.NmZona,
    a.IdEquipa,
    e.NmEquipa,
    a.Played,
    a.Won,
    a.Drawn,
    a.Lost,
    a.GoalsFor,
    a.GoalsAgainst,
    a.GoalDifference,
    a.Points,
    ROW_NUMBER() OVER (PARTITION BY a.IdZona ORDER BY a.Points DESC, a.GoalDifference DESC, a.GoalsFor DESC, e.NmEquipa) AS Position
FROM aggregated a
JOIN tblZonas z ON z.IdZona = a.IdZona
JOIN tblEquipas e ON e.IdEquipa = a.IdEquipa
WHERE e.Activa AND z.Activa
ORDER BY a.IdZona, a.Points DESC, a.GoalDifference DESC, a.GoalsFor DESC;
```

---

## 🔄 Phased Implementation Plan

---

## **PHASE 1: DATA PREPARATION & CSV GENERATION**
*Duration: 1-2 hours | Dependencies: None*

### Step 1.1: Create `tblZonas.csv`
```bash
cat > data/tblZonas.csv << 'EOF'
IdZona;NmZona;NmCurto;Ordem
1;ZONA-NORTE;Norte;1
2;ZONA-CENTRO;Centro;2
3;ZONA-SUL;Sul;3
EOF
```

### Step 1.2: Use `/tmp/tblEquipas.csv` (MANUAL - Critical)

CSV provided at `/tmp/tblEquipas.csv`. Format (semicolon-delimited):
```csv
IdEquipa;NmEquipa;NmCurto;IdZona;EmblemaUrl
1;Aud Conc. Sabrosa "C";Sabrosa C;1;
2;Ade Geração Talentos "A";Geração A;1;
3;Gd Vilar Perdizes;Vilar Perdizes;1;
4;Gd Boticas;Boticas;1;
5;Clube Desportivo Valpacinhos;Valpacinhos;1;
6;Ad Flaviense;Flaviense;1;
7;Gd Chaves;Chaves;1;
8;Juv. Pedras Salgadas Adrc;Pedras Salgadas;1;
9;Vidago Fc;Vidago;1;
10;[Centro teams...];;;2;
...
```

> **Action:** Copy `/tmp/tblEquipas.csv` to `data/tblEquipas.csv` for extractor scripts.

### Step 1.3: Generate `tblCalendario.csv`
```bash
cd data/jornadas
python extrair_jogos_html.py . -o ../tblCalendario.csv --season-start 2026
```
- Input: `data/jornadas/` (18 HTML files)
- Output: `data/tblCalendario.csv` (semicolon-delimited, UTF-8-BOM)
- Fields: `Jornada;Data;EquipaCasa;EquipaFora;ResultadoCasa;ResultadoFora;Estadio;Hora;IdZona`

### Step 1.4: Generate `tblEstadios.csv`
```bash
cd data/jornadas
python extrair_estadios_html.py . --equipas ../tblEquipas.csv -o ../tblEstadios.csv --season-start 2026
```
- Requires `tblEquipas.csv` from Step 1.2
- Output: `data/tblEstadios.csv` with `IdEstadio;NmEstadio;IdEquipa`

### Step 1.5: Verify CSVs
```bash
head -5 data/tblCalendario.csv
head -5 data/tblEstadios.csv
# Verify all EquipaCasa/EquipaFora exist in tblEquipas.csv
# Verify all IdZona values exist in tblZonas.csv
```

---

## **PHASE 2: SUPABASE SETUP**
*Duration: 30-60 min | Dependencies: Phase 1 complete*

### Step 2.1: Create Tables in Supabase Dashboard
Run SQL statements in Supabase SQL Editor (see table definitions above).

### Step 2.2: Enable RLS (Row Level Security)
```sql
ALTER TABLE tblZonas ENABLE ROW LEVEL SECURITY;
ALTER TABLE tblEquipas ENABLE ROW LEVEL SECURITY;
ALTER TABLE tblEstadios ENABLE ROW LEVEL SECURITY;
ALTER TABLE tblCalendario ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read access" ON tblZonas FOR SELECT USING (true);
CREATE POLICY "Public read access" ON tblEquipas FOR SELECT USING (true);
CREATE POLICY "Public read access" ON tblEstadios FOR SELECT USING (true);
CREATE POLICY "Public read access" ON tblCalendario FOR SELECT USING (true);
```

### Step 2.3: Import CSV Data
Use Supabase Dashboard → Table Editor → Import CSV for each table:
1. `tblZonas.csv` → `tblZonas`
2. `tblEquipas.csv` → `tblEquipas`
3. `tblEstadios.csv` → `tblEstadios`
4. `tblCalendario.csv` → `tblCalendario` (map team names to `IdEquipa` during import)

> **Important:** For `tblCalendario`, pre-map team names to IDs in CSV, or import to staging table → SQL INSERT with JOIN → drop staging.

### Step 2.4: Create Helper View `vw_standings`
Run the view SQL from the table design section.

---

## **PHASE 3: INDEX.HTML REWRITE**
*Duration: 2-3 hours | Dependencies: Phase 2 complete*

### Step 3.1: Remove Embedded Data & JSON Fetch Logic
**Delete from `index.html`:**
- Lines 33-34: `window.__ZONANORTE_DATA__ = /* EMBEDDED_DATA_START */ ... /* EMBEDDED_DATA_END */;`
- Lines 74-87: `loadChampionshipData()` function
- Line 42: `let championshipData=window.__ZONANORTE_DATA__;`
- Lines 51-72: `applyChampionshipData()` function
- Line 85: `render()` call in `loadChampionshipData()`
- Line 292: `loadChampionshipData();` call at bottom

### Step 3.2: Add Supabase Data Loading Functions (with Zone Selector)

```javascript
// Global state for selected zone
let selectedZoneId = 2; // Default: ZONA-NORTE

async function loadChampionshipData() {
    try {
        // 1. Load zones for selector
        const { data: zonas, error: zonasError } = await supabaseClient
            .from('tblZonas')
            .select('IdZona, NmZona, NmCurto')
            .eq('Activa', true)
            .order('Ordem');
        
        if (zonasError) throw zonasError;
        renderZoneSelector(zonas);

        // 2. Load matches for selected zone
        const { data: matches, error: matchesError } = await supabaseClient
            .from('tblCalendario')
            .select(`
                IdJogo, Jornada, Data, Hora, ResultadoCasa, ResultadoFora, IdEstadio,
                EquipaCasa:tblEquipas!IdEquipaCasa (NmEquipa, NmCurto),
                EquipaFora:tblEquipas!IdEquipaFora (NmEquipa, NmCurto),
                Estadio:tblEstadios (NmEstadio)
            `)
            .eq('IdZona', selectedZoneId)
            .order('Jornada', { ascending: true })
            .order('Data', { ascending: true });
        
        if (matchesError) throw matchesError;

        // 3. Load standings from view for selected zone
        const { data: standings, error: standingsError } = await supabaseClient
            .from('vw_standings')
            .select('*')
            .eq('IdZona', selectedZoneId)
            .order('Position');
        
        if (standingsError) throw standingsError;

        // Transform matches to existing format
        const transformedMatches = matches.map(m => ({
            round: m.Jornada,
            home: m.EquipaCasa.NmEquipa,
            hg: m.ResultadoCasa,
            away: m.EquipaFora.NmEquipa,
            ag: m.ResultadoFora,
            date: m.Data,
            time: m.Hora,
            stadium: m.Estadio?.NmEstadio,
            matchId: m.IdJogo
        }));

        // Transform standings to existing format
        const transformedTeams = standings.map(s => ({
            name: s.NmEquipa,
            position: s.Position,
            played: s.Played,
            won: s.Won,
            drawn: s.Drawn,
            lost: s.Lost,
            goalsFor: s.GoalsFor,
            goalsAgainst: s.GoalsAgainst,
            goalDifference: s.GoalDifference,
            points: s.Points
        }));

        applyChampionshipData({ teams: transformedTeams, matches: transformedMatches });
        render();
        renderPlayerOptions();
        
    } catch (error) {
        console.error('Erro ao carregar dados do campeonato:', error);
        document.querySelector('#standings').innerHTML = 
            '<tr><td colspan="10" class="empty">Erro ao carregar classificação</td></tr>';
        document.querySelector('#results').innerHTML = 
            '<p class="round-empty">Erro ao carregar resultados</p>';
    }
}

function renderZoneSelector(zonas) {
    const selector = document.getElementById('zone-selector');
    if (!selector) return;
    selector.innerHTML = zonas.map(z => 
        `<option value="${z.IdZona}" ${z.IdZona === selectedZoneId ? 'selected' : ''}>${z.NmZona}</option>`
    ).join('');
    selector.onchange = async (e) => {
        selectedZoneId = parseInt(e.target.value, 10);
        await loadChampionshipData();
    };
}
```

### Step 3.3: Update `render()` Function & Add Zone Selector to HTML

**HTML Changes (in `index.html`):**
- Add zone selector dropdown in the "Classificação" section header:
```html
<section class="section">
  <h2>Classificação · <span id="zone-name">Zona Norte</span></h2>
  <div class="results-toolbar" style="margin-bottom:10px;">
    <label for="zone-selector">Zona</label>
    <select id="zone-selector" aria-label="Selecionar zona"></select>
  </div>
  <div class="card table-scroll">...
```

**JavaScript Updates:**
- `teams` array comes from `standings` (already sorted by position)
- `matches` array comes from `loadMatches()` filtered by `selectedZoneId`
- Remove `championshipData.standards` reference
- Update round filter to use `matches.map(m => m.round)`
- Update zone name display: `document.getElementById('zone-name').textContent = zonas.find(z => z.IdZona === selectedZoneId)?.NmCurto || ''`
- Valpacinhos match filter: `matches.filter(m => m.home.includes('Valpacinhos') || m.away.includes('Valpacinhos'))`

### Step 3.4: Update Goal Entry Match Dropdown
```javascript
const select = document.querySelector("#match");
select.innerHTML = matches
    .filter(m => m.home.toLowerCase().includes("valpacinhos") || m.away.toLowerCase().includes("valpacinhos"))
    .map((m, i) => `<option value="${m.matchId}">Jornada ${m.round} · ${m.home} ${m.hg ?? '?'}–${m.ag ?? '?'} ${m.away}</option>`)
    .join("");
```
> **Note:** `match_key` in `goal_entries` should now store `tblCalendario.IdJogo` (integer) instead of array index.

---

## **PHASE 4: CLEANUP OBSOLETE FILES**
*Duration: 15 min | Dependencies: Phase 3 complete & tested*

### Step 4.1: Delete Obsolete Files
```bash
# Core fetcher & updater files
rm fetch-zonanorte-data.js
rm update-zonanorte-index.js
rm keep-data-updated.py

# Index JSON files
rm zonanorte-championship-index.json
rm data/zonanorte-championship-index.json
rm data/zonanorte-cache.json

# Logs & backups
rm data/update.log
rm data/updater.log
rm -rf backups/

# GitHub Actions workflow
rm .github/workflows/atualizar-fpf.yml

# Node dependencies
rm package.json
rm package-lock.json
rm -rf node_modules/
```

### Step 4.2: Update `.gitignore`
```gitignore
# Remove Node-related entries
# Keep Python cache
__pycache__/
*.pyc

# Keep data/jornadas HTML files (they're source data now)
# data/jornadas/*.html
```

### Step 4.3: Update `requirements.txt`
```txt
# Python dependencies for ZONA-NORTE Championship Data Extractors
requests>=2.28.0
beautifulsoup4>=4.11.0
# supabase>=2.0.0  # Optional: if you want Python scripts to write to Supabase directly
```

---

## **PHASE 5: DOCUMENTATION & VALIDATION**
*Duration: 30-60 min*

### Step 5.1: Update `CLAUDE.md`
- Document new architecture (manual HTML → Python → Supabase → HTML)
- List new commands:
  ```bash
  # Generate calendário CSV
  cd data/jornadas && python extrair_jogos_html.py . -o ../tblCalendario.csv --season-start 2026
  
  # Generate estádios CSV
  cd data/jornadas && python extrair_estadios_html.py . --equipas ../tblEquipas.csv -o ../tblEstadios.csv --season-start 2026
  
  # Serve locally
  python3 -m http.server 8000
  ```
- Document Supabase table schemas
- Document manual workflow for new jornadas

### Step 5.2: Update `README-zonanorte.md` or Create New
- Architecture overview
- Manual update process
- Supabase schema reference
- Troubleshooting

### Step 5.3: Test Complete Flow
1. Open `index.html` via HTTP server (`python3 -m http.server 8000`)
2. Verify:
   - Standings table loads from `vw_standings`
   - Matches load per jornada
   - Round filter works
   - Valpacinhos matches appear in scorer dropdown
   - Manager panel still works (players, goal_entries)
3. Test adding a new Jornada HTML → regenerate CSV → re-import → verify

---

## 🎯 Suggested Improvements

### 1. **Automate CSV → Supabase Import (GitHub Action for tblCalendario)**
Create `.github/workflows/update-calendario.yml`:
```yaml
name: Update tblCalendario

on:
  workflow_dispatch:  # Manual trigger only

jobs:
  update-calendario:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.11'
      
      - name: Install dependencies
        run: pip install -r requirements.txt supabase
      
      - name: Generate tblCalendario.csv
        run: cd data/jornadas && python extrair_jogos_html.py . -o ../tblCalendario.csv --season-start 2026
      
      - name: Import to Supabase
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}
        run: |
          python -c "
import os, csv
from supabase import create_client
client = create_client(os.getenv('SUPABASE_URL'), os.getenv('SUPABASE_SERVICE_KEY'))
with open('data/tblCalendario.csv', 'r', encoding='utf-8-sig') as f:
    reader = csv.DictReader(f, delimiter=';')
    rows = list(reader)
# Map team names to IdEquipa (requires tblEquipas lookup)
# Upsert to tblCalendario
print(f'Imported {len(rows)} matches')
"
```
> Trigger manually via GitHub Actions UI when new Jornada HTML files are added.

### 2. **Add `tblEquipas` Management UI**
Extend manager panel to edit team names, colors, logos — writes to `tblEquipas`.

### 3. **Historical Seasons Support**
Add `SeasonId` to all tables; index.html dropdown to select season.

### 4. **Match Detail Page**
Click match → detail view with lineups, events, stadium map.

### 5. **Data Validation Script**
```python
# validate_data.py
# - Check all matches have valid team IDs
# - Check no duplicate (Jornada, IdEquipaCasa, IdEquipaFora)
# - Check standings view matches manual calculation
# - Report missing results (null scores)
```

### 6. **Cache Busting for Supabase**
Add `?v=<timestamp>` to Supabase queries or use ETags.

---

## 📅 Estimated Timeline

| Phase | Duration | Risk |
|-------|----------|------|
| Phase 1: CSV Generation | 1-2 hrs | Low (scripts exist) |
| Phase 2: Supabase Setup | 30-60 min | Medium (RLS, imports) |
| Phase 3: index.html Rewrite | 2-3 hrs | **High** (JS logic changes) |
| Phase 4: Cleanup | 15 min | Low |
| Phase 5: Docs & Validation | 30-60 min | Low |
| **Total** | **4-6 hrs** | |

---

## ✅ Confirmed Decisions

1. **`tblEquipas.csv` location**: Use `/tmp/tblEquipas.csv` (provided manually)
2. **Supabase Import Method**: Dashboard CSV import for initial setup; GitHub Action (manual trigger) for `tblCalendario` updates
3. **Zone Selector**: Add zone selector for all 3 zones (ZONA-NORTE, ZONA-CENTRO, ZONA-SUL)
4. **Match Key Mapping**: Yes — use `tblCalendario.IdJogo`; no existing goal entries to migrate
5. **Team Colors**: No — remove `CorPrimaria`/`CorSecundaria` from `tblEquipas` schema

---

## 📁 Current Asset Inventory

```
data/jornadas/
├── Jornada_1.html      (124 KB)
├── Jornada_2.html      (124 KB)
├── Jornada_3.html      (124 KB)
├── Jornada_4.html      (123 KB)
├── Jornada_5.html      (123 KB)
├── Jornada_6.html      (123 KB)
├── Jornada_7.html      (123 KB)
├── Jornada_8.html      (123 KB)
├── Jornada_9.html      (123 KB)
├── Jornada_10.html     (123 KB)
├── Jornada_11.html     (123 KB)
├── Jornada_12.html     (123 KB)
├── Jornada_13.html     (123 KB)
├── Jornada_14.html     (123 KB)
├── Jornada_15.html     (123 KB)
├── Jornada_16.html     (123 KB)
├── Jornada_17.html     (123 KB)
├── Jornada_18.html     (123 KB)
├── extrair_jogos_html.py      (9.2 KB)  ✅ Ready
├── extrair_estadios_html.py   (5.7 KB)  ✅ Ready
└── ReadMe.txt                  (236 B)
```

Each HTML file contains **all 3 zones** (ZONA-NORTE, ZONA-CENTRO, ZONA-SUL) with `game-results` divs. The extractors already handle multi-zone parsing via `IdZona` field.

---

## ✅ Next Steps

1. **Confirm approach** for the 5 decision points above
2. **Run Phase 1** — Generate CSVs (need `tblEquipas.csv` first)
3. **Run Phase 2** — Supabase setup
4. **Run Phase 3** — Rewrite `index.html`
5. **Run Phase 4** — Cleanup
6. **Run Phase 5** — Documentation & validation

Ready to proceed when you confirm the decision points.