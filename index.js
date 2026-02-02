/**
 * Naukri.com Job Scraper & Automation
 * 
 * Supports Multi-Category Scraping:
 * 1. Design: Strict Title Filter, "UX, Design" UI Filter, Saves to Design Sheet.
 * 2. Frontend: Strict Dev Title Filter, No UI Filter, Saves to Developer Sheet.
 * 
 * Shared Settings:
 * - Locations: Chennai, Bengaluru
 * - Experience: 2-3 years
 * - Freshness: Last 7 Days (Testing)
 */

require('dotenv').config();
const puppeteer = require('puppeteer');
const fs = require('fs');
const cron = require('node-cron');
const { google } = require('googleapis');

// --- Shared Configuration ---
const LOCATIONS = ['Chennai', 'Bengaluru'];
const EXPERIENCE_PARAM = '2'; // approximates 2 years.
const RESULTS_FILE = 'jobs.json';
const SERVICE_ACCOUNT_FILE = 'service_account_credentials.json';

// --- Category Configurations ---
const CONFIGS = [
    {
        category: 'Design',
        sheetId: process.env.GOOGLE_SHEET_ID, // Original Sheet
        roles: ['Product Designer', 'Product Design', 'UX Design', 'UX and UI Designer', 'UI/UX'],
        uiFilter: 'UX, Design & Architecture', // Applies this Department filter
        validateTitle: isValidDesignTitle
    },
    {
        category: 'Frontend',
        sheetId: '1XG5qG4EJLLhWb7ODs2lPePnTkKtBM-T7K9R9J2zLzZ8', // New Developer Sheet
        roles: [
            'Frontend Development', 'Frontend Web Developer', 'UI Development',
            'Front End', 'Web Development', 'Front End Design',
            'Web Designing', 'Responsive Web Design', 'Web Application Development'
        ],
        uiFilter: null, // No Department filter
        validateTitle: isValidDevTitle
    }
];

// --- Google Sheets Logic ---
function getAuth() {
    return new google.auth.GoogleAuth({
        keyFile: fs.existsSync(SERVICE_ACCOUNT_FILE) ? SERVICE_ACCOUNT_FILE : undefined,
        credentials: !fs.existsSync(SERVICE_ACCOUNT_FILE) ? {
            client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
            private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        } : undefined,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
}

async function fetchExistingUrls(spreadsheetId) {
    if (!spreadsheetId) return [];
    try {
        const auth = getAuth();
        const sheets = google.sheets({ version: 'v4', auth });

        // Dynamic Sheet Name Fetch
        const meta = await sheets.spreadsheets.get({ spreadsheetId });
        const sheetTitle = meta.data.sheets[0].properties.title;

        // Assuming 'Detail URL' is in Column E (index 4) based on appendToSheet order
        // A=Company, B=Title, C=Exp, D=Loc, E=DetailURL
        const range = `'${sheetTitle}'!E:E`;

        const response = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range,
        });

        const rows = response.data.values;
        if (!rows || rows.length === 0) return [];

        // Flatten and return URLs
        return rows.flat().filter(url => url && url.startsWith('http'));

    } catch (error) {
        console.error(`[Sheets] Error fetching URLs from ${spreadsheetId}:`, error.message);
        return [];
    }
}

async function appendToSheet(jobs, spreadsheetId) {
    if (!jobs || jobs.length === 0) return;
    if (!spreadsheetId) {
        console.log('[Sheets] No Spreadsheet ID provided. Skipping Sheets upload.');
        return;
    }

    try {
        const auth = getAuth();
        const sheets = google.sheets({ version: 'v4', auth });

        // 1. Get the actual sheet name (tab name)
        const meta = await sheets.spreadsheets.get({ spreadsheetId });
        const sheetTitle = meta.data.sheets[0].properties.title;
        const range = `'${sheetTitle}'!A1`;

        const values = jobs.map(job => [
            job.company || '',
            job.title || '',
            job.experience || '',
            job.location || '',
            job.detailUrl || '',
            job.postedDate || '',
            job.scrapedAt || ''
        ]);

        await sheets.spreadsheets.values.append({
            spreadsheetId: spreadsheetId,
            range: range,
            valueInputOption: 'USER_ENTERED',
            resource: { values },
        });
        console.log(`[Sheets] Appended ${jobs.length} rows to Sheet "${sheetTitle}" (${spreadsheetId.slice(0, 5)}...).`);
    } catch (err) {
        console.error(`[Sheets] Error appending to ${spreadsheetId}:`, err.message);
    }
}

// --- Helper Functions ---
const delay = (time) => new Promise(resolve => setTimeout(resolve, time));
const randomDelay = (min = 2000, max = 5000) => delay(Math.floor(Math.random() * (max - min) + min));

function isRecent(postedDateText) {
    if (!postedDateText) return false;
    const lower = postedDateText.toLowerCase();

    // STRICT: Last 1 Hour + Today
    if (lower.includes('just now')) return true;
    if (lower.includes('sec')) return true; // Covers "few seconds ago", "30 seconds ago", etc.
    if (lower.includes('min')) return true;
    if (lower.includes('1 hour') || lower === '1 hour ago') return true;
    if (lower.includes('today')) return true;

    return false;
}

function isValidDesignTitle(title) {
    if (!title) return false;
    const t = title.toLowerCase();

    const validKeywords = [
        'product design', 'product designer',
        'ux', 'ui', 'user experience', 'user interface', 'interaction design',
        'visual design', 'product manager'
    ];

    const excludedKeywords = [
        'sheet metal', 'hvac', 'electrical', 'civil', 'architect',
        'mechanical', 'sales', 'marketing', 'youtube', 'anchor',
        'camera', 'diesel', 'quality', 'compliance', 'technician',
        'cleanroom', 'mep', 'panel design', 'silicon', 'manager'
    ];

    const hasValid = validKeywords.some(k => t.includes(k));
    const hasExcluded = excludedKeywords.some(k => t.includes(k));

    return hasValid && !hasExcluded;
}

function isValidDevTitle(title) {
    if (!title) return false;
    const t = title.toLowerCase();

    const validKeywords = [
        'frontend', 'front end', 'web develop', 'web design', 'ui develop',
        'react', 'angular', 'vue', 'javascript', 'typescript', 'html', 'css'
    ];

    const excludedKeywords = [
        'sales', 'marketing', 'hr', 'recruiter', 'manager',
        'backend', 'java ', 'python', 'php', 'net', '.net'
    ];

    const hasValid = validKeywords.some(k => t.includes(k));
    const hasExcluded = excludedKeywords.some(k => t.includes(k));

    return hasValid && !hasExcluded;
}

// --- Main Scraper ---
async function runScraper() {
    console.log(`\n[${new Date().toISOString()}] Starting Hourly Multi-Category Scrape...`);

    let browser;

    // --- STATELESS: Load existing URLs from Sheets ---
    let existingUrls = new Set();

    // 1. Load from Local JSON (Fallback/Cache)
    if (fs.existsSync(RESULTS_FILE)) {
        try {
            const localJobs = JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8'));
            localJobs.forEach(j => existingUrls.add(j.detailUrl));
        } catch (e) {
            console.error('Error reading jobs.json', e);
        }
    }

    // 2. Load from Google Sheets (Source of Truth)
    console.log('[Init] Fetching existing jobs from Google Sheets to prevent duplicates...');
    for (const config of CONFIGS) {
        const sheetUrls = await fetchExistingUrls(config.sheetId);
        console.log(`[Init] Loaded ${sheetUrls.length} URLs from Sheet (${config.category})`);
        sheetUrls.forEach(url => existingUrls.add(url));
    }
    console.log(`[Init] Total unique existing jobs tracked: ${existingUrls.size}`);

    try {
        browser = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
        });
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        // --- Iterating Categories ---
        for (const config of CONFIGS) {
            console.log(`\n--- Processing Category: ${config.category} ---`);
            let categoryJobs = [];

            for (const loc of LOCATIONS) {
                for (const role of config.roles) {
                    try {
                        console.log(`Searching for "${role}" in "${loc}"...`);

                        const formattedRole = role.toLowerCase().replace(/[^a-z0-9]+/g, '-');
                        const formattedLoc = loc.toLowerCase().replace(/[^a-z0-9]+/g, '-');
                        // jobAge=1
                        let url = `https://www.naukri.com/${formattedRole}-jobs-in-${formattedLoc}?experience=${EXPERIENCE_PARAM}&jobAge=1`;

                        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
                        await randomDelay(2000, 4000);

                        // --- UI FILTERING (Conditional) ---
                        if (config.uiFilter) {
                            try {
                                await page.waitForSelector('.styles_filterContainer__4aQaD', { timeout: 3000 }).catch(() => { });
                                const filterClicked = await page.evaluate(async (filterName) => {
                                    const labels = Array.from(document.querySelectorAll('label p span.styles_filterLabel__jRP04'));
                                    const target = labels.find(l => l.innerText.includes(filterName));
                                    if (target) {
                                        target.scrollIntoView();
                                        const labelNode = target.closest('label');
                                        labelNode.click();
                                        return true;
                                    }
                                    return false;
                                }, 'UX, Design');

                                if (filterClicked) {
                                    console.log(`Applied Filter: ${config.uiFilter}`);
                                    await randomDelay(3000, 5000);
                                }
                            } catch (e) {
                                // console.log('Filter interaction skipped', e.message);
                            }
                        }

                        // --- Freshness UI (Shared) ---
                        // Ensure "Last 1 Day" context for strict checks later
                        try {
                            const freshnessBtn = await page.$('#filter-freshness');
                            if (freshnessBtn) {
                                const btnText = await page.evaluate(el => el.innerText, freshnessBtn);
                                if (!btnText.includes('Last 1 day')) {
                                    await freshnessBtn.click();
                                    await page.waitForSelector('a[data-id="filter-freshness-1"]', { visible: true, timeout: 2000 });
                                    await page.click('a[data-id="filter-freshness-1"]');
                                    await randomDelay(2000, 4000);
                                }
                            }
                        } catch (e) { }

                        await page.waitForSelector('.list, .srp-jobtuple-wrapper, .jobTuple', { timeout: 10000 }).catch(() => { });

                        const scrapedJobs = await page.evaluate(() => {
                            const nodes = document.querySelectorAll('.srp-jobtuple-wrapper, article.jobTuple');
                            const data = [];
                            nodes.forEach(node => {
                                const titleEl = node.querySelector('.title, a[title]');
                                const url = titleEl ? titleEl.href : null;
                                const title = titleEl ? (titleEl.getAttribute('title') || titleEl.innerText) : 'N/A';
                                const postedDate = node.querySelector('.job-post-day, span.fleft.postedDate')?.innerText || 'N/A';
                                const company = node.querySelector('.comp-name, a.subTitle')?.innerText || 'N/A';
                                const location = node.querySelector('.loc, .loc-wrap, span[title*="location"]')?.innerText || 'N/A';
                                const experience = node.querySelector('.exp, .exp-wrap, span[title*="Exp"]')?.innerText || 'N/A';

                                if (url) {
                                    data.push({ title, detailUrl: url, postedDate, company, location, experience });
                                }
                            });
                            return data;
                        });

                        for (const job of scrapedJobs) {
                            if (existingUrls.has(job.detailUrl)) continue;

                            // Use Category-Specific Validator
                            if (!config.validateTitle(job.title)) continue;

                            if (isRecent(job.postedDate)) {
                                const exp = job.experience.toLowerCase();
                                const match = exp.match(/(\d+)-(\d+)/);
                                let validExp = false;

                                if (match) {
                                    const min = parseInt(match[1]);
                                    const max = parseInt(match[2]);
                                    if (min <= 3 && max >= 2) validExp = true;
                                } else if (exp.includes('2 yrs') || exp.includes('3 yrs')) {
                                    validExp = true;
                                }

                                if (validExp) {
                                    job.scrapedAt = new Date().toISOString();
                                    job.category = config.category;
                                    categoryJobs.push(job);
                                    existingUrls.add(job.detailUrl);
                                    existingJobs.push(job);
                                }
                            }
                        }
                        await randomDelay(1000, 2000);
                    } catch (e) {
                        console.error(`Error searching ${role}:`, e.message);
                    }
                }
            }

            if (categoryJobs.length > 0) {
                console.log(`Found ${categoryJobs.length} new ${config.category} jobs.`);
                // Save to Specific Sheet
                await appendToSheet(categoryJobs, config.sheetId);
            } else {
                console.log(`No new ${config.category} jobs found.`);
            }
        }

        // Save updated Full List to JSON (deduplicated)
        fs.writeFileSync(RESULTS_FILE, JSON.stringify(existingJobs, null, 2));

    } catch (e) {
        console.error('Browser Error:', e);
    } finally {
        if (browser) await browser.close();
    }
}

// --- Execution Logic ---
console.log('Multi-Category Job Search Service Started.');

if (process.env.CI === 'true') {
    console.log('[Mode] CI Environment detected. Running once...');
    runScraper().then(() => {
        console.log('[Mode] Scrape complete. Exiting.');
    }).catch(err => {
        console.error('[Mode] Scrape failed:', err);
        process.exit(1);
    });
} else {
    console.log('[Mode] Local/Server Environment. Scheduling cron: "0 * * * *" (Every hour at minute 0)');
    // Run immediately on start
    runScraper();

    // Schedule
    cron.schedule('0 * * * *', () => {
        runScraper();
    });
}
