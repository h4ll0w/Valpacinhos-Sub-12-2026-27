// ZONA-NORTE Data Fetcher
// Attempts to fetch championship data from FPF website
// Falls back to cached/local data if website access fails

class ZONA_NORTE_Data_Fetcher {
    constructor() {
        this.baseUrl = 'https://resultados.fpf.pt/Competition/Details?competitionId=30614&seasonId=106';
        this.competitionId = '30614';
        this.seasonId = '106';
        this.zona = 'ZONA-NORTE';
        this.cacheKey = 'zonanorte_championship_data';
        this.cacheExpiry = 3600000; // 1 hour in milliseconds
    }

    async fetchFromWebsite() {
        try {
            // Try with different headers and options to bypass potential blocking
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 15000);
            const response = await fetch(this.baseUrl, {
                method: 'GET',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'pt-PT,pt;q=0.9,en;q=0.8',
                    'Accept-Encoding': 'gzip, deflate, br',
                    'Connection': 'keep-alive',
                    'Upgrade-Insecure-Requests': '1',
                    'Sec-Fetch-Dest': 'document',
                    'Sec-Fetch-Mode': 'navigate',
                    'Sec-Fetch-Site': 'none',
                    'Sec-Fetch-User': '?1',
                    'Cache-Control': 'max-age=0',
                },
                redirect: 'follow',
                signal: controller.signal,
            });

            clearTimeout(timer);

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const html = await response.text();
            return await this.parseHTMLForZONA(html);

        } catch (error) {
            console.warn('Failed to fetch from website:', error.message);
            return await this.fetchFromBrowser();
        }
    }

    async fetchFromBrowser() {
        let chromium;
        try {
            ({ chromium } = require('playwright'));
        } catch (error) {
            console.warn('Browser fallback unavailable. Install it with: npm install');
            return null;
        }
        let browser;
        try {
            browser = await chromium.launch({ headless: true });
            const page = await browser.newPage({ locale: 'pt-PT', userAgent: 'Mozilla/5.0 Chrome/131 Safari/537.36' });
            await page.goto(this.baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
            const html = await page.content();
            const data = await this.parseHTMLForZONA(html, async url => {
                await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
                return await page.content();
            });
            data.source = 'fpf_browser';
            return data;
        } catch (error) {
            console.warn('Browser fetch failed:', error.message);
            return null;
        } finally {
            if (browser) await browser.close();
        }
    }

    async parseHTMLForZONA(html, requestText = async url => (await fetch(url)).text()) {
        // The FPF page contains one block per series.  Keep only htmlSerieId_100601,
        // which is the ZONA-NORTE block for this competition.
        const zoneMatch = html.match(/<div[^>]+id=["']htmlSerieId_100601["'][\s\S]*?(?=<div[^>]+id=["']htmlSerieId_|<\/body>)/i);
        if (!zoneMatch) throw new Error('ZONA-NORTE series was not found in FPF page');
        const zoneHtml = zoneMatch[0];
        const fixtureIds = [...zoneHtml.matchAll(/GetClassificationAndMatchesByFixture\?fixtureId=(\d+)/gi)].map(m => m[1]);
        let teams = [];
        const matches = [];
        for (let i = 0; i < fixtureIds.length; i++) {
            try {
                const fixtureHtml = await requestText(`https://resultados.fpf.pt/Competition/GetClassificationAndMatchesByFixture?fixtureId=${fixtureIds[i]}`);
                if (!teams.length) teams = this.parseClassification(fixtureHtml);
                this.parseMatches(fixtureHtml).forEach(match => { match.jornada = i + 1; matches.push(match); });
            } catch (error) {
                console.warn(`Could not load fixture ${fixtureIds[i]}:`, error.message);
            }
        }
        if (!teams.length) throw new Error('No classification data was returned for ZONA-NORTE');
        return {
            source: 'fpf_website',
            competitionId: this.competitionId,
            seasonId: this.seasonId,
            zona: this.zona,
            lastUpdated: new Date().toISOString(),
            data: {
                teams,
                matches,
                topScorers: [],
                championship: {
                    name: "Campeonato Distrital Sub-12 (Futebol 9 - Zona Norte) • 2026/2027",
                    season: "2026/2027",
                    format: "Futebol 9",
                    ageGroup: "Sub-12",
                    zona: "ZONA-NORTE"
                }
            },
            fixtureIds
        };
    }

    stripTags(value) { return value.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&quot;/gi, '"').replace(/&#39;/g, "'").replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim(); }

    parseClassification(html) {
        const teams = [];
        const rows = html.match(/<div[^>]+class=["'][^"']*game classification[^"']*["'][^>]*>[\s\S]*?<\/div>\s*(?=<div[^>]+class=["'][^"']*game classification|<\/div>)/gi) || [];
        for (const row of rows) {
            const cells = [...row.matchAll(/<div[^>]*>([\s\S]*?)<\/div>/gi)].map(m => this.stripTags(m[1])).filter(Boolean);
            if (cells.length < 9 || !/^\d+$/.test(cells[0])) continue;
            const n = cells.slice(0, 9).map(Number);
            teams.push({ name: cells[1], position: n[0], played: n[2], won: n[3], drawn: n[4], lost: n[5], goalsFor: n[6], goalsAgainst: n[7], goalDifference: n[6] - n[7], points: n[8] });
        }
        if (!teams.length) throw new Error('No classification rows found for ZONA-NORTE');
        return teams;
    }

    parseMatches(html) {
        const matches = [];
        const rows = html.match(/<a[^>]+class=["'][^"']*game-link[^"']*["'][\s\S]*?<\/a>/gi) || [];
        for (const row of rows) {
            const home = this.stripTags((row.match(/class=["'][^"']*home-team[^"']*["'][^>]*>([\s\S]*?)<\/div>/i) || [])[1] || '');
            const away = this.stripTags((row.match(/class=["'][^"']*away-team[^"']*["'][^>]*>([\s\S]*?)<\/div>/i) || [])[1] || '');
            const score = this.stripTags((row.match(/class=["'][^"']*score[^"']*["'][^>]*>[\s\S]*?<span[^>]*>\s*([^<]+?)\s*<\/span>/i) || [])[1] || '');
            const scoreMatch = score.match(/(\d+)\s*[-–]\s*(\d+)/);
            if (!home || !away || !scoreMatch) continue; // scheduled matches have no result yet
            const dateText = this.stripTags((row.match(/class=["'][^"']*game-schedule[^"']*["'][^>]*>([\s\S]*?)<\/span>/i) || [])[1] || '');
            matches.push({ jornada: null, home, homeGoals: Number(scoreMatch[1]), away, awayGoals: Number(scoreMatch[2]), date: this.parseFpfDate(dateText) });
        }
        return matches;
    }

    parseFpfDate(text) {
        const months = { jan: 0, fev: 1, mar: 2, abr: 3, mai: 4, jun: 5, jul: 6, ago: 7, set: 8, out: 9, nov: 10, dez: 11 };
        const match = text.toLowerCase().match(/(\d{1,2})\s+([a-zç]+)/);
        if (!match || months[match[2]] === undefined) return null;
        const year = months[match[2]] >= 7 ? 2026 : 2027;
        return new Date(Date.UTC(year, months[match[2]], Number(match[1]))).toISOString().slice(0, 10);
    }

    async getData() {
        // Try to fetch from website first
        let data = await this.fetchFromWebsite();

        // If that fails, try to get cached data
        if (!data) {
            data = this.getCachedData();
        }

        // If still no data, use fallback data
        if (!data) {
            data = this.getFallbackData();
            console.log('Using fallback ZONA-NORTE data');
        }

        return data;
    }

    getCachedData() {
        if (typeof localStorage === 'undefined') return null;
        try {
            const cached = localStorage.getItem(this.cacheKey);
            if (cached) {
                const parsed = JSON.parse(cached);
                const age = Date.now() - parsed.timestamp;

                if (age < this.cacheExpiry) {
                    console.log('Using cached ZONA-NORTE data');
                    return parsed.data;
                } else {
                    console.log('Cached data expired');
                }
            }
        } catch (error) {
            console.warn('Error reading cached data:', error.message);
        }
        return null;
    }

    setCachedData(data) {
        if (typeof localStorage === 'undefined') return;
        try {
            const cacheEntry = {
                data: data,
                timestamp: Date.now()
            };
            localStorage.setItem(this.cacheKey, JSON.stringify(cacheEntry));
            console.log('ZONA-NORTE data cached');
        } catch (error) {
            console.warn('Error caching data:', error.message);
        }
    }

    getFallbackData() {
        // Fallback data extracted from current index.html
        return {
            source: 'fallback_index_html',
            competitionId: this.competitionId,
            seasonId: this.seasonId,
            zona: this.zona,
            lastUpdated: new Date().toISOString(),
            data: {
                teams: [
                    { name: "VALPACINHOS", p: 6, j: 2, v: 2, e: 0, d: 0, gm: 4, gs: 2, dg: 2 },
                    { name: "AUDC SABROSA \"C\"", p: 6, j: 2, v: 2, e: 0, d: 0, gm: 10, gs: 2, dg: 8 },
                    { name: "J. PEDRAS SALGADAS", p: 3, j: 1, v: 1, e: 0, d: 0, gm: 1, gs: 3, dg: -2 },
                    { name: "GD BOTICAS", p: 0, j: 0, v: 0, e: 0, d: 0, gm: 0, gs: 0, dg: 0 },
                    { name: "ADE GERAÇÃO TALENTOS \"A\"", p: 0, j: 0, v: 0, e: 0, d: 0, gm: 0, gs: 0, dg: 0 },
                    { name: "VIDAGO FC", p: 0, j: 0, v: 0, e: 0, d: 0, gm: 0, gs: 0, dg: 0 },
                    { name: "AD FLAVIENSE", p: 0, j: 0, v: 0, e: 0, d: 0, gm: 0, gs: 0, dg: 0 },
                    { name: "GD CHAVES", p: 0, j: 0, v: 0, e: 0, d: 0, gm: 0, gs: 0, dg: 0 },
                    { name: "GD VILAR PERDIZES", p: 0, j: 0, v: 0, e: 0, d: 0, gm: 0, gs: 0, dg: 0 }
                ],
                matches: [
                    { jornada: 1, casa: "VALPACINHOS", goloCasa: 3, fora: "J. PEDRAS SALGADAS", goloFora: 1 },
                    { jornada: 2, casa: "AUDC SABROSA \"C\"", goloCasa: 9, fora: "VALPACINHOS", goloFora: 1 }
                ],
                topScorers: [
                    { nome: "Pepe", equipa: "VALPACINHOS", golos: 1 },
                    { nome: "Luis", equipa: "VALPACINHOS", golos: 1 },
                    { nome: "Fábio", equipa: "VALPACINHOS", golos: 1 }
                ],
                championship: {
                    name: "Campeonato Distrital Sub-12 (Futebol 9 - Zona Norte) • 2026/2027",
                    season: "2026/2027",
                    format: "Futebol 9",
                    ageGroup: "Sub-12",
                    zona: "ZONA-NORTE"
                }
            }
        };
    }

    async updateIndexFile() {
        // Get fresh data and update the index file
        const data = await this.getData();
        this.setCachedData(data);

        // Convert to structured index format
        const indexData = this.formatForIndex(data);

        // Save to local file
        await this.saveToFile(indexData);

        return indexData;
    }

    formatForIndex(data) {
        const teams = data.data.teams.map(team => ({
            name: team.name,
            position: team.position ?? this.calculatePosition(team),
            played: team.played ?? team.j ?? 0,
            won: team.won ?? team.v ?? 0,
            drawn: team.drawn ?? team.e ?? 0,
            lost: team.lost ?? team.d ?? 0,
            goalsFor: team.goalsFor ?? team.gm ?? 0,
            goalsAgainst: team.goalsAgainst ?? team.gs ?? 0,
            goalDifference: team.goalDifference ?? team.dg ?? 0,
            points: team.points ?? team.p ?? 0
        }));

        const matches = data.data.matches.map(match => ({
            jornada: match.jornada,
            homeTeam: match.home || match.casa,
            homeGoals: match.homeGoals ?? match.goloCasa,
            awayTeam: match.away || match.fora,
            awayGoals: match.awayGoals ?? match.goloFora,
            date: match.date || new Date().toLocaleDateString('pt-PT')
        }));

        const topScorers = data.data.topScorers.map(scorer => ({
            name: scorer.name || scorer.nome,
            team: scorer.team || scorer.equipa,
            goals: scorer.goals ?? scorer.golos
        }));

        return {
            metadata: {
                source: data.source,
                competitionId: data.competitionId,
                seasonId: data.seasonId,
                zona: data.zona,
                lastUpdated: data.lastUpdated,
                generatedAt: new Date().toISOString(),
                championship: data.data.championship
            },
            teams: teams,
            matches: matches,
            topScorers: topScorers,
            standings: this.calculateStandings(teams, matches),
            zonaInfo: {
                totalTeams: teams.length,
                zonaName: this.zona,
                season: data.data.championship.season,
                format: data.data.championship.format,
                ageGroup: data.data.championship.ageGroup
            }
        };
    }

    calculatePosition(team) {
        // Calculate position based on points, goal difference, goals scored
        const sortedTeams = [...this.getFallbackData().data.teams].sort((a, b) => {
            if (b.points !== a.points) return b.points - a.points;
            if (b.goalDifference !== a.goalDifference) return b.goalDifference - a.goalDifference;
            return b.goalsFor - a.goalsFor;
        });

        return sortedTeams.findIndex(t => t.name === team.name) + 1;
    }

    calculateStandings(teams, matches) {
        // Calculate standings based on matches
        const standings = {};

        // Initialize standings for each team
        teams.forEach(team => {
            standings[team.name] = {
                team: team.name,
                played: 0,
                won: 0,
                drawn: 0,
                lost: 0,
                goalsFor: 0,
                goalsAgainst: 0,
                goalDifference: 0,
                points: 0
            };
        });

        // Process matches
        matches.forEach(match => {
            const homeTeam = standings[match.homeTeam];
            const awayTeam = standings[match.awayTeam];

            if (!homeTeam || !awayTeam) return;

            homeTeam.played++;
            awayTeam.played++;

            homeTeam.goalsFor += match.homeGoals;
            homeTeam.goalsAgainst += match.awayGoals;
            homeTeam.goalDifference += match.homeGoals - match.awayGoals;

            awayTeam.goalsFor += match.awayGoals;
            awayTeam.goalsAgainst += match.homeGoals;
            awayTeam.goalDifference += match.awayGoals - match.homeGoals;

            if (match.homeGoals > match.awayGoals) {
                homeTeam.won++;
                homeTeam.points += 3;
                awayTeam.lost++;
            } else if (match.homeGoals < match.awayGoals) {
                awayTeam.won++;
                awayTeam.points += 3;
                homeTeam.lost++;
            } else {
                homeTeam.drawn++;
                homeTeam.points += 1;
                awayTeam.drawn++;
                awayTeam.points += 1;
            }
        });

        // Convert to array and sort
        const standingsArray = Object.values(standings);
        standingsArray.sort((a, b) => {
            if (b.points !== a.points) return b.points - a.points;
            if (b.goalDifference !== a.goalDifference) return b.goalDifference - a.goalDifference;
            return b.goalsFor - a.goalsFor;
        });

        // Add positions
        standingsArray.forEach((team, index) => {
            team.position = index + 1;
        });

        return standingsArray;
    }

    async saveToFile(data) {
        // Save data to local storage and create a downloadable file
        const jsonStr = JSON.stringify(data, null, 2);

        // Save to localStorage
        if (typeof localStorage !== 'undefined') localStorage.setItem('zonanorte_index_data', jsonStr);

        // Node runs the scheduled updater and has no Blob or object URLs.
        if (typeof Blob === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
            return { filename: 'zonanorte-championship-index.json', dataSize: jsonStr.length, timestamp: new Date().toISOString(), data };
        }

        // Create download link
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        return {
            downloadUrl: url,
            filename: 'zonanorte-championship-index.json',
            dataSize: jsonStr.length,
            timestamp: new Date().toISOString()
        };
    }

    async triggerAutoUpdate() {
        console.log('Triggering automatic ZONA-NORTE data update...');
        try {
            const result = await this.updateIndexFile();
            console.log('ZONA-NORTE data update completed:', result);
            return result;
        } catch (error) {
            console.error('ZONA-NORTE data update failed:', error);
            throw error;
        }
    }
}

// Initialize and export
const zonanorteFetcher = new ZONA_NORTE_Data_Fetcher();

// Auto-update on module load
if (typeof window !== 'undefined') {
    zonanorteFetcher.triggerAutoUpdate().catch(console.error);
}

module.exports = {
    ZONA_NORTE_Data_Fetcher,
    zonanorteFetcher
};
