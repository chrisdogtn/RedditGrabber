const ScraperBase = require('../core/ScraperBase');
const axios = require('axios');
const cheerio = require('cheerio');
const { BROWSER_USER_AGENT } = require('../utils/apiUtils');

class WomennakedScraper extends ScraperBase {
  getName() {
    return 'Womennaked';
  }

  canHandle(url) {
    return /womennaked\.net\//i.test(url);
  }

  async scrape(url, log) {
    log(`[WMN] Scraping gallery: ${url}`);
    try {
      const axiosOptions = { headers: { "User-Agent": BROWSER_USER_AGENT } };
      const response = await axios.get(url, axiosOptions);
      const html = response.data;
      const $ = cheerio.load(html);
      
      const links = [];
      const baseUrl = new URL(url).origin;
      const items = $("li.box a.wmn-pop");
      for (let i = 0; i < items.length; i++) {
        const a = items.eq(i);
        let href = a.attr("href");
        if (!href) continue;
        // Build absolute URL for the get.php page
        if (href.startsWith("/")) href = baseUrl + href;
        else if (!href.startsWith("http")) href = baseUrl + "/" + href;
        links.push(href);
      }
      log(`[WMN] Found ${links.length} image detail pages.`);
  
      // --- Extract category name from URL for subfoldering ---
      let categoryFolder = null;
      try {
        const match = url.match(/womennaked\.net\/category\/([^\/]+)/i);
        if (match && match[1]) {
          categoryFolder = decodeURIComponent(match[1]);
        }
      } catch {}
  
      // Now fetch all image detail pages in parallel (limit concurrency for efficiency)
      const MAX_CONCURRENT = 8;
      const results = [];
      let idx = 0;
      let lastLogTime = Date.now();
      
      const worker = async () => {
        while (idx < links.length) {
          const myIdx = idx++;
          const linkUrl = links[myIdx];
          try {
            // Progress log every 20 images or every 2 seconds
            if (myIdx % 20 === 0 || Date.now() - lastLogTime > 2000) {
              log(`[INFO] Fetching detail page ${myIdx + 1} of ${links.length}...`);
              lastLogTime = Date.now();
            }
            const resp = await axios.get(linkUrl, axiosOptions);
            const $detail = cheerio.load(resp.data);
            // Find <a data-fancybox="image" href=...><img src=...></a>
            const imgA = $detail('a[data-fancybox="image"]');
            if (imgA.length) {
              const imgUrl = imgA.attr("href") || imgA.find("img").attr("src");
              const title = imgA.attr("title") || imgA.find("img").attr("alt") || "womennaked_image";
              if (imgUrl) {
                results.push({
                  url: imgUrl,
                  type: "image",
                  downloader: "axios", // single-threaded download for womennaked.net
                  id: Date.now().toString() + "_" + myIdx,
                  title,
                  domain: "womennaked.net",
                  ...(categoryFolder ? { seriesFolder: categoryFolder } : {}),
                });
              }
            }
          } catch (e) {
            log(`[WMN] Failed to fetch detail page: ${linkUrl} - ${e.message}`);
          }
        }
      };

      // Start workers
      const workers = [];
      for (let i = 0; i < Math.min(MAX_CONCURRENT, links.length); i++)
        workers.push(worker());
      await Promise.all(workers);
      
      log(`[WMN] Scraping complete. Found ${results.length} images.`);
      return results;
    } catch (error) {
      log(`[WMN] Error scraping gallery: ${error.message}`);
      return [];
    }
  }
}

module.exports = WomennakedScraper;
