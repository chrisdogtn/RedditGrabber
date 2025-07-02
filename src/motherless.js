const { JSDOM } = require('jsdom');
const path = require('path');

// Use dynamic import for node-fetch
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

async function scrapeMotherlessPage(pageUrl, log) {
    let allLinks = [];
    let currentPageUrl = pageUrl;
    let subfolderName = null;

    // Standardize URL
    if (currentPageUrl.includes('/m/')) {
        currentPageUrl = currentPageUrl.replace('/m/', '/u/');
    }

    // --- Determine Username for Subfolder ---
    try {
        log(`[Motherless] Fetching initial page to determine username...`);
        const initialResponse = await fetch(currentPageUrl);
        const initialHtml = await initialResponse.text();
        const initialDom = new JSDOM(initialHtml);
        const usernameElement = initialDom.window.document.querySelector('.member-bio-username');
        if (usernameElement) {
            subfolderName = usernameElement.textContent.trim().replace(/[^a-zA-Z0-9\-_]/g, '');
            log(`[Motherless] Found username: ${subfolderName}. Files will be saved to 'motherless.com/${subfolderName}'.`);
        } else {
            log('[Motherless] Could not find username. Files will be saved in the base "motherless.com" folder.');
        }
    } catch (error) {
        log(`[Motherless] Could not determine username for subfolder: ${error.message}`);
    }

    const urlObject = new URL(currentPageUrl);
    const typeParam = urlObject.searchParams.get('t');

    const shouldScrapeImages = !typeParam || typeParam === 'i' || typeParam === 'a';
    const shouldScrapeVideos = !typeParam || typeParam === 'v' || typeParam === 'a';

    log(`[Motherless] Starting scrape for ${pageUrl}. Images: ${shouldScrapeImages}, Videos: ${shouldScrapeVideos}`);

    while (currentPageUrl) {
        log(`[Motherless] Scraping page: ${currentPageUrl}`);
        try {
            const response = await fetch(currentPageUrl);
            const html = await response.text();
            const dom = new JSDOM(html);
            const document = dom.window.document;

            // --- Scrape Images ---
            if (shouldScrapeImages) {
                const imageThumbnails = Array.from(document.querySelectorAll('img.static'))
                    .map(img => img.getAttribute('data-strip-src'))
                    .filter(Boolean);

                for (const thumbUrl of imageThumbnails) {
                    try {
                        const fullSizeUrl = thumbUrl.replace('/thumbs/', '/images/');
                        const filename = path.basename(new URL(fullSizeUrl).pathname);
                        allLinks.push({
                            url: fullSizeUrl,
                            type: 'image',
                            downloader: 'axios', // Use the standard single-threaded downloader
                            id: filename.split('.')[0],
                            title: filename,
                            seriesFolder: subfolderName, // Use seriesFolder for sub-directory
                        });
                    } catch (e) {
                        log(`[Motherless] Error processing image thumbnail URL ${thumbUrl}: ${e.message}`);
                    }
                }
            }

            // --- Scrape Videos ---
            if (shouldScrapeVideos) {
                const videoPageLinks = Array.from(document.querySelectorAll('.desktop-thumb.video .caption.title'))
                    .map(a => a.href)
                    .filter(Boolean);

                for (const videoUrl of videoPageLinks) {
                     try {
                        const urlObj = new URL(videoUrl);
                        const codename = path.basename(urlObj.pathname);
                        allLinks.push({
                            url: videoUrl,
                            type: 'video',
                            downloader: 'ytdlp', // Let main process handle with yt-dlp
                            id: codename,
                            title: `motherless_${codename}`,
                            seriesFolder: subfolderName, // Use seriesFolder for sub-directory
                        });
                    } catch(e) {
                        log(`[Motherless] Error processing video URL ${videoUrl}: ${e.message}`);
                    }
                }
            }

            // --- Pagination ---
            const nextLink = document.querySelector('.pagination_link a[rel="next"]');
            if (nextLink) {
                currentPageUrl = new URL(nextLink.href, pageUrl).href;
            } else {
                currentPageUrl = null;
            }
        } catch (error) {
            log(`[Motherless] Failed to process page ${currentPageUrl}: ${error.message}`);
            currentPageUrl = null; // Stop if a page fails
        }
    }

    log(`[Motherless] Found ${allLinks.length} total links.`);
    return allLinks;
}

module.exports = { scrapeMotherlessPage };
