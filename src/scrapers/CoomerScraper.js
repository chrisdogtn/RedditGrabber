const ScraperBase = require('../core/ScraperBase');
const { BrowserWindow } = require('electron');
const path = require('path');

class CoomerScraper extends ScraperBase {
  getName() {
    return 'Coomer';
  }

  canHandle(url) {
    return url.includes('coomer.st') || url.includes('coomer.su');
  }

  async scrape(url, log, options = {}) {
    const { isCancelled = () => false } = options;
    let allLinks = [];
    let win = null;

    try {
      log(`[Coomer] Starting scrape for ${url} using hidden window...`);

      // 1. Parse URL to get service and user
      const match = url.match(/coomer\.(?:st|su)\/([^\/]+)\/user\/([^\/\?]+)/);
      if (!match) {
        throw new Error('Invalid Coomer profile URL format. Expected: .../service/user/username');
      }

      const service = match[1];
      const userId = match[2];
      // Python script strips query params from base url
      const baseUrl = `https://coomer.st/${service}/user/${userId}`;
      log(`[Coomer] Target: Service=${service}, User=${userId}`);

      // 2. Create hidden window
      win = new BrowserWindow({
        show: false,
        width: 1200,
        height: 800,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          partition: 'persist:coomer' // Persist session for cookies
        }
      });

      // OPTIMIZATION: Block images and stylesheets to speed up loading
      win.webContents.session.webRequest.onBeforeRequest(
        { urls: ['*://*/*'] },
        (details, callback) => {
          const url = details.url.toLowerCase();
          if (
            url.endsWith('.jpg') ||
            url.endsWith('.jpeg') ||
            url.endsWith('.png') ||
            url.endsWith('.gif') ||
            url.endsWith('.css') ||
            url.includes('google-analytics') ||
            url.includes('doubleclick')
          ) {
            callback({ cancel: true });
          } else {
            callback({ cancel: false });
          }
        }
      );

      let offset = 0;
      let pageNum = 1;
      let hasMore = true;

      while (hasMore) {
        if (isCancelled()) {
            log('[Coomer] Scrape cancelled by user.');
            break;
        }

        const pageUrl = `${baseUrl}?o=${offset}`;
        log(`[Coomer] Scanning page ${pageNum}: ${pageUrl}`);
        
        await win.loadURL(pageUrl);
        
        // Wait for posts selector (like WebDriverWait in Python)
        try {
            await win.webContents.executeJavaScript(`
                new Promise((resolve, reject) => {
                    const check = () => {
                        if (document.querySelector('a.fancy-link.fancy-link--kemono, article.post-card')) resolve();
                        else setTimeout(check, 200);
                    };
                    setTimeout(check, 200);
                    setTimeout(resolve, 5000); // Timeout after 5s
                })
            `);
        } catch(e) {}

        // Get all post URLs using the Python script's selector + fallback
        const postUrls = await win.webContents.executeJavaScript(`
            (() => {
                const links = [];
                // Python script uses: a.fancy-link.fancy-link--kemono
                // We also keep article.post-card > a as fallback
                const elements = document.querySelectorAll('a.fancy-link.fancy-link--kemono, article.post-card > a');
                elements.forEach(a => {
                    if (a.href && a.href.includes('/post/') && !links.includes(a.href)) {
                        links.push(a.href);
                    }
                });
                return links;
            })()
        `);

        if (!postUrls || postUrls.length === 0) {
            log(`[Coomer] No posts found on page ${pageNum}. Reached end of profile.`);
            hasMore = false;
            break;
        }

        log(`[Coomer] Found ${postUrls.length} posts on page ${pageNum}. Processing...`);

        // Process each post
        for (let i = 0; i < postUrls.length; i++) {
            if (isCancelled()) break;
            const postUrl = postUrls[i];
            
            // Log to UI
            log(`[Coomer] [Pg ${pageNum}] Fetching post ${i + 1}/${postUrls.length}...`);
            
            // Navigate to post
            await win.loadURL(postUrl);
            
            // Wait for media selector (like Python: a.post__attachment-link)
            try {
                await win.webContents.executeJavaScript(`
                    new Promise((resolve) => {
                        const check = () => {
                            if (document.querySelector('a.post__attachment-link')) resolve();
                            else setTimeout(check, 100);
                        };
                        setTimeout(check, 100);
                        setTimeout(resolve, 3000); // 3s timeout
                    })
                `);
            } catch(e) {}

            // Scrape media - STRICTLY using requested selectors
            const mediaItems = await win.webContents.executeJavaScript(`
                (() => {
                    const items = [];
                    const seen = new Set();
                    const add = (url, name) => {
                        if (!url || seen.has(url)) return;
                        seen.add(url);
                        items.push({ url, name });
                    };

                    // STRICTLY "Download" links as requested by user
                    // Python script uses: a.post__attachment-link
                    document.querySelectorAll('a.post__attachment-link').forEach(a => {
                        let name = a.getAttribute('download') || a.innerText.trim();
                        // Clean filename from URL if needed
                        if (!name || name === 'Download') {
                            try {
                                const urlObj = new URL(a.href);
                                const fParam = urlObj.searchParams.get('f');
                                if (fParam) name = fParam;
                                else name = urlObj.pathname.split('/').pop();
                            } catch(e) {}
                        }
                        add(a.href, name);
                    });

                    return items;
                })()
            `);

            if (mediaItems && mediaItems.length > 0) {
                let newCount = 0;
                for (const item of mediaItems) {
                    if (!item.url) continue;
                    
                    let filename = item.name || 'unknown';
                    // Decode URI component if needed (Python: unquote)
                    try { filename = decodeURIComponent(filename); } catch(e){}
                    
                    // Remove forbidden chars
                    filename = filename.replace(/[\\/*?:"<>|]/g, "");
                    
                    allLinks.push({
                        url: item.url,
                        type: 'video', // Generic
                        downloader: 'multi-thread', // Try multi-thread
                        id: filename,
                        title: `coomer_${userId}_${filename}`,
                        seriesFolder: `coomer.st/${userId}`,
                        domain: 'coomer.st'
                    });
                    newCount++;
                }
                log(`[Coomer]   -> Found ${newCount} files.`);
            }
        }

        // Pagination logic from Python script:
        // if len(new_posts) < 50: has_more_pages = False
        if (postUrls.length < 50) {
            log(`[Coomer] Found fewer than 50 posts (${postUrls.length}), assuming end of profile.`);
            hasMore = false;
        } else {
            offset += 50;
            pageNum++;
        }
      }

    } catch (error) {
      log(`[Coomer] Error: ${error.message}`);
    } finally {
      if (win) {
        win.destroy();
      }
    }

    log(`[Coomer] Found ${allLinks.length} total links.`);
    return allLinks;
  }
}

module.exports = CoomerScraper;
