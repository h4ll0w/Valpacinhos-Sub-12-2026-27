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
            const timer = setTimeout(() => controller.abort(), 5000);
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
            this.logHtmlDiagnostics('competition', html, response.status, response.headers.get('content-type'));
            return await this.parseHTMLForZONA(html);

        } catch (error) {
            console.warn('Failed to fetch from website:', error.message);
            // Small backoff to avoid 429 rate-limit loops
            await new Promise(r => setTimeout(r, 2000));
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
            const networkBodies = new Map();
            const networkTasks = [];
            page.on('response', response => {
                if (!this.isFixtureEndpoint(response.url())) return;
                const task = response.text().then(body => {
                    networkBodies.set(response.url(), body);
                    const fixtureId = response.url().match(/fixtureId=(\d+)/i)?.[1];
                    if (fixtureId) networkBodies.set(`fixture:${fixtureId}`, body);
                    this.logHtmlDiagnostics(`fixture-network:${response.url().split('fixtureId=')[1] || 'unknown'}`, body, response.status(), response.headers()['content-type']);
                }).catch(error => {
                    console.warn(`[FPF diagnostic] não foi possível ler resposta de rede ${response.url()}:`, error.message);
                });
                networkTasks.push(task);
            });
            await page.goto(this.baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await this.waitForChallenge(page);
            const html = await page.content();
            this.logHtmlDiagnostics('competition-browser', html, 200, 'text/html');
            const domData = await page.evaluate(() => {
                const zone = document.querySelector('#htmlSerieId_100601');
                if (!zone) return null;
                const links = [...zone.querySelectorAll('a,button')].map(element => {
                    const source = element.getAttribute('href') || element.getAttribute('onclick') || '';
                    const fixtureId = source.match(/fixtureId\s*[=:]\s*["']?(\d+)/i)?.[1] || null;
                    const label = (element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim();
                    const roundMatch = label.match(/(?:jornada|jorn\.?)[\s:#-]*(\d{1,2})/i) || label.match(/^\s*(\d{1,2})\s*$/);
                    const container = element.closest('li,.fixture,.round,.jornada,div');
                    const context = `${element.className || ''} ${container?.className || ''} ${element.getAttribute('aria-current') || ''} ${container?.getAttribute('aria-current') || ''}`;
                    return {
                        fixtureId,
                        jornada: roundMatch ? Number(roundMatch[1]) : null,
                        label,
                        selected: /(?:\bactive\b|\bselected\b|\bcurrent\b|page|true)/i.test(context),
                        played: /\bpast\b|\bcurrent\b/i.test(context)
                    };
                }).filter(link => link.fixtureId);
                return { zoneHtml: zone.outerHTML, fixtureLinks: links };
            });
            if (domData) console.log(`[FPF diagnostic] DOM ZONA-NORTE encontrado: ${domData.fixtureLinks.length} links de jornadas`);
            const data = await this.parseHTMLForZONA(html, async url => {
                const fixtureId = url.match(/fixtureId=(\d+)/i)?.[1];
                const cached = networkBodies.get(url) || (fixtureId && networkBodies.get(`fixture:${fixtureId}`));
                if (cached) return this.unwrapNetworkPayload(cached);

                // Fetch inside the FPF page so the browser session's cookies,
                // origin and Cloudflare state are reused. The response event
                // above records the raw backend payload as well.
                for (let attempt = 1; attempt <= 4; attempt++) {
                    const result = await page.evaluate(async endpoint => {
                        const separator = endpoint.includes('?') ? '&' : '?';
                        const requestUrl = `${endpoint}${separator}X-Requested-With=XMLHttpRequest&_=${Date.now()}`;
                        const response = await fetch(requestUrl, {
                            credentials: 'include',
                            headers: {
                                Accept: 'text/html, */*; q=0.01',
                                'X-Requested-With': 'XMLHttpRequest'
                            }
                        });
                        return { status: response.status, body: await response.text() };
                    }, url);
                    if (result.status === 200) {
                        await Promise.allSettled(networkTasks);
                        // Keep the request rate below the FPF/Cloudflare
                        // threshold when collecting consecutive jornadas.
                        await new Promise(resolve => setTimeout(resolve, 800));
                        return this.unwrapNetworkPayload(result.body);
                    }
                    if (result.status !== 429) throw new Error(`HTTP ${result.status}`);
                    const delay = attempt * 1500;
                    console.warn(`[FPF diagnostic] HTTP 429 em ${url}; nova tentativa em ${delay} ms`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
                throw new Error('HTTP 429 após 4 tentativas');
            }, domData);
            data.source = 'fpf_browser';
            return data;
        } catch (error) {
            console.warn('Browser fetch failed:', error.message);
            return null;
        } finally {
            if (browser) await browser.close();
        }
    }

    async waitForChallenge(page) {
        try {
            await page.waitForFunction(() => {
                const title = document.title || '';
                const body = document.body?.innerText || '';
                return !/just a moment|enable javascript and cookies/i.test(`${title} ${body}`);
            }, null, { timeout: 15000 });
        } catch (error) {
            // Keep the response for diagnostics; parseHTMLForZONA will report
            // a useful error if Cloudflare never releases the page.
        }
    }

    isFixtureEndpoint(url) {
        return /\/Competition\/GetClassificationAndMatchesByFixture\?fixtureId=\d+/i.test(url);
    }

    unwrapNetworkPayload(body) {
        const source = String(body || '');
        try {
            const payload = JSON.parse(source);
            const candidates = [];
            const collect = value => {
                if (typeof value === 'string') {
                    if (/<(?:div|table|tr|a)\b/i.test(value)) candidates.push(value);
                    return;
                }
                if (Array.isArray(value)) return value.forEach(collect);
                if (value && typeof value === 'object') Object.values(value).forEach(collect);
            };
            collect(payload);
            if (candidates.length) return candidates.sort((a, b) => b.length - a.length)[0];
        } catch (error) {
            // The FPF endpoint commonly returns an HTML fragment, not JSON.
        }
        return source;
    }

    extractJornada(html, fallback = null) {
        const text = this.extractTextLines(html).join(' ');
        const match = text.match(/\b(?:jornada|jorn\.?)[\s:#-]*(\d{1,2})\b/i);
        return match ? Number(match[1]) : fallback;
    }

    extractFixtureLinks(html) {
        const links = [];
        const elementPattern = /<(a|button)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
        for (const match of html.matchAll(elementPattern)) {
            const attributes = match[2];
            const body = match[3];
            if (!/GetClassificationAndMatchesByFixture|fixtureId\s*[=:]/i.test(attributes)) continue;
            const fixtureId = attributes.match(/fixtureId\s*[=:]\s*["']?(\d+)/i)?.[1];
            if (!fixtureId) continue;

            const label = this.stripTags(body);
            const jornadaMatch = label.match(/(?:jornada|jorn\.?)[\s:#-]*(\d{1,2})/i) || label.match(/^\s*(\d{1,2})\s*$/);
            const context = html.slice(Math.max(0, match.index - 300), match.index + match[0].length + 100);
            links.push({
                fixtureId,
                jornada: jornadaMatch ? Number(jornadaMatch[1]) : null,
                label,
                selected: /(?:\bactive\b|\bselected\b|\bcurrent\b|aria-current\s*=\s*["'](?:page|true)["'])/i.test(context),
                played: /\bpast\b|\bcurrent\b/i.test(context)
            });
        }
        return links;
    }

    async parseHTMLForZONA(html, requestText = async url => {
        const response = await fetch(url);
        const body = await response.text();
        this.logHtmlDiagnostics(`fixture:${url.split('fixtureId=')[1] || 'unknown'}`, body, response.status, response.headers.get('content-type'));
        return body;
    }, domData = null) {
        // The FPF page contains one block per series.  Keep only htmlSerieId_100601,
        // which is the ZONA-NORTE block for this competition.
        const zoneMatch = html.match(/<div[^>]+id=["']htmlSerieId_100601["'][\s\S]*?(?=<div[^>]+id=["']htmlSerieId_|<\/body>)/i);
        const zoneHtml = domData?.zoneHtml || zoneMatch?.[0];
        if (!zoneHtml) throw new Error('ZONA-NORTE series was not found in FPF page');
        const fixtureLinks = domData?.fixtureLinks?.length ? domData.fixtureLinks : this.extractFixtureLinks(zoneHtml);
        const linksToFetch = fixtureLinks.some(link => link.played)
            ? fixtureLinks.filter(link => link.played || link.selected)
            : fixtureLinks;
        const fixtureIds = linksToFetch.length
            ? linksToFetch.map(link => link.fixtureId)
            : [...zoneHtml.matchAll(/GetClassificationAndMatchesByFixture\?fixtureId=(\d+)/gi)].map(m => m[1]);
        console.log(`[FPF diagnostic] jornadas encontradas nos links: ${JSON.stringify(fixtureLinks.map(link => ({ fixtureId: link.fixtureId, jornada: link.jornada, label: link.label })))}`);
        const selectedJornada = fixtureLinks.find(link => link.selected && link.jornada != null)?.jornada ?? null;
        console.log(`[FPF diagnostic] jornada selecionada na página: ${selectedJornada ?? 'não identificada'}`);
        let teams = [];
        const matches = [];

        // The competition page itself contains the current classification
        // and played games. Prefer it because Cloudflare may challenge the
        // individual fixture endpoints even when the competition page loads.
        try { teams = this.parseClassification(zoneHtml); } catch (error) {
            console.warn('Could not parse classification from competition page:', error.message);
        }
        try {
            const pageMatches = this.parseMatches(zoneHtml);
            // The competition page shows the selected jornada directly. Keep
            // that association when the individual fixture request is blocked.
            pageMatches.forEach(match => { match.jornada = selectedJornada; });
            matches.push(...pageMatches);
        } catch (error) {
            console.warn('Could not parse matches from competition page:', error.message);
        }

        for (let i = 0; i < fixtureIds.length; i++) {
            try {
                const fixtureUrl = `https://resultados.fpf.pt/Competition/GetClassificationAndMatchesByFixture?fixtureId=${fixtureIds[i]}`;
                const fixtureHtml = await requestText(fixtureUrl);
                if (!teams.length) teams = this.parseClassification(fixtureHtml);
                // The competition page labels each fixture link with the
                // jornada number. Prefer that explicit mapping. Only inspect
                // the response as a fallback; never use the array position.
                const jornada = linksToFetch[i]?.jornada ?? this.extractJornada(fixtureHtml);
                const fixtureMatches = this.parseMatches(fixtureHtml);
                console.log(`[FPF diagnostic] fixture=${fixtureIds[i]} jornada=${jornada ?? 'não identificada'} jogos=${fixtureMatches.length}`);
                fixtureMatches.forEach(match => { match.jornada = jornada; matches.push(match); });
            } catch (error) {
                console.warn(`Could not load fixture ${fixtureIds[i]}:`, error.message);
            }
        }
        if (!teams.length) throw new Error('No classification data was returned for ZONA-NORTE');
        const uniqueMatchMap = new Map();
        for (const match of matches) {
            const baseKey = `${match.home}|${match.homeGoals}|${match.away}|${match.awayGoals}|${match.date || ''}`;
            const existingKey = [...uniqueMatchMap.keys()].find(key => key === baseKey || key.startsWith(`${baseKey}|`));
            const key = existingKey && (uniqueMatchMap.get(existingKey).jornada == null || match.jornada == null || uniqueMatchMap.get(existingKey).jornada === match.jornada)
                ? existingKey
                : `${baseKey}|${match.jornada ?? 'unknown'}`;
            const previous = uniqueMatchMap.get(key);
            // Fixture responses carry the real jornada; prefer them over the
            // same match found on the competition page with jornada=null.
            if (!previous || (previous.jornada == null && match.jornada != null)) {
                uniqueMatchMap.set(key, match);
            }
        }
        const uniqueMatches = [...uniqueMatchMap.values()];
        return {
            source: 'fpf_website',
            competitionId: this.competitionId,
            seasonId: this.seasonId,
            zona: this.zona,
            lastUpdated: new Date().toISOString(),
            data: {
                teams,
                matches: uniqueMatches,
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

    logHtmlDiagnostics(label, html, status = 'n/a', contentType = 'unknown') {
        const source = String(html || '');
        const title = (source.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1];
        const markers = {
            zonaNorte: /ZONA[-\s]?NORTE/i.test(source),
            classificationHeaders: /\bPOS\b[\s\S]{0,300}\bPTS\b/i.test(source),
            tableRows: /<tr\b/i.test(source),
            legacyClassification: /game\s+classification/i.test(source),
            gameLinks: /game-link/i.test(source),
            accessDenied: /access denied|forbidden|captcha|cloudflare|robot/i.test(source)
        };
        const preview = this.extractTextLines(source).slice(0, 18).join(' | ').slice(0, 500);
        const bytes = typeof Buffer !== 'undefined' ? Buffer.byteLength(source, 'utf8') : new TextEncoder().encode(source).length;
        console.log(`[FPF diagnostic] ${label} status=${status} contentType=${contentType || 'unknown'} bytes=${bytes} title=${JSON.stringify(this.stripTags(title || ''))} markers=${JSON.stringify(markers)} preview=${JSON.stringify(preview)}`);
    }

    stripTags(value) {
        return value.replace(/<[^>]*>/g, ' ')
            .replace(/&nbsp;/gi, ' ')
            .replace(/&quot;/gi, '"')
            .replace(/&#39;/g, "'")
            .replace(/&amp;/gi, '&')
            .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
            .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
            .replace(/\s+/g, ' ')
            .trim();
    }

    extractTableRows(html) {
        return [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
            .map(match => [...match[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)]
                .map(cell => this.stripTags(cell[1]))
                .filter(Boolean))
            .filter(row => row.length > 0);
    }

    extractTextLines(html) {
        return html
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/\s*(div|p|li|tr|td|th|section|article|h[1-6])\s*>/gi, '\n')
            .replace(/<[^>]*>/g, ' ')
            .replace(/&nbsp;/gi, ' ')
            .replace(/&quot;/gi, '"')
            .replace(/&#39;/g, "'")
            .replace(/&amp;/gi, '&')
            .split(/\r?\n/)
            .map(line => line.replace(/\s+/g, ' ').trim())
            .filter(Boolean);
    }

    parseClassificationFromText(html) {
        const lines = this.extractTextLines(html);
        const header = lines.findIndex(line => /^POS$/i.test(line));
        if (header < 0) return [];
        const pointsHeader = lines.findIndex((line, index) => index > header && /^PTS$/i.test(line));
        if (pointsHeader < 0) return [];

        const teams = [];
        for (let i = pointsHeader + 1; i < lines.length;) {
            if (!/^\d+$/.test(lines[i])) break;
            const values = lines.slice(i + 2, i + 9);
            if (values.length < 7 || values.some(value => !/^\d+$/.test(value))) break;
            const numbers = [Number(lines[i]), ...values.map(Number)];
            teams.push({
                name: lines[i + 1],
                position: numbers[0],
                played: numbers[1],
                won: numbers[2],
                drawn: numbers[3],
                lost: numbers[4],
                goalsFor: numbers[5],
                goalsAgainst: numbers[6],
                goalDifference: numbers[5] - numbers[6],
                points: numbers[7]
            });
            i += 9;
        }
        return teams;
    }

    parseClassification(html) {
        const teams = [];
        const rows = html.match(/<div[^>]+class=["'][^"']*game classification[^"']*["'][^>]*>[\s\S]*?<\/div>\s*(?=<div[^>]+class=["'][^"']*game classification|<\/div>)/gi) || [];
        for (const row of rows) {
            const cells = [...row.matchAll(/<div[^>]*>([\s\S]*?)<\/div>/gi)].map(m => this.stripTags(m[1])).filter(Boolean);
            if (cells.length < 9 || !/^\d+$/.test(cells[0])) continue;
            const n = cells.slice(0, 9).map(Number);
            teams.push({ name: cells[1], position: n[0], played: n[2], won: n[3], drawn: n[4], lost: n[5], goalsFor: n[6], goalsAgainst: n[7], goalDifference: n[6] - n[7], points: n[8] });
        }

        // The FPF portal currently returns the classification as a regular
        // HTML table in some responses. Keep the legacy parser above, but
        // also accept rows such as: POS | team | JGS | V | E | D | GM | GS | PTS.
        if (!teams.length) {
            for (const cells of this.extractTableRows(html)) {
                if (cells.length < 9 || !/^\d+$/.test(cells[0])) continue;
                const numbers = cells.slice(0, 1).concat(cells.slice(2, 9)).map(Number);
                if (numbers.some(number => !Number.isFinite(number))) continue;
                teams.push({
                    name: cells[1],
                    position: numbers[0],
                    played: numbers[1],
                    won: numbers[2],
                    drawn: numbers[3],
                    lost: numbers[4],
                    goalsFor: numbers[5],
                    goalsAgainst: numbers[6],
                    goalDifference: numbers[5] - numbers[6],
                    points: numbers[7]
                });
            }
        }
        if (!teams.length) teams.push(...this.parseClassificationFromText(html));
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
            if (!home || !away) continue;
            const dateText = this.stripTags((row.match(/class=["'][^"']*game-schedule[^"']*["'][^>]*>([\s\S]*?)<\/span>/i) || [])[1] || '');
            matches.push({ jornada: null, home, homeGoals: scoreMatch ? Number(scoreMatch[1]) : null, away, awayGoals: scoreMatch ? Number(scoreMatch[2]) : null, date: this.parseFpfDate(dateText) });
        }

        // Newer responses may not use the game-link class. Parse table rows
        // with a score cell as a structural fallback.
        if (!matches.length) {
            for (const cells of this.extractTableRows(html)) {
                const scoreIndex = cells.findIndex(cell => /\b\d+\s*[-–]\s*\d+\b/.test(cell));
                if (scoreIndex < 1 || scoreIndex >= cells.length - 1) continue;
                const scoreMatch = cells[scoreIndex].match(/(\d+)\s*[-–]\s*(\d+)/);
                if (!scoreMatch) continue;
                const home = cells[scoreIndex - 1];
                const away = cells[scoreIndex + 1];
                if (!home || !away || /^\d/.test(home) || /^\d/.test(away)) continue;
                const dateCell = cells.find(cell => /\b\d{1,2}\s+[a-zç]{3,}\b/i.test(cell));
                matches.push({
                    jornada: null,
                    home,
                    homeGoals: Number(scoreMatch[1]),
                    away,
                    awayGoals: Number(scoreMatch[2]),
                    date: this.parseFpfDate(dateCell || '')
                });
            }
        }
        if (!matches.length) {
            const lines = this.extractTextLines(html);
            const months = /^\d{1,2}\s+(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\b/i;
            for (let i = 1; i < lines.length - 2; i++) {
                const scoreMatch = lines[i].match(/^(\d+)\s*[-–]\s*(\d+)$/);
                if (!scoreMatch) continue;
                const home = lines[i - 1];
                let dateIndex = i + 1;
                while (dateIndex < lines.length && !/^\d{1,2}\s+[a-zç]+/i.test(lines[dateIndex])) dateIndex++;
                const away = lines[dateIndex + 1];
                if (!home || !away || !months.test(lines[dateIndex])) continue;
                matches.push({
                    jornada: null,
                    home,
                    homeGoals: Number(scoreMatch[1]),
                    away,
                    awayGoals: Number(scoreMatch[2]),
                    date: this.parseFpfDate(lines[dateIndex])
                });
            }
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
            homeGoals: match.homeGoals === null ? null : (match.homeGoals ?? match.goloCasa),
            awayTeam: match.away || match.fora,
            awayGoals: match.awayGoals === null ? null : (match.awayGoals ?? match.goloFora),
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
            // The FPF classification is authoritative. Recalculating it from
            // the competition page would be wrong when Cloudflare blocks some
            // fixture endpoints and only a subset of matches is available.
            standings: teams.map(team => ({
                team: team.name,
                played: team.played,
                won: team.won,
                drawn: team.drawn,
                lost: team.lost,
                goalsFor: team.goalsFor,
                goalsAgainst: team.goalsAgainst,
                goalDifference: team.goalDifference,
                points: team.points,
                position: team.position
            })),
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
