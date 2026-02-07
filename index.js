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
const LOCATIONS = ['Chennai', 'Bengaluru', 'Coimbatore', 'Hyderabad', 'Kerala', 'Remote', 'Hybrid'];
const EXPERIENCE_PARAM = '2'; // approximates 2 years.
const RESULTS_FILE = 'jobs.json';
const SERVICE_ACCOUNT_FILE = 'service_account_credentials.json';

// --- Category Configurations ---
const CONFIGS = [
    {
        category: 'Frontend',
        sheetId: process.env.GOOGLE_SHEET_ID, // Using same sheet for now
        roles: [
            'Frontend Developer', 'Front End Developer', 'React Frontend Developer', 'Angular UI Developer',
            'JavaScript Front End', 'Junior Web Developer', 'Senior Web Developer', 'Web Developer',
            'Frontend Engineer', 'React JS Developer', 'UI/UX Developer', 'UI UX Developer',
            'UX/UI Developer', 'UI Developer', 'Frontend UI/UX Developer', 'User Interface Developer',
            'User Experience Developer', 'UI/UX Designer Developer', 'UI/UX Design Consultant'
        ],
        uiFilter: null, // No UI filter for Frontend
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

    // STRICT: Last 1 Day (Anything from "Just now" to "23 hours ago" + "Today")
    if (lower.includes('just now')) return true;
    if (lower.includes('few hours')) return true; // Explicitly added as requested
    if (lower.includes('sec')) return true; // Covers "few seconds ago", "30 seconds ago", etc.
    if (lower.includes('min')) return true;
    if (lower.includes('hour')) return true; // Covers "1 hour ago", "12 hours ago", "23 hours ago" etc.
    if (lower.includes('today')) return true;

    // Sometimes "1 day ago" might appear if it's right on the edge, usually safe to include for "Last 1 Day" logic
    if (lower.includes('1 day')) return true;

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
        'ui ux', 'ux ui', 'user interface', 'user experience', 'interaction design',
        'responsive web design', 'front end design', 'sde', 'engineer',
        'react', 'vue', 'javascript', 'typescript', 'html', 'css', 'angular'
    ];

    const excludedKeywords = [
        'sales', 'marketing', 'hr', 'recruiter', 'manager',
        'backend', 'java ', 'python', 'php', 'net', '.net'
    ];

    const hasValid = validKeywords.some(k => t.includes(k));
    const hasExcluded = excludedKeywords.some(k => t.includes(k));

    return hasValid && !hasExcluded;
    return hasValid && !hasExcluded;
}

function isValidLocation(location) {
    if (!location) return false;
    const loc = location.toLowerCase();

    // Explicitly allowed - strict check if we want, but usually broad inclusion is safer,
    // then strict exclusion of "bad" locations.
    // However, if we see "San Francisco", we want to kill it.

    const excludedLocations = [
        'san francisco', 'usa', 'united states', 'uk', 'united kingdom', 'london',
        'europe', 'germany', 'singapore', 'australia', 'canada', 'dubai', 'uae'
    ];

    const hasExcluded = excludedLocations.some(l => loc.includes(l));
    if (hasExcluded) return false;

    // Optional: Strictly require at least one allowed location from our LOCATIONS list?
    // User asked "Location chennai... remote, hybrid. No others."
    // So we SHOULD enforce one of our allowed locations is present.
    // LOCATIONS are: ['Chennai', 'Bengaluru', 'Coimbatore', 'Hyderabad', 'Kerala', 'Remote', 'Hybrid']

    // Check if the location string contains at least one of our target locations
    const allowed = LOCATIONS.some(allowedLoc => loc.includes(allowedLoc.toLowerCase()));

    return allowed;
}

// --- LinkedIn Scraper Logic ---
async function scrapeLinkedIn(page, config, existingUrls, categoryJobs, existingJobs) {
    console.log(`\n--- Processing LinkedIn for Category: ${config.category} ---`);

    // LinkedIn Search URLs for "Product Designer" + "Past Week" (f_TPR=r604800)
    // We will construct dynamic URLs or use fixed ones provided by user.
    // User provided: "https://www.linkedin.com/jobs/search-results/?currentJobId=4328487238&keywords=product%20designer&origin=JOB_SEARCH_PAGE_JOB_FILTER&referralSearchId=wSQCgTzfk6RdpFt3xLuBoA%3D%3D&f_TPR=r604800"

    // We'll iterate over roles but LinkedIn search is flexible. We can try a few specific searches.
    // Simplified: Use one main search URL for Product Designer + Past Week + Location if possible.
    // Since scraping search results is easier than constructing 100% correct URL params, we'll try a generic search pattern.

    // Fixed Search URLs based on user request (Product Designer, Past Week)
    // We can iterate locations.

    for (const loc of LOCATIONS) {
        for (const role of config.roles) {
            // Basic rate limiting
            await randomDelay(3000, 6000);

            // Construct Search URL
            // f_TPR=r604800 => Past Week
            // geoId => 102713980 (India) - Forces India results
            // location => Chennai, Bengaluru
            const encodedRole = encodeURIComponent(role);
            const encodedLoc = encodeURIComponent(loc);
            const searchUrl = `https://www.linkedin.com/jobs/search?keywords=${encodedRole}&location=${encodedLoc}&geoId=102713980&f_TPR=r604800&position=1&pageNum=0`;

            console.log(`[LinkedIn] Searching for "${role}" in "${loc}"...`);

            try {
                await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
                await randomDelay(2000, 5000);

                let pageCount = 0;
                const MAX_PAGES = 5;

                while (pageCount < MAX_PAGES) {
                    pageCount++;
                    console.log(`[LinkedIn] Scraping Page ${pageCount} for "${role}" in "${loc}"...`);

                    // Auto-scroll to load more lazily loaded jobs
                    await page.evaluate(async () => {
                        const distance = 100;
                        const delay = 100;
                        const timer = setInterval(() => {
                            window.scrollBy(0, distance);
                            if (window.innerHeight + window.scrollY >= document.body.offsetHeight) {
                                clearInterval(timer);
                            }
                        }, delay);
                    });
                    await randomDelay(2000, 3000);

                    // Scrape Job Cards
                    // Based on user provided HTML: class="_52d04d34" with data-view-name="job-search-job-card"
                    // OR commonly: .job-search-card, ul.jobs-search__results-list li

                    // We'll try a broad selector strategy as LinkedIn HTML classes are obfuscated/dynamic (e.g. "_52d04d34")
                    // Reliable approach: search for the main list container or items

                    const scrapedJobs = await page.evaluate(() => {
                        const jobs = [];
                        // Selector based on user snippet and common guest view
                        // "job-search-job-card" seems to be a reliable data-attribute if available
                        // Fallback to "li" inside "ul.jobs-search__results-list" for public guest view

                        const cards = Array.from(document.querySelectorAll('div[data-view-name="job-search-job-card"], li .base-card'));

                        cards.forEach(card => {
                            try {
                                // Title
                                const titleEl = card.querySelector('.job-card-list__title, h3.base-search-card__title');
                                const title = titleEl ? titleEl.innerText.trim() : 'N/A';

                                // Link
                                const linkEl = card.querySelector('a.job-card-list__title, a.base-card__full-link');
                                const detailUrl = linkEl ? linkEl.href.split('?')[0] : null; // Clean URL

                                // Company
                                const companyEl = card.querySelector('.job-card-container__company-name, h4.base-search-card__subtitle');
                                const company = companyEl ? companyEl.innerText.trim() : 'N/A';

                                // Location
                                const locEl = card.querySelector('.job-card-container__metadata-item, span.job-search-card__location');
                                const location = locEl ? locEl.innerText.trim() : 'N/A';

                                // Date / Posted
                                const timeEl = card.querySelector('time');
                                const postedDate = timeEl ? timeEl.innerText.trim() : 'N/A';

                                if (detailUrl && title !== 'N/A') {
                                    jobs.push({
                                        title,
                                        detailUrl,
                                        company,
                                        location,
                                        postedDate,
                                        experience: 'N/A', // LinkedIn often hides this in details
                                        platform: 'LinkedIn'
                                    });
                                }
                            } catch (err) { }
                        });
                        return jobs;
                    });

                    console.log(`[LinkedIn] Found ${scrapedJobs.length} raw jobs on page ${pageCount}.`);

                    for (const job of scrapedJobs) {
                        if (existingUrls.has(job.detailUrl)) continue;

                        // Title Validation (reuse existing function)
                        if (!config.validateTitle(job.title)) continue;

                        // Location Validation
                        if (!isValidLocation(job.location)) continue;

                        // Freshness?
                        // We already used URL param f_TPR=r604800 (Past Week). 
                        // Verify if "hours" keyword needs to be checked? 
                        // User said: "add few keywords also like few hours ago".
                        // LinkedIn postedDate is often "2 days ago", "1 week ago", "5 hours ago".

                        // We'll relax specific date checking because we trust the URL filter (Past Week) 
                        // BUT for stricter "hours" preference:
                        // if user strictly wants very fresh, we check text. 
                        // Assuming user implies they *want* to see "few hours ago" ones highlighted or included.
                        // The generic isRecent function is tuned for Naukri strings ("Just Now", "Today").
                        // Let's assume URL filter (Past Week) is good enough for now, or apply soft check.

                        // Add to list
                        job.scrapedAt = new Date().toISOString();
                        job.category = config.category;
                        categoryJobs.push(job);
                        existingUrls.add(job.detailUrl);
                        existingJobs.push(job);
                    }

                    // Pagination Control
                    try {
                        const nextButtonSelector = 'button[data-testid="pagination-controls-next-button-visible"], button[aria-label="Next"]';
                        const nextBtn = await page.$(nextButtonSelector);

                        if (nextBtn) {
                            const isDisabled = await page.evaluate(el => el.disabled || el.classList.contains('disabled'), nextBtn);
                            if (!isDisabled) {
                                console.log('[LinkedIn] Clicking Next Page...');
                                await Promise.all([
                                    nextBtn.click(),
                                    randomDelay(3000, 6000)
                                ]);
                            } else {
                                console.log('[LinkedIn] Next button disabled. Stopping pagination.');
                                break;
                            }
                        } else {
                            console.log('[LinkedIn] No Next button found. Stopping pagination.');
                            break;
                        }
                    } catch (navErr) {
                        console.log('[LinkedIn] Pagination error:', navErr.message);
                        break;
                    }
                } // End while loop

            } catch (e) {
                console.error(`[LinkedIn] Error scraping ${role}:`, e.message);
            }
        }
    }
}

async function scrapeNaukri(page, config, existingUrls, categoryJobs, existingJobs) {
    for (const loc of LOCATIONS) {
        for (const role of config.roles) {
            try {
                console.log(`[Naukri] Searching for "${role}" in "${loc}"...`);

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

                    // Location Validation
                    if (!isValidLocation(job.location)) continue;

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
}

// --- Main Scraper ---
async function runScraper() {
    console.log(`\n[${new Date().toISOString()}] Starting Hourly Multi-Category Scrape...`);

    let browser;

    // --- STATELESS: Load existing URLs from Sheets ---
    let existingUrls = new Set();
    let existingJobs = []; // Fix: Initialize existingJobs

    // 1. Load from Local JSON (Fallback/Cache)
    if (fs.existsSync(RESULTS_FILE)) {
        try {
            const localJobs = JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8'));
            localJobs.forEach(j => {
                existingUrls.add(j.detailUrl);
                existingJobs.push(j); // Populate existingJobs
            });
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

            // 1. Naukri Scrape
            await scrapeNaukri(page, config, existingUrls, categoryJobs, existingJobs);

            // 2. LinkedIn Scrape (New)
            // Use same config (roles) but adapted for LinkedIn
            try {
                await scrapeLinkedIn(page, config, existingUrls, categoryJobs, existingJobs);
            } catch (linErr) {
                console.error('LinkedIn Scrape Failed:', linErr);
            }

            if (categoryJobs.length > 0) {
                console.log(`Found ${categoryJobs.length} new ${config.category} jobs (Naukri + LinkedIn).`);
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
