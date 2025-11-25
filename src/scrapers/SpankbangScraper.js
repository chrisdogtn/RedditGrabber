const ScraperBase = require('../core/ScraperBase');
const { BrowserWindow } = require('electron');
const { BROWSER_USER_AGENT } = require('../utils/apiUtils');
const cheerio = require('cheerio');

class SpankbangScraper extends ScraperBase {
  getName() {
    return 'Spankbang';
  }

  canHandle(url) {
    return /spankbang\.com\//i.test(url);
  }

  async scrape(url, log) {
    log(`[SPANKBANG] Extracting direct video URL from: ${url}`);
    
    try {
      const html = await this.fetchHtmlWithBrowser(url);
      if (!html) {
          log(`[SPANKBANG] Failed to fetch HTML.`);
          return [];
      }

      // Look for the <script> tag containing stream_data
      const scriptMatch = html.match(
        /<script[^>]*>[^<]*var\s+stream_data\s*=\s*({[\s\S]*?});/
      );
      if (!scriptMatch || !scriptMatch[1]) {
        log(`[SPANKBANG] Could not find stream_data in HTML.`);
        return [];
      }
      let streamData;
      try {
        // Replace single quotes with double quotes for JSON parsing, but only for keys/values
        let jsonStr = scriptMatch[1]
          .replace(/'/g, '"')
          .replace(/,\s*}/g, "}") // Remove trailing commas
          .replace(/,\s*]/g, "]");
        streamData = JSON.parse(jsonStr);
      } catch (e) {
        log(`[SPANKBANG] Failed to parse stream_data: ${e.message}`);
        return [];
      }
      // Always grab the 'main' item (array)
      let mainArr = streamData.main;
      if (!mainArr || !Array.isArray(mainArr) || mainArr.length === 0) {
        log(`[SPANKBANG] No main video URL found in stream_data.`);
        return [];
      }
      const videoUrl = mainArr[0];
      // Extract title from <title>
      const $ = cheerio.load(html);
      let title = ($("title").text() || "").trim();
      if (!title) title = "spankbang_video";
      log(`[SPANKBANG] Extracted source URL: ${videoUrl}`);
      
      return [{
        url: videoUrl,
        title,
        supportsRangeRequests: true,
        type: 'video',
        downloader: 'multi-thread',
        id: Date.now().toString(),
        domain: 'spankbang.com'
      }];

    } catch (error) {
      log(`[SPANKBANG] Error extracting video: ${error.message}`);
      return [];
    }
  }

  async fetchHtmlWithBrowser(pageUrl) {
      return new Promise((resolve, reject) => {
      let win = new BrowserWindow({
        show: false,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
        },
      });
      let finished = false;
      win.webContents.setUserAgent(BROWSER_USER_AGENT);
      win.webContents.session.setCertificateVerifyProc((request, callback) => {
        callback(0);
      });
      win.loadURL(pageUrl);
      win.webContents.on("did-finish-load", async () => {
        if (finished) return;
        try {
          // Wait for stream_data to appear in the DOM (max 3s)
          const pollForStreamData = async () => {
            const maxAttempts = 30;
            let attempt = 0;
            while (attempt < maxAttempts) {
              const html = await win.webContents.executeJavaScript(
                "document.documentElement.outerHTML"
              );
              if (/var\\s+stream_data\\s*=\\s*{/.test(html)) return html;
              await new Promise((r) => setTimeout(r, 100));
              attempt++;
            }
            return await win.webContents.executeJavaScript(
              "document.documentElement.outerHTML"
            );
          };
          const html = await pollForStreamData();
          finished = true;
          win.destroy();
          resolve(html);
        } catch (e) {
          if (!finished) {
            finished = true;
            win.destroy();
            resolve(null);
          }
        }
      });
      win.on("unresponsive", () => {
        if (!finished) {
          finished = true;
          win.destroy();
          resolve(null);
        }
      });
      win.on("closed", () => {
        if (!finished) {
          finished = true;
          resolve(null);
        }
      });
      win.on("crashed", () => {
        if (!finished) {
          finished = true;
          resolve(null);
        }
      });
    });
  }
}

module.exports = SpankbangScraper;
