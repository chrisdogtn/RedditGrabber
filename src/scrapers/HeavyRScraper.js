const ScraperBase = require('../core/ScraperBase');
const { BrowserWindow } = require('electron');
const cheerio = require('cheerio');

class HeavyRScraper extends ScraperBase {
  getName() {
    return 'Heavy-R';
  }

  canHandle(url) {
    return /heavy-r\.com\/(video|user)\//i.test(url);
  }

  async scrape(url, log, options = {}) {
    const { isCancelled = () => false } = options;

    // Check if it's a profile or a video
    const heavyRVideoMatch = url.match(
      /^https?:\/\/(?:www\.)?heavy-r\.com\/video\/[^\/]+\/?/i
    );
    const heavyRProfileMatch = url.match(
      /^https?:\/\/(?:www\.)?heavy-r\.com\/user\/([^\/?#]+)/i
    );

    if (heavyRVideoMatch) {
      log(`[INFO] Detected heavy-r.com video page.`);
      const videoInfo = await this.scrapeHeavyRVideoPage(url, log);
      if (videoInfo && videoInfo.url) {
        return [
          {
            url: videoInfo.url,
            type: "video",
            downloader: "axios",
            id: Date.now().toString(),
            title: videoInfo.title,
            domain: 'heavy-r.com'
          },
        ];
      } else {
        log(`[ERROR] Could not extract video from heavy-r.com page.`);
        return [];
      }
    }

    if (heavyRProfileMatch) {
      const username = heavyRProfileMatch[1];
      log(`[INFO] Detected heavy-r.com profile: ${username}`);

      // Step 1: Gather all video page URLs from the profile
      const allPageLinks = [];
      for (const section of ["videos", "favorites"]) {
        let page = 0;
        let keepGoing = true;
        while (keepGoing) {
          if (isCancelled()) break;
          const pageUrl = `https://www.heavy-r.com/user/${username}?pro=${section}&p=${page}`;
          log(`[INFO] [heavy-r] Scanning ${section} page ${page} for user ${username}...`);
          const pageLinks = await this.scrapeHeavyRProfileSection(pageUrl, log);
          if (pageLinks.length === 0) {
            keepGoing = false;
          } else {
            allPageLinks.push(...pageLinks);
            page++;
          }
        }
        if (isCancelled()) break;
      }

      if (isCancelled()) {
        log(`[INFO] Scan for heavy-r profile ${username} cancelled.`);
        return [];
      }

      log(`[INFO] [heavy-r] Found ${allPageLinks.length} video pages for profile ${username}. Now extracting direct links...`);

      // Step 2 & 3: Extract direct URLs and create final job list
      const directVideoJobs = [];
      for (const pageLink of allPageLinks) {
        if (isCancelled()) break;
        const videoInfo = await this.scrapeHeavyRVideoPage(pageLink.url, log);
        if (videoInfo && videoInfo.url) {
          directVideoJobs.push({
            url: videoInfo.url,
            type: "video",
            downloader: "axios",
            id: pageLink.id,
            title: videoInfo.title,
            domain: 'heavy-r.com'
          });
        } else {
          log(`[ERROR] Could not extract video from heavy-r.com page: ${pageLink.url}`);
        }
      }

      log(`[INFO] [heavy-r] Extracted ${directVideoJobs.length} direct video links.`);
      return directVideoJobs;
    }
    
    return [];
  }

  async getHeavyRCookiesAndHtml(targetUrl) {
      return new Promise((resolve, reject) => {
        let win = new BrowserWindow({
          show: false, // Headless: do not show the window
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
          },
        });
        let finished = false;
        win.webContents.setUserAgent(
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
        );
        win.webContents.session.setCertificateVerifyProc((request, callback) => {
          callback(0);
        });
        win.loadURL(targetUrl);
        win.webContents.on("did-finish-load", async () => {
          // Poll for the presence of the video element or its source, up to 2s
          const pollForVideo = async () => {
            const maxAttempts = 20; // 2s at 100ms intervals
            let attempt = 0;
            while (attempt < maxAttempts) {
              try {
                const hasVideo = await win.webContents.executeJavaScript(`
                  (function() {
                    var v = document.getElementById('video-file');
                    if (v && (v.src || (v.querySelector('source') && v.querySelector('source').src))) {
                      return true;
                    }
                    return false;
                  })();
                `);
                if (hasVideo) return true;
              } catch {}
              await new Promise((r) => setTimeout(r, 100));
              attempt++;
            }
            return false;
          };
          if (finished) return;
          try {
            await pollForVideo();
            const cookies = await win.webContents.session.cookies.get({
              url: targetUrl,
            });
            const cookieHeader = cookies
              .map((c) => `${c.name}=${c.value}`)
              .join("; ");
            const html = await win.webContents.executeJavaScript(
              "document.documentElement.outerHTML"
            );
            finished = true;
            win.destroy();
            resolve({ cookieHeader, html });
          } catch (e) {
            if (!finished) {
              finished = true;
              win.destroy();
              reject(e);
            }
          }
        });
        win.on("unresponsive", () => {
          if (!finished) {
            finished = true;
            win.destroy();
            reject(new Error("BrowserWindow became unresponsive"));
          }
        });
        win.on("closed", () => {
          if (!finished) {
            finished = true;
            reject(
              new Error(
                "BrowserWindow closed before cookies/html could be retrieved"
              )
            );
          }
        });
        win.on("crashed", () => {
          if (!finished) {
            finished = true;
            reject(
              new Error(
                "BrowserWindow crashed before cookies/html could be retrieved"
              )
            );
          }
        });
      });
    }

    async scrapeHeavyRVideoPage(pageUrl, log) {
      try {
        const { cookieHeader, html } = await this.getHeavyRCookiesAndHtml(pageUrl);
        const $ = cheerio.load(html);
    
        // Find the <video id="video-file"> and its <source type="video/mp4"> or src attribute
        let url = null;
        let title = null;
        let videoSource = null;
        const video = $("#video-file");
        if (video.length) {
          // First, check for src attribute directly on <video>
          videoSource = video.attr("src");
          if (!videoSource) {
            // Try to get the first <source> child, regardless of type attribute
            videoSource = video.find("source").attr("src");
          }
        }
        if (!videoSource) {
          // Fallback: any <source ...mp4>
          videoSource = $('source[type="video/mp4"]').attr("src");
          if (!videoSource) {
            // Fallback: any <source> under any <video>
            videoSource = $("video source").attr("src");
          }
        }
        if (!videoSource) {
          // Fallback: try to find video URL in script tags or anywhere in the HTML
          const mp4Regex = /https?:\/\/[^"'\s>]+\.mp4/gi;
          let matches = html.match(mp4Regex);
          if (matches && matches.length > 0) {
            videoSource = matches[0];
            log(`[heavy-r] Fallback: Found mp4 URL in HTML: ${videoSource}`);
          } else {
            // Try to find in script tags
            $("script").each((i, el) => {
              const scriptContent = $(el).html();
              if (scriptContent) {
                const scriptMatches = scriptContent.match(
                  /https?:\/\/[^"'\s>]+\.mp4/gi
                );
                if (scriptMatches && scriptMatches.length > 0) {
                  videoSource = scriptMatches[0];
                  log(
                    `[heavy-r] Fallback: Found mp4 URL in <script>: ${videoSource}`
                  );
                  return false; // break
                }
              }
            });
          }
        }
        if (videoSource) {
          url = videoSource;
        }
        // Title: <h1 class="video-title"> or <title>
        title = ($("h1.video-title").text() || $("title").text() || "").trim();
        if (url) {
          return {
            url,
            title: title || "heavy-r_video",
          };
        }
        log("[heavy-r] No video source found in HTML.");
      } catch (err) {
        log(`[ERROR] Failed to scrape heavy-r.com page: ${err.message}`);
      }
      return null;
    }

    async scrapeHeavyRProfileSection(pageUrl, log) {
      try {
        // Use the same polling logic as getHeavyRCookiesAndHtml for video element
        const { cookieHeader, html } = await new Promise((resolve, reject) => {
          let win = new BrowserWindow({
            show: false,
            webPreferences: {
              nodeIntegration: false,
              contextIsolation: true,
            },
          });
          let finished = false;
          win.webContents.setUserAgent(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
          );
          win.webContents.session.setCertificateVerifyProc((request, callback) => {
            callback(0);
          });
          win.loadURL(pageUrl);
          win.webContents.on("did-finish-load", async () => {
            // Poll for the presence of any video link in the DOM, up to 2s
            const pollForLinks = async () => {
              const maxAttempts = 20;
              let attempt = 0;
              while (attempt < maxAttempts) {
                try {
                  const hasLinks = await win.webContents.executeJavaScript(`
                    (function() {
                      // Look for at least one <a class=\"image\"> link
                      return !!document.querySelector('a.image');
                    })();
                  `);
                  if (hasLinks) return true;
                } catch {}
                await new Promise((r) => setTimeout(r, 100));
                attempt++;
              }
              return false;
            };
            if (finished) return;
            try {
              await pollForLinks();
              const cookies = await win.webContents.session.cookies.get({
                url: pageUrl,
              });
              const cookieHeader = cookies
                .map((c) => `${c.name}=${c.value}`)
                .join("; ");
              const html = await win.webContents.executeJavaScript(
                "document.documentElement.outerHTML"
              );
              finished = true;
              win.destroy();
              resolve({ cookieHeader, html });
            } catch (e) {
              if (!finished) {
                finished = true;
                win.destroy();
                reject(e);
              }
            }
          });
          win.on("unresponsive", () => {
            if (!finished) {
              finished = true;
              win.destroy();
              reject(new Error("BrowserWindow became unresponsive"));
            }
          });
          win.on("closed", () => {
            if (!finished) {
              finished = true;
              reject(
                new Error(
                  "BrowserWindow closed before cookies/html could be retrieved"
                )
              );
            }
          });
          win.on("crashed", () => {
            if (!finished) {
              finished = true;
              reject(
                new Error(
                  "BrowserWindow crashed before cookies/html could be retrieved"
                )
              );
            }
          });
        });

        const $ = cheerio.load(html);
        const videoLinks = [];
        // Each video: <a href="/video/441968/2_Cocks_In_One_Pussy/" class="image">
        const regex = /<a\s+href="(\/video\/[^\"]+)"\s+class="image">/g;
        let match;
        while ((match = regex.exec(html)) !== null) {
          const href = match[1];
          // Extract title if possible
          let title = null;
          // Try to find the title in the following <h4 class="title"><a ...>TITLE</a></h4>
          // We'll search for the nearest <h4 class="title"> after this match
          const afterMatch = html.slice(match.index);
          const titleMatch = afterMatch.match(
            /<h4[^>]*class="title"[^>]*>\s*<a[^>]*>([^<]+)<\/a>/i
          );
          if (titleMatch && titleMatch[1]) {
            title = titleMatch[1].trim();
          }
          videoLinks.push({
            url: `https://www.heavy-r.com${href}`,
            id: href.replace(/[^a-zA-Z0-9]/g, ""),
            title: title || "heavy-r_video",
          });
        }
        return videoLinks;
      } catch (err) {
        log(`[ERROR] Failed to scrape heavy-r.com profile section: ${err.message}`);
        return [];
      }
    }
}

module.exports = HeavyRScraper;
