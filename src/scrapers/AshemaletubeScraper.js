const ScraperBase = require('../core/ScraperBase');
const { BrowserWindow } = require('electron');
const { BROWSER_USER_AGENT } = require('../utils/apiUtils');

class AshemaletubeScraper extends ScraperBase {
  getName() {
    return 'Ashemaletube';
  }

  canHandle(url) {
    return /ashemaletube\.com\/videos\//i.test(url);
  }

  async scrape(url, log, options = {}) {
    log(`[ASHEMALETUBE] Extracting direct video URL from: ${url}`);
    
    try {
      const html = await this.fetchHtmlWithBrowser(url);
      if (!html) {
          log(`[ASHEMALETUBE] Failed to fetch HTML.`);
          return [];
      }

      // Find the sources array in the script tag (robust extraction)
      const sourcesVarMatch = html.match(/var\s+sources\s*=\s*(\[.*?\]);/s);
      if (!sourcesVarMatch || !sourcesVarMatch[1]) {
        log(`[ASHEMALETUBE] No sources array found in page`);
        return [];
      }
      let sourcesArr;
      try {
        // Unescape and parse JSON array
        let sourcesJson = sourcesVarMatch[1]
          .replace(/\\(["'])/g, "$1") // unescape quotes
          .replace(/\n|\r/g, ""); // remove newlines
        sourcesArr = JSON.parse(sourcesJson);
      } catch (e) {
        log(`[ASHEMALETUBE] Failed to parse sources array: ${e.message}`);
        return [];
      }
      // Always select the first object in the sources array
      let bestSource = null;
      if (Array.isArray(sourcesArr) && sourcesArr.length > 0) {
        bestSource = sourcesArr[0];
      }
      if (
        !bestSource ||
        typeof bestSource.src !== "string" ||
        !bestSource.src.startsWith("https://cdn.ashemaletube.com/") ||
        !bestSource.src.endsWith(".mp4")
      ) {
        log(`[ASHEMALETUBE] No valid video source found in first array item`);
        return [];
      }
      
      log(`[ASHEMALETUBE] Extracted source URL: ${bestSource.src}`);
      // Extract title from <title>
      let title = null;
      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      if (titleMatch && titleMatch[1]) {
        title = titleMatch[1].replace(/\s*-\s*AShemaleTube.*$/, "").trim();
      }

      const FORCE_YTDLP_ONLY_HOSTS = options.settings?.FORCE_YTDLP_ONLY_HOSTS || [];
      const domain = new URL(url).hostname.replace(/^www\./, "");
      
      let downloader = "multi-thread";
      if (FORCE_YTDLP_ONLY_HOSTS.some((host) => domain.includes(host))) {
          log(`[INFO] ashemaletube.com is in FORCE_YTDLP_ONLY_HOSTS, passing extracted link to yt-dlp.`);
          downloader = "ytdlp";
      }

      return [{
        url: bestSource.src,
        title: title || "ashemaletube_video",
        supportsRangeRequests: true,
        type: 'video',
        downloader: downloader,
        id: Date.now().toString(),
        domain: 'ashemaletube.com'
      }];

    } catch (error) {
      log(`[ASHEMALETUBE] Error extracting video: ${error.message}`);
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
          // Wait for sources array to appear in the DOM (max 3s)
          const pollForSources = async () => {
            const maxAttempts = 30;
            let attempt = 0;
            while (attempt < maxAttempts) {
              const html = await win.webContents.executeJavaScript(
                "document.documentElement.outerHTML"
              );
              if (/var\\s+sources\\s*=\\s*\[/.test(html)) return html;
              await new Promise((r) => setTimeout(r, 100));
              attempt++;
            }
            return await win.webContents.executeJavaScript(
              "document.documentElement.outerHTML"
            );
          };
          const html = await pollForSources();
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

module.exports = AshemaletubeScraper;
