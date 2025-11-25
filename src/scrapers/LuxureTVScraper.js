const ScraperBase = require('../core/ScraperBase');
const { BrowserWindow } = require('electron');
const { BROWSER_USER_AGENT } = require('../utils/apiUtils');
const cheerio = require('cheerio');

class LuxureTVScraper extends ScraperBase {
  getName() {
    return 'LuxureTV';
  }

  canHandle(url) {
    return /luxuretv\.com\/(video|videos)\//i.test(url);
  }

  async scrape(url, log) {
    log(`[LUXURETV] Extracting direct video URL from: ${url}`);
    
    // Normalize the URL to use base domain luxuretv.com
    let urlObj;
    try {
      urlObj = new URL(url);
    } catch (e) {
      log(`[LUXURETV] Invalid URL: ${url}`);
      return [];
    }
    urlObj.hostname = "luxuretv.com";
    const normalizedUrl = urlObj.toString();

    try {
      const html = await this.fetchHtmlWithBrowser(normalizedUrl);
      if (!html) {
          log(`[LUXURETV] Failed to fetch HTML.`);
          return [];
      }

      const $ = cheerio.load(html);
      // Look for <video id="thisPlayer_html5_api"> and its <source src=...>
      let videoSource = null;
      const video = $("#thisPlayer_html5_api");
      if (video.length) {
        // Try to get the first <source> child with type="video/mp4"
        videoSource = video.find('source[type="video/mp4"]').attr("src");
        // Fallback: try src attribute directly on <video>
        if (!videoSource) {
          videoSource = video.attr("src");
        }
      }
      if (!videoSource) {
        // Fallback: try to find any <source src=...mp4>
        videoSource = $('source[type="video/mp4"]').attr("src");
      }
      if (!videoSource) {
        log(`[LUXURETV] No video source found in HTML.`);
        return [];
      }
      // Extract title from <title>
      let title = ($("title").text() || "").trim();
      if (!title) title = "luxuretv_video";
      log(`[LUXURETV] Extracted source URL: ${videoSource}`);
      
      return [{
        url: videoSource,
        title,
        supportsRangeRequests: true,
        type: 'video',
        downloader: 'multi-thread',
        id: Date.now().toString(),
        domain: 'luxuretv.com'
      }];

    } catch (error) {
      log(`[LUXURETV] Error extracting video: ${error.message}`);
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
          // Wait for the video element to appear (max 3s)
          const pollForVideo = async () => {
            const maxAttempts = 30;
            let attempt = 0;
            while (attempt < maxAttempts) {
              const html = await win.webContents.executeJavaScript(
                "document.documentElement.outerHTML"
              );
              if (html.includes('id="thisPlayer_html5_api"')) return html;
              await new Promise((r) => setTimeout(r, 100));
              attempt++;
            }
            return await win.webContents.executeJavaScript(
              "document.documentElement.outerHTML"
            );
          };
          const html = await pollForVideo();
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

module.exports = LuxureTVScraper;
