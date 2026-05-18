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

    let urlObj;
    try {
      urlObj = new URL(url);
    } catch (e) {
      log(`[LUXURETV] Invalid URL: ${url}`);
      return [];
    }
    const originalUrl = urlObj.toString();
    const normalizedDomain = urlObj.hostname.replace(/^www\./, "");

    try {
      const extraction = await this.fetchPageExtractionWithBrowser(originalUrl);
      if (!extraction || !extraction.html) {
          log(`[LUXURETV] Failed to fetch HTML.`);
          return [this.buildYtDlpFallback(originalUrl, normalizedDomain)];
      }

      const { html, sources } = extraction;
      const $ = cheerio.load(html);
      const htmlCandidates = this.collectHtmlCandidates($);
      const allCandidates = Array.from(
        new Set([...(sources || []), ...htmlCandidates])
      )
        .map((candidate) => this.toAbsoluteUrl(candidate, originalUrl))
        .filter(Boolean);

      const videoSource = this.pickBestVideoSource(allCandidates);
      if (!videoSource) {
        log(`[LUXURETV] No video source found in HTML/runtime. Falling back to yt-dlp.`);
        return [this.buildYtDlpFallback(originalUrl, normalizedDomain)];
      }

      const isManifest = /\.(m3u8|mpd)(?:$|[?#])/i.test(videoSource);
      const downloader = isManifest ? "ytdlp" : "multi-thread";

      let title = ($("title").text() || "").trim();
      if (!title) title = "luxuretv_video";
      log(`[LUXURETV] Extracted source URL (${downloader}): ${videoSource}`);

      return [{
        url: videoSource,
        title,
        supportsRangeRequests: !isManifest,
        type: 'video',
        downloader,
        id: Date.now().toString(),
        domain: normalizedDomain
      }];

    } catch (error) {
      log(`[LUXURETV] Error extracting video: ${error.message}`);
      return [this.buildYtDlpFallback(originalUrl, normalizedDomain)];
    }
  }

  collectHtmlCandidates($) {
    const candidates = [];
    const append = (value) => {
      if (typeof value === "string" && value.trim()) {
        candidates.push(value.trim());
      }
    };

    $("video[src], source[src]").each((_, node) => append($(node).attr("src")));
    $('meta[property="og:video"], meta[property="og:video:url"], meta[name="twitter:player:stream"], meta[name="twitter:player:stream:content_type"]').each((_, node) => append($(node).attr("content")));
    $("a[href]").each((_, node) => {
      const href = $(node).attr("href");
      if (href && /\.(mp4|m3u8|mpd)(?:$|[?#])/i.test(href)) {
        append(href);
      }
    });

    const html = $.html();
    const scriptPatterns = [
      /["'](?:file|src|video|videoUrl|playlistUrl|hls|mp4)["']\s*:\s*["']([^"']+)["']/gi,
      /["'](https?:\/\/[^"']+\.(?:mp4|m3u8|mpd)(?:\?[^"']*)?)["']/gi,
      /["'](\/\/[^"']+\.(?:mp4|m3u8|mpd)(?:\?[^"']*)?)["']/gi
    ];

    for (const pattern of scriptPatterns) {
      let match;
      while ((match = pattern.exec(html)) !== null) {
        append(match[1]);
      }
    }

    return candidates;
  }

  pickBestVideoSource(candidates) {
    if (!Array.isArray(candidates) || candidates.length === 0) return null;
    const filtered = candidates.filter((url) =>
      /^https?:\/\//i.test(url) || /^\/\//.test(url) || /^\//.test(url)
    );
    if (filtered.length === 0) return null;

    const score = (value) => {
      if (/\.mp4(?:$|[?#])/i.test(value)) return 3;
      if (/\.m3u8(?:$|[?#])/i.test(value)) return 2;
      if (/\.mpd(?:$|[?#])/i.test(value)) return 1;
      return 0;
    };

    filtered.sort((a, b) => score(b) - score(a));
    return filtered[0] || null;
  }

  toAbsoluteUrl(candidate, baseUrl) {
    try {
      return new URL(candidate, baseUrl).toString();
    } catch {
      return null;
    }
  }

  buildYtDlpFallback(pageUrl, domain) {
    return {
      url: pageUrl,
      title: "luxuretv_video",
      supportsRangeRequests: false,
      type: "video",
      downloader: "ytdlp",
      id: Date.now().toString(),
      domain: domain || "luxuretv.com"
    };
  }

  async fetchPageExtractionWithBrowser(pageUrl) {
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
          const pollForData = async () => {
            const maxAttempts = 80;
            let attempt = 0;

            while (attempt < maxAttempts) {
              const payload = await win.webContents.executeJavaScript(`
                (() => {
                  const collect = [];
                  const push = (value) => {
                    if (typeof value === "string" && value.trim()) collect.push(value.trim());
                  };

                  document.querySelectorAll("video, source").forEach((el) => {
                    push(el.src);
                    push(el.currentSrc);
                    push(el.getAttribute("src"));
                  });

                  document.querySelectorAll("meta[property='og:video'], meta[property='og:video:url'], meta[name='twitter:player:stream']").forEach((el) => {
                    push(el.content);
                  });

                  return {
                    html: document.documentElement.outerHTML,
                    sources: Array.from(new Set(collect))
                  };
                })();
              `);

              const hasMediaSource = (payload.sources || []).some((src) => /\.(mp4|m3u8|mpd)(?:$|[?#])/i.test(src));
              if (hasMediaSource) return payload;

              await new Promise((r) => setTimeout(r, 150));
              attempt++;
            }

            return await win.webContents.executeJavaScript(`
              (() => {
                const collect = [];
                const push = (value) => {
                  if (typeof value === "string" && value.trim()) collect.push(value.trim());
                };
                document.querySelectorAll("video, source").forEach((el) => {
                  push(el.src);
                  push(el.currentSrc);
                  push(el.getAttribute("src"));
                });
                document.querySelectorAll("meta[property='og:video'], meta[property='og:video:url'], meta[name='twitter:player:stream']").forEach((el) => {
                  push(el.content);
                });
                return {
                  html: document.documentElement.outerHTML,
                  sources: Array.from(new Set(collect))
                };
              })();
            `);
          };

          const extraction = await pollForData();
          finished = true;
          win.destroy();
          resolve(extraction);
        } catch (e) {
          if (!finished) {
            finished = true;
            win.destroy();
            resolve({ html: null, sources: [] });
          }
        }
      });
      win.on("unresponsive", () => {
        if (!finished) {
          finished = true;
          win.destroy();
          resolve({ html: null, sources: [] });
        }
      });
      win.on("closed", () => {
        if (!finished) {
          finished = true;
          resolve({ html: null, sources: [] });
        }
      });
      win.on("crashed", () => {
        if (!finished) {
          finished = true;
          resolve({ html: null, sources: [] });
        }
      });
    });
  }
}

module.exports = LuxureTVScraper;
