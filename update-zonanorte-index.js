// ZONA-NORTE Index Updater
// Script to update the championship index from FPF website or cached data
// Should be run periodically (e.g., via cron job) to keep data fresh

const fs = require('fs');
const path = require('path');

// Import the fetcher module (assuming it's in the same directory)
const { zonanorteFetcher } = require('./fetch-zonanorte-data.js');

class ZONA_NORTE_Index_Updater {
    constructor() {
        this.dataDir = path.join(process.cwd(), 'data');
        this.indexFile = path.join(this.dataDir, 'zonanorte-championship-index.json');
        this.backupDir = path.join(process.cwd(), 'backups');
        this.backupFile = path.join(this.backupDir, 'zonanorte-championship-index-backup.json');
        this.logFile = path.join(this.dataDir, 'update.log');
    }

    async ensureDirectories() {
        if (!fs.existsSync(this.dataDir)) {
            fs.mkdirSync(this.dataDir, { recursive: true });
        }
        if (!fs.existsSync(this.backupDir)) {
            fs.mkdirSync(this.backupDir, { recursive: true });
        }
    }

    log(message) {
        const timestamp = new Date().toISOString();
        const logEntry = `[${timestamp}] ${message}\n`;
        console.log(logEntry.trim());
        fs.appendFileSync(this.logFile, logEntry);
    }

    async backupCurrentIndex() {
        if (fs.existsSync(this.indexFile)) {
            try {
                const currentData = JSON.parse(fs.readFileSync(this.indexFile, 'utf8'));
                fs.writeFileSync(this.backupFile, JSON.stringify(currentData, null, 2));
                this.log('Backup created successfully');
            } catch (error) {
                this.log(`Warning: Failed to create backup: ${error.message}`);
            }
        }
    }

    async updateIndex() {
        try {
            this.log('Starting ZONA-NORTE index update...');
            await this.ensureDirectories();
            await this.backupCurrentIndex();

            // Use the fetcher to get data
            const result = await zonanorteFetcher.triggerAutoUpdate();

            if (!result) {
                throw new Error('Failed to fetch data from fetcher');
            }

            // Create the data directory structure if needed
            const dataDir = path.join(process.cwd(), 'data');
            const indexFile = path.join(dataDir, 'zonanorte-championship-index.json');

            // Convert the download result to the expected format
            const downloadUrl = result.downloadUrl;
            const filename = result.filename;

            // Download the actual data from the URL or use cached data
            const response = await fetch(downloadUrl);
            if (response.ok) {
                const data = await response.text();
                const parsedData = JSON.parse(data);

                // Update the index file
                fs.writeFileSync(indexFile, JSON.stringify(parsedData, null, 2));
                this.log(`Index updated successfully - ${result.dataSize} bytes written`);
                this.log(`Last updated: ${parsedData.metadata.lastUpdated}`);

                // Also update the root index file for backward compatibility
                const rootIndexFile = path.join(process.cwd(), 'zonanorte-championship-index.json');
                fs.writeFileSync(rootIndexFile, JSON.stringify(parsedData, null, 2));

                return { success: true, dataSize: result.dataSize, lastUpdated: parsedData.metadata.lastUpdated };
            } else {
                throw new Error(`Failed to download data: ${response.status}`);
            }

        } catch (error) {
            this.log(`Error updating index: ${error.message}`);
            throw error;
        }
    }

    async validateIndex() {
        try {
            this.log('Validating index file...');

            if (!fs.existsSync(this.indexFile)) {
                throw new Error('Index file not found');
            }

            const data = JSON.parse(fs.readFileSync(this.indexFile, 'utf8'));

            // Validate required fields
            const required = ['metadata', 'teams', 'matches', 'topScorers', 'standings', 'zonaInfo'];
            for (const field of required) {
                if (!data[field]) {
                    throw new Error(`Missing required field: ${field}`);
                }
            }

            // Validate metadata fields
            if (!data.metadata.zona || data.metadata.zona !== 'ZONA-NORTE') {
                throw new Error('Invalid or missing zona in metadata');
            }

            if (!data.metadata.competitionId || !data.metadata.seasonId) {
                throw new Error('Missing competition or season ID in metadata');
            }

            // Validate standings consistency
            if (data.teams.length !== data.standings.length) {
                this.log('Warning: Teams count does not match standings count');
            }

            // Check if teams in standings match teams array
            const standingTeams = data.standings.map(team => team.team);
            const teamNames = data.teams.map(team => team.name);
            const missingTeams = standingTeams.filter(team => !teamNames.includes(team));
            if (missingTeams.length > 0) {
                this.log(`Warning: Some teams in standings not found in teams array: ${missingTeams.join(', ')}`);
            }

            this.log('Index validation completed successfully');
            return { valid: true, issues: [] };

        } catch (error) {
            this.log(`Index validation failed: ${error.message}`);
            return { valid: false, issues: [error.message] };
        }
    }

    async checkForUpdates() {
        try {
            this.log('Checking for updates...');

            // Get cached data timestamp
            const cachedData = localStorage.getItem('zonanorte_championship_data');
            let cachedTimestamp = null;

            if (cachedData) {
                const parsed = JSON.parse(cachedData);
                cachedTimestamp = parsed.timestamp;
            }

            // Try to update
            const result = await this.updateIndex();

            if (result) {
                // Validate the new index
                const validation = await this.validateIndex();

                if (validation.valid) {
                    this.log('Update completed successfully and index is valid');
                    return {
                        status: 'success',
                        updated: true,
                        dataSize: result.dataSize,
                        lastUpdated: result.lastUpdated,
                        validation: validation
                    };
                } else {
                    this.log('Update completed but index validation failed');
                    return {
                        status: 'partial_success',
                        updated: true,
                        dataSize: result.dataSize,
                        lastUpdated: result.lastUpdated,
                        validation: validation
                    };
                }
            } else {
                throw new Error('Update failed to complete');
            }

        } catch (error) {
            this.log(`Update check failed: ${error.message}`);
            return {
                status: 'error',
                updated: false,
                error: error.message
            };
        }
    }

    printStatus() {
        try {
            if (fs.existsSync(this.indexFile)) {
                const data = JSON.parse(fs.readFileSync(this.indexFile, 'utf8'));
                console.log('\n=== ZONA-NORTE Championship Status ===');
                console.log(`Source: ${data.metadata.source}`);
                console.log(`Zona: ${data.metadata.zona}`);
                console.log(`Competition ID: ${data.metadata.competitionId}`);
                console.log(`Season ID: ${data.metadata.seasonId}`);
                console.log(`Season: ${data.metadata.championship.season}`);
                console.log(`Last Updated: ${data.metadata.lastUpdated}`);
                console.log(`Teams: ${data.teams.length}`);
                console.log(`Matches: ${data.matches.length}`);
                console.log(`Top Scorers: ${data.topScorers.length}`);
                console.log(`Format: ${data.zonaInfo.format} - ${data.zonaInfo.ageGroup}`);
                console.log('\n=== Top 3 Teams ===');
                data.standings.slice(0, 3).forEach((team, index) => {
                    console.log(`${index + 1}. ${team.team} - ${team.points} pts, ${team.goalDifference} GD`);
                });
                console.log('\n');
            } else {
                console.log('No index file found');
            }
        } catch (error) {
            console.log(`Error reading status: ${error.message}`);
        }
    }

    async setupAutomatedUpdates() {
        // This would set up cron jobs or other automated update mechanisms
        this.log('Setting up automated ZONA-NORTE updates...');

        // Example cron setup (Unix-like systems)
        const cronCommand = '0 */6 * * * cd "' + process.cwd() + '" && node update-zonanorte-index.js';

        console.log('Automated update schedule: Every 6 hours at minute 0');
        console.log('To set up cron job on Unix/Linux:');
        console.log(`echo "${cronCommand}" | crontab -`);
        console.log('\nOn Windows Task Scheduler:');
        console.log('Create task to run: node update-zonanorte-index.js every 6 hours');

        this.log('Automated update setup completed');
    }
}

// Main execution
(async () => {
    const args = process.argv.slice(2);
    const updater = new ZONA_NORTE_Index_Updater();

    try {
        switch (args[0]) {
            case 'update':
                await updater.updateIndex();
                break;
            case 'validate':
                const validation = await updater.validateIndex();
                console.log('Validation result:', validation);
                break;
            case 'status':
                updater.printStatus();
                break;
            case 'setup':
                await updater.setupAutomatedUpdates();
                break;
            case 'check':
                const checkResult = await updater.checkForUpdates();
                console.log('Check result:', checkResult);
                break;
            default:
                console.log('\n=== ZONA-NORTE Index Updater ===');
                console.log('Usage: node update-zonanorte-index.js <command>');
                console.log('Commands:');
                console.log('  update   - Update index from website/cached data');
                console.log('  validate - Validate current index file');
                console.log('  status   - Print current championship status');
                console.log('  setup    - Set up automated updates');
                console.log('  check    - Check for updates and update if needed');
                console.log('\nExample: node update-zonanorte-index.js update');
        }
    } catch (error) {
        console.error('Error:', error.message);
        process.exit(1);
    }
})();