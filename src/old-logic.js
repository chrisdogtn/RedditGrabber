// --- Changelog content (update as needed) ---
const APP_CHANGELOG = `
<h2 style="color:rgb(209, 52, 52)">Phil Downloader Changelog V1.6.1</h2>
<ul>
  <li>Added support for nsfw.sex.</li>
  
</ul>
<style>
  ul {
    padding-left: 20px;
  }
  li {
    margin-bottom: 10px;
  }
</style>
`;

function showChangelogWindow() {
  const win = new BrowserWindow({
    width: 600,
    height: 500,
    title: "Changelog",
    modal: true,
    parent: mainWindow,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  win.setMenu(null);
  win.loadURL(
    "data:text/html;charset=utf-8," +
      encodeURIComponent(`
    <html><head><title>Changelog</title></head><body style="font-family:sans-serif;padding:20px;background: #111111; color: white; overflow-y: auto;">${APP_CHANGELOG}<br><div style="text-align: center;"><button style="padding: 15px 50px; border: none;background-color: #00e0c3;  color: #000;  border-radius: 8px;  cursor: pointer;  font-size: 0.9rem;  font-weight: 700;transition: background-color 0.2s, opacity 0.2s;" onclick="window.close()">Close</button></div></body></html>
  `)
  );
}

function showSupportedDomainsWindow() {
  const domains = settings.YTDLP_SUPPORTED_HOSTS || [];
  const html = `
    <h2 style="color:rgb(209, 52, 52)">Currently Supported Domains</h2>
    <ul>${domains.map((d) => `<li>${d}</li>`).join("")}</ul>
    <button style="padding: 15px 50px; border: none;background-color: #00e0c3;  color: #000;  border-radius: 8px;  cursor: pointer;  font-size: 0.9rem;  font-weight: 700;transition: background-color 0.2s, opacity 0.2s;" onclick="window.close()">Close</button>
    <style>
  ul {
    padding-left: 20px;
  }
  li {
    margin-bottom: 10px;
  }
</style>
  `;
  const win = new BrowserWindow({
    width: 400,
    height: 600,
    title: "Supported Domains",
    modal: true,
    parent: mainWindow,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  win.setMenu(null);
  win.loadURL(
    "data:text/html;charset=utf-8," +
      encodeURIComponent(
        `<html><head><title>Supported Domains</title></head><body style="font-family:sans-serif;padding:20px;background: #111111; color: white; overflow-y: auto;">${html}</body></html>`
      )
  );
}
// --- womennaked.net gallery scraper ---
async function scrapeWomennakedGallery(galleryUrl, log) {
  try {
    log(`[WMN] Scraping gallery: ${galleryUrl}`);
    const axiosOptions = { headers: { "User-Agent": BROWSER_USER_AGENT } };
    const response = await axios.get(galleryUrl, axiosOptions);
    const html = response.data;
    const cheerio = require("cheerio");
    const $ = cheerio.load(html);
    // Find all <li class="box"> elements with <a class="wmn-pop" href=...>
    const links = [];
    const baseUrl = new URL(galleryUrl).origin;
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
      const match = galleryUrl.match(/womennaked\.net\/category\/([^\/]+)/i);
      if (match && match[1]) {
        categoryFolder = decodeURIComponent(match[1]);
      }
    } catch {}

    // Now fetch all image detail pages in parallel (limit concurrency for efficiency)
    const MAX_CONCURRENT = 8;
    const results = [];
    let idx = 0;
    let lastLogTime = Date.now();
    async function worker() {
      while (idx < links.length) {
        const myIdx = idx++;
        const url = links[myIdx];
        try {
          // Progress log every 10 images or every 2 seconds
          if (myIdx % 20 === 0 || Date.now() - lastLogTime > 2000) {
            log(
              `[INFO] Fetching detail page ${myIdx + 1} of ${links.length}...`
            );
            lastLogTime = Date.now();
          }
          const resp = await axios.get(url, axiosOptions);
          const $detail = cheerio.load(resp.data);
          // Find <a data-fancybox="image" href=...><img src=...></a>
          const imgA = $detail('a[data-fancybox="image"]');
          if (imgA.length) {
            const imgUrl = imgA.attr("href") || imgA.find("img").attr("src");
            const title =
              imgA.attr("title") ||
              imgA.find("img").attr("alt") ||
              "womennaked_image";
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
          log(`[WMN] Failed to fetch detail page: ${url} - ${e.message}`);
        }
      }
    }
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
// --- spankbang.com video extractor (BrowserWindow) ---
async function extractSpankbangVideoUrl(pageUrl, log) {
  try {
    log(`[SPANKBANG] Extracting direct video URL from: ${pageUrl}`);
    // Use Electron headless browser to fetch HTML (bypass anti-bot)
    const html = await new Promise((resolve, reject) => {
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
            new Error("BrowserWindow closed before HTML could be retrieved")
          );
        }
      });
      win.on("crashed", () => {
        if (!finished) {
          finished = true;
          reject(
            new Error("BrowserWindow crashed before HTML could be retrieved")
          );
        }
      });
    });
    // Look for the <script> tag containing stream_data
    const scriptMatch = html.match(
      /<script[^>]*>[^<]*var\s+stream_data\s*=\s*({[\s\S]*?});/
    );
    if (!scriptMatch || !scriptMatch[1]) {
      log(`[SPANKBANG] Could not find stream_data in HTML.`);
      return null;
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
      return null;
    }
    // Always grab the 'main' item (array)
    let mainArr = streamData.main;
    if (!mainArr || !Array.isArray(mainArr) || mainArr.length === 0) {
      log(`[SPANKBANG] No main video URL found in stream_data.`);
      return null;
    }
    const videoUrl = mainArr[0];
    // Extract title from <title>
    const cheerio = require("cheerio");
    const $ = cheerio.load(html);
    let title = ($("title").text() || "").trim();
    if (!title) title = "spankbang_video";
    log(`[SPANKBANG] Extracted source URL: ${videoUrl}`);
    return {
      url: videoUrl,
      title,
      supportsRangeRequests: true,
    };
  } catch (error) {
    log(`[SPANKBANG] Error extracting video: ${error.message}`);
    return null;
  }
}
// --- luxuretv.com video extractor ---
async function extractLuxuretvVideoUrl(pageUrl, log) {
  try {
    log(`[LUXURETV] Extracting direct video URL from: ${pageUrl}`);
    // Use Electron headless browser to fetch HTML (bypass anti-bot)
    const html = await new Promise((resolve, reject) => {
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
            new Error("BrowserWindow closed before HTML could be retrieved")
          );
        }
      });
      win.on("crashed", () => {
        if (!finished) {
          finished = true;
          reject(
            new Error("BrowserWindow crashed before HTML could be retrieved")
          );
        }
      });
    });
    // Use cheerio to parse the HTML
    const cheerio = require("cheerio");
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
      return null;
    }
    // Extract title from <title>
    let title = ($("title").text() || "").trim();
    if (!title) title = "luxuretv_video";
    log(`[LUXURETV] Extracted source URL: ${videoSource}`);
    return {
      url: videoSource,
      title,
      supportsRangeRequests: true,
    };
  } catch (error) {
    log(`[LUXURETV] Error extracting video: ${error.message}`);
    return null;
  }
}
// --- ashemaletube.com video extractor ---
async function extractAshemaletubeVideoUrl(pageUrl, log) {
  try {
    log(`[ASHEMALETUBE] Extracting direct video URL from: ${pageUrl}`);
    // Always use Electron headless browser to get HTML after Cloudflare/JS
    let html = await new Promise((resolve, reject) => {
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
            new Error("BrowserWindow closed before HTML could be retrieved")
          );
        }
      });
      win.on("crashed", () => {
        if (!finished) {
          finished = true;
          reject(
            new Error("BrowserWindow crashed before HTML could be retrieved")
          );
        }
      });
    });
    let usedBrowser = true;
    // Find the sources array in the script tag (robust extraction)
    const sourcesVarMatch = html.match(/var\s+sources\s*=\s*(\[.*?\]);/s);
    if (!sourcesVarMatch || !sourcesVarMatch[1]) {
      log(
        `[ASHEMALETUBE] No sources array found in page` +
          (usedBrowser ? " (browser fallback)" : "")
      );
      return null;
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
      return null;
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
      return null;
    }
    //
    log(`[ASHEMALETUBE] Extracted source URL: ${bestSource.src}`);
    // Extract title from <title>
    let title = null;
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch && titleMatch[1]) {
      title = titleMatch[1].replace(/\s*-\s*AShemaleTube.*$/, "").trim();
    }
    return {
      url: bestSource.src,
      title: title || "ashemaletube_video",
      supportsRangeRequests: true,
    };
  } catch (error) {
    log(`[ASHEMALETUBE] Error extracting video: ${error.message}`);
    return null;
  }
}
const { app, BrowserWindow, ipcMain, dialog, Menu } = require("electron");
const fs = require("fs");
const path = require("path");
const fsp = require("fs").promises;
const axios = require("axios");
const { autoUpdater } = require("electron-updater");
const { spawn } = require("child_process");
const { scrapeMotherlessPage } = require("./motherless.js");
const settings = require("./config/settings.js");

let Store;
let store;
let mainWindow;
let isCancelled = false;
let isSkipping = false;

// Track active processes and downloads for hard stop functionality
let activeProcesses = new Set();
let activeAxiosControllers = new Set();

// Track active downloads for queue display
let activeDownloads = [];

function appLog(message) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("log-update", message);
  }
  // Remove debug logs from production
  if (
    typeof message === "string" &&
    (message.includes("[DEBUG]") || message.includes("[QUEUE-DEBUG]"))
  )
    return;
  console.log(message);
}
function getYtDlpPath() {
  const devPath = path.join(__dirname, "..", "bin", "yt-dlp.exe");
  const prodPath = path.join(process.resourcesPath, "bin", "yt-dlp.exe");
  return app.isPackaged ? prodPath : devPath;
}
async function updateYtDlp() {
  return new Promise((resolve) => {
    const ytDlpPath = getYtDlpPath();
    if (!fs.existsSync(ytDlpPath)) {
      appLog(
        "[YTDLP-ERROR] yt-dlp.exe not found! Please download it and place it in the /bin folder."
      );
      return resolve();
    }
    appLog("App updating...");
    const updaterProcess = spawn(ytDlpPath, ["-U"]);
    updaterProcess.stdout.on("data", (data) =>
      appLog(`[YTDLP] ${data.toString().trim()}`)
    );
    updaterProcess.stderr.on("data", (data) =>
      appLog(`[YTDLP-ERROR] ${data.toString().trim()}`)
    );
    updaterProcess.on("close", (code) => {
      appLog("[YTDLP] Update check complete.");
      resolve();
    });
    updaterProcess.on("error", (err) => {
      appLog(`[YTDLP-FATAL] Failed to start yt-dlp updater: ${err.message}`);
      resolve();
    });
  });
}
const isDev = !app.isPackaged;

const menuTemplate = [
  { label: "File", submenu: [{ role: "quit" }] },
  {
    label: "Help",
    submenu: [
      {
        label: "About",
        click: () => {
          dialog.showMessageBox(mainWindow, {
            type: "info",
            title: `About ${app.getName()}`,
            message: `Version: ${app.getVersion()}`,
          });
        },
      },
      {
        label: "Show Changelog",
        click: showChangelogWindow,
      },
      {
        label: "Supported Domains",
        click: showSupportedDomainsWindow,
      },
      {
        label: "Check for Updates",
        click: () => {
          appLog("[INFO] Manual update check triggered.");
          autoUpdater.checkForUpdatesAndNotify();
        },
      },
    ],
  },
];

if (isDev) {
  menuTemplate.push({
    label: "Debug",
    submenu: [
      {
        label: "Trigger Mock Update Available",
        click: () => {
          if (mainWindow) {
            mainWindow.webContents.send("update-notification", {
              message: "[MOCK] App update available. Downloading...",
              showRestart: false,
            });
          }
        },
      },
      {
        label: "Trigger Mock Update Download Progress",
        click: () => {
          let percent = 0;
          const interval = setInterval(() => {
            percent += 10;
            if (mainWindow) {
              mainWindow.webContents.send("update-download-progress", {
                percent,
                transferred: percent * 1000,
                total: 10000,
                bytesPerSecond: 1000,
              });
            }
            if (percent >= 100) {
              clearInterval(interval);
              setTimeout(() => {
                if (mainWindow) {
                  mainWindow.webContents.send("update-notification", {
                    message:
                      "[MOCK] App update downloaded. Restart to install.",
                    showRestart: true,
                  });
                }
              }, 500);
            }
          }, 300);
        },
      },
    ],
  });
}
async function createWindow() {
  const { default: StoreClass } = await import("electron-store");
  Store = StoreClass;
  store = new Store();
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 905,
    minWidth: 940,
    minHeight: 900,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }

  const menu = Menu.buildFromTemplate(menuTemplate);
  Menu.setApplicationMenu(menu);
  mainWindow.loadFile(path.join(__dirname, "index.html"));
  mainWindow.webContents.on("did-finish-load", async () => {
    appLog("[INFO] Checking for app updates...");
    autoUpdater.checkForUpdatesAndNotify();
    await updateYtDlp();
    appLog("[INFO] Ready.");
  });
}
autoUpdater.on("checking-for-update", () =>
  appLog("[INFO] Checking for app updates...")
);
autoUpdater.on("update-not-available", (info) =>
  appLog("[Updater] You are on the latest version.")
);
let lastNotifiedVersion = null;
autoUpdater.on("update-available", (info) => {
  appLog(`[Updater] Update available (v${info.version}).`);
  mainWindow.webContents.send("update-notification", {
    message:
      "App update available. Downloading... <a id='show-changelog' href='#'>View Changelog</a>",
    showProgress: true,
  });
  // Listen for renderer click on changelog link
  if (mainWindow) {
    mainWindow.webContents
      .executeJavaScript(
        `
      setTimeout(() => {
        const el = document.getElementById('show-changelog');
        if (el) el.onclick = function(e) { e.preventDefault(); require('electron').ipcRenderer.send('show-changelog'); };
      }, 500);
    `
      )
      .catch(() => {});
  }
  lastNotifiedVersion = info.version;
});
// Show changelog on first run after update
app.on("ready", () => {
  const Store = require("electron-store");
  const store = new Store();
  const lastVersion = store.get("lastVersion");
  const currentVersion = app.getVersion();
  if (lastVersion !== currentVersion) {
    setTimeout(showChangelogWindow, 1000);
    store.set("lastVersion", currentVersion);
  }
});

// IPC for changelog popup from renderer
ipcMain.on("show-changelog", showChangelogWindow);
autoUpdater.on("download-progress", (progressObj) => {
  appLog(`[Updater] Downloading update: ${Math.round(progressObj.percent)}%`);
  if (mainWindow) {
    mainWindow.webContents.send("update-download-progress", {
      percent: progressObj.percent,
      transferred: progressObj.transferred,
      total: progressObj.total,
      bytesPerSecond: progressObj.bytesPerSecond,
    });
  }
});
autoUpdater.on("update-downloaded", (info) => {
  appLog(`[Updater] Update v${info.version} downloaded.`);
  mainWindow.webContents.send("update-notification", {
    message: "App update downloaded. Restart to install.",
    showRestart: true,
  });
});
autoUpdater.on("error", (err) =>
  appLog(`[Updater] Error: ${err.message || err}`)
);
app.whenReady().then(createWindow);
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
ipcMain.on("restart_app", () => autoUpdater.quitAndInstall());
ipcMain.handle("get-app-version", () => app.getVersion());
ipcMain.handle("settings:getDownloadPath", () =>
  store.get("downloadPath", app.getPath("downloads"))
);
ipcMain.on("start-download", (event, options) => {
  runDownloader(options, appLog).catch((err) =>
    appLog(`[FATAL] Unhandled error: ${err.message}`)
  );
});
ipcMain.handle("dialog:setDownloadPath", async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory"],
  });
  if (!canceled) {
    store.set("downloadPath", filePaths[0]);
    return filePaths[0];
  }
  return null;
});
ipcMain.handle("dialog:openFile", async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ["openFile"],
    filters: [{ name: "Text Files", extensions: ["txt"] }],
  });
  if (!canceled && filePaths.length > 0)
    return fs.readFileSync(filePaths[0], "utf-8");
  return null;
});
ipcMain.on("stop-download", () => {
  isCancelled = true;

  appLog(
    `[INFO] Stop command received. Active processes: ${activeProcesses.size}, Active requests: ${activeAxiosControllers.size}`
  );

  // Cancel all active axios requests first
  activeAxiosControllers.forEach((controller) => {
    try {
      controller.abort();
      appLog(`[INFO] Aborted an HTTP request.`);
    } catch (err) {
      appLog(`[INFO] Failed to abort request: ${err.message}`);
    }
  });
  activeAxiosControllers.clear();

  // Kill all active yt-dlp processes
  activeProcesses.forEach((childProcess) => {
    if (childProcess && !childProcess.killed && childProcess.pid) {
      appLog(`[INFO] Cancelling Downloads`);
      if (process.platform === "win32") {
        // Use taskkill on Windows to forcefully terminate the process and its children
        const { spawn } = require("child_process");
        const kill = spawn("taskkill", ["/pid", childProcess.pid, "/f", "/t"]);
        kill.on("close", (code) => {
          if (code !== 0) {
            appLog(
              `[WARN] taskkill for PID ${childProcess.pid} exited with code ${code}. The process may not have been terminated.`
            );
          }
        });
        kill.on("error", (err) => {
          appLog(
            `[ERROR] Failed to execute taskkill for PID ${childProcess.pid}: ${err.message}`
          );
        });
      } else {
        // On macOS and Linux, SIGKILL is effective.
        childProcess.kill("SIGKILL");
        appLog(`[INFO] Sent SIGKILL to process with PID: ${childProcess.pid}`);
      }
    }
  });
  activeProcesses.clear();

  // Clear progress bars and download queue
  if (mainWindow) {
    mainWindow.webContents.send("download-progress", {
      current: 0,
      total: 0,
    });
    mainWindow.webContents.send("queue-progress", {
      current: 0,
      total: 0,
    });
  }

  // Clear the download queue when stopping
  clearDownloadQueue();

  appLog("[INFO] Stop signal sent to all active downloads.");
});
ipcMain.on("skip-subreddit", () => {
  isSkipping = true;
});
ipcMain.handle("getYtDlpWhitelist", () => YTDLP_SUPPORTED_HOSTS);

// Download queue management functions
function addToDownloadQueue(url, title, id) {
  // Prevent duplicate entries in the download queue
  const existingDownload = activeDownloads.find((item) => item.id === id);
  if (existingDownload) {
    return id; // Item is already in the queue
  }

  const downloadItem = {
    id: id || `${Date.now()}_${Math.random()}`,
    name: sanitizeTitleForFilename(title) || url,
    status: "downloading",
    startTime: Date.now(),
    progress: 0,
  };
  //
  activeDownloads.push(downloadItem);
  notifyDownloadQueueUpdated();
  return downloadItem.id;
}

function updateDownloadProgress(id, progress) {
  const download = activeDownloads.find((item) => item.id === id);
  if (download) {
    download.progress = progress;
    notifyDownloadQueueUpdated();
  }
}

function removeFromDownloadQueue(id) {
  const index = activeDownloads.findIndex((item) => item.id === id);
  if (index !== -1) {
    activeDownloads.splice(index, 1);
    notifyDownloadQueueUpdated();
  }
}

function notifyDownloadQueueUpdated() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("download-queue-updated", activeDownloads);
  }
}

function clearDownloadQueue() {
  activeDownloads = [];
  notifyDownloadQueueUpdated();
}

// IPC handlers for download queue
ipcMain.handle("get-active-downloads", () => activeDownloads);

// --- CORE DOWNLOADER LOGIC ---
const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
let redgifsToken = null;

async function runDownloader(options, log) {
  log("[INFO] Starting download process...");
  isCancelled = false;
  isSkipping = false;

  activeProcesses.clear();
  activeAxiosControllers.clear();
  const downloadPath = store.get("downloadPath");
  if (!downloadPath) {
    log("[ERROR] Download location not set.");
    return;
  }
  const unhandledLogPath = path.join(downloadPath, "unhandled_links.log");
  try {
    fs.writeFileSync(
      unhandledLogPath,
      `--- Log for session started at ${new Date().toISOString()} ---\n`
    );
    log(`[INFO] Unhandled links will be saved to: ${unhandledLogPath}`);
  } catch (e) {
    log(`[ERROR] Could not write to unhandled_links.log: ${e.message}`);
  }
  await fsp.mkdir(downloadPath, { recursive: true });

  const jobsToProcess = options.subreddits.filter(
    (s) => s.status === "pending"
  );
  const totalJobs = jobsToProcess.length;
  if (totalJobs === 0) {
    log("[INFO] No pending items to download.");
    log("--- ALL JOBS COMPLETE ---");
    return;
  }
  log(`[INFO] ${totalJobs} items are pending download.`);
  if (mainWindow) {
    mainWindow.webContents.send("queue-progress", {
      current: 0,
      total: totalJobs,
    });
  }

  // --- Producer-Consumer Setup ---
  const downloadQueue = [];
  let activeDownloadsCount = 0;
  // Track active download counts per domain
  const activeDomainCounts = {};
  let totalLinksFound = 0;
  let completedLinks = 0;

  // --- Progress Tracking ---
  const jobProgress = new Map();
  jobsToProcess.forEach((job) => {
    jobProgress.set(job.url, { found: 0, completed: 0, isScraping: true });
  });

  const updateOverallProgress = () => {
    if (!mainWindow || isCancelled) return;

    let totalWeightedProgress = 0;
    let activeJobCount = 0;

    for (const [url, progress] of jobProgress.entries()) {
      activeJobCount++;
      if (progress.found > 0) {
        totalWeightedProgress += progress.completed / progress.found;
      } else if (!progress.isScraping) {
        // Scraping is done and found 0 files, so this job is 100% complete.
        totalWeightedProgress += 1;
      }
    }

    const overallPercentage =
      activeJobCount > 0 ? (totalWeightedProgress / activeJobCount) * 100 : 0;
    const currentJob = Math.floor(totalWeightedProgress);

    mainWindow.webContents.send("queue-progress", {
      current: currentJob,
      total: totalJobs,
    });
  };

  // --- Consumer: The Download Worker ---
  const downloadWorker = async () => {
    while (!isCancelled) {
      if (activeDownloadsCount >= MAX_SIMULTANEOUS_DOWNLOADS) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        continue;
      }

      let jobToDownload = null;
      let jobIndex = -1;

      // Find an available job in the queue that does not exceed per-domain concurrency
      for (let i = 0; i < downloadQueue.length; i++) {
        const job = downloadQueue[i];
        let domain = job.domain || "other";
        const isImageDownload = job.link.type === "image";
        const isMotherlessDomain = domain.includes("motherless.com");

        // --- Wildcard domain normalization ---
        // If the domain is a subdomain, try to match against any base domain in MAX_DOWNLOADS_PER_DOMAIN
        let normalizedDomain = domain;
        for (const baseDomain in MAX_DOWNLOADS_PER_DOMAIN) {
          if (baseDomain !== "default" && domain.endsWith(`.${baseDomain}`)) {
            normalizedDomain = baseDomain;
            break;
          }
        }

        // Determine max allowed for this domain
        const maxForDomain =
          MAX_DOWNLOADS_PER_DOMAIN[normalizedDomain] ??
          MAX_DOWNLOADS_PER_DOMAIN["default"] ??
          1;
        const currentForDomain = activeDomainCounts[normalizedDomain] || 0;

        //

        // Allow multiple concurrent downloads for images from motherless.com (legacy logic)
        if (
          (isImageDownload && isMotherlessDomain) ||
          currentForDomain < maxForDomain
        ) {
          jobToDownload = job;
          jobIndex = i;
          job._normalizedDomain = normalizedDomain; // Save for later decrement
          break;
        }
      }

      if (jobToDownload) {
        // Remove job from queue and start processing
        downloadQueue.splice(jobIndex, 1);
        activeDownloadsCount++;
        const domain = jobToDownload.domain || "other";
        const normalizedDomain = jobToDownload._normalizedDomain || domain;
        // Increment active count for this domain
        activeDomainCounts[normalizedDomain] =
          (activeDomainCounts[normalizedDomain] || 0) + 1;

        // --- Start the actual download ---
        let success = false;
        if (jobToDownload.link.downloader === "ytdlp") {
          success = await downloadWithYtDlp(
            jobToDownload.link.url,
            jobToDownload.subredditDir,
            log,
            jobToDownload.link.id,
            jobToDownload.link.title,
            jobToDownload.link.seriesFolder
          );
        } else if (jobToDownload.link.downloader === "multi-thread") {
          const sanitizedTitle = sanitizeTitleForFilename(
            jobToDownload.link.title
          );
          const urlObj = new URL(jobToDownload.link.url);
          let extension = path.extname(urlObj.pathname);
          if (!extension) extension = ".mp4";
          const fileName = `${sanitizedTitle}_${jobToDownload.link.id}${extension}`;
          const outputPath = path.join(jobToDownload.subredditDir, fileName);
          if (fs.existsSync(outputPath)) {
            success = false;
          } else {
            success = await downloadFileMultiThreaded(
              jobToDownload.link.url,
              outputPath,
              log,
              jobToDownload.link.id,
              jobToDownload.link.title
            );
          }
        } else {
          success = await downloadFile(
            jobToDownload.link.url,
            jobToDownload.subredditDir,
            log,
            jobToDownload.link.id,
            jobToDownload.link.title,
            jobToDownload.link.seriesFolder
          );
        }
        // --- Download finished ---

        activeDownloadsCount--;
        // Decrement active count for this domain
        if (activeDomainCounts[normalizedDomain]) {
          activeDomainCounts[normalizedDomain]--;
          if (activeDomainCounts[normalizedDomain] <= 0)
            delete activeDomainCounts[normalizedDomain];
        }
        // --- Mark item as completed in the main queue (options.subreddits) ---
        if (options && Array.isArray(options.subreddits)) {
          // Try to match by URL or ID
          const completedUrl =
            jobToDownload.sourceUrl || jobToDownload.link.url;
          for (const item of options.subreddits) {
            if (
              (item.url && item.url === completedUrl) ||
              (item.id && item.id === jobToDownload.link.id)
            ) {
              item.status = "completed";
              item.completedAt = Date.now();
            }
          }
          // Notify renderer/UI if needed
          if (mainWindow && !isCancelled) {
            mainWindow.webContents.send(
              "main-queue-updated",
              options.subreddits
            );
          }
        }
        completedLinks++;

        // Update progress for the specific job
        const progress = jobProgress.get(jobToDownload.sourceUrl);
        if (progress) {
          progress.completed++;
        }

        if (mainWindow && !isCancelled) {
          mainWindow.webContents.send("download-progress", {
            current: completedLinks,
            total: totalLinksFound,
          });
          updateOverallProgress();
        }
      } else {
        // No available jobs, wait a bit
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
  };

  // --- Producer: The Scraper ---
  const scrapingPromises = jobsToProcess.map(async (job) => {
    if (isCancelled) return;

    const { url: jobUrl, type, domain } = job;
    let subredditDir;

    if (type === "reddit") {
      // For Reddit: reddit.com/subreddit_name/ (subfolders for images/videos created later)
      const subredditName = extractName(jobUrl);
      if (!subredditName) {
        log(
          `[ERROR] Invalid Reddit URL, cannot determine subreddit name: ${jobUrl}`
        );
        subredditDir = path.join(downloadPath, "reddit.com", "invalid_url");
      } else {
        subredditDir = path.join(downloadPath, "reddit.com", subredditName);
      }
    } else {
      // For non-Reddit: use domain as before
      let folderName = domain || "other";
      if (domain === MOTHERLESS_HOST) {
        folderName = MOTHERLESS_HOST;
      }
      subredditDir = path.join(downloadPath, folderName);
    }

    await fsp.mkdir(subredditDir, { recursive: true });

    const displayName =
      type === "reddit"
        ? extractName(jobUrl) || "invalid_url"
        : domain === MOTHERLESS_HOST
        ? MOTHERLESS_HOST
        : domain || "other";
    log(`[INFO] [${displayName}] Starting scan...`);
    try {
      const links = await fetchAllMediaLinks(
        jobUrl,
        { ...options, type, domain },
        log,
        unhandledLogPath
      );
      log(`[INFO] [${displayName}] Found ${links.length} potential files.`);

      // Update progress tracking
      const progress = jobProgress.get(jobUrl);
      if (progress) {
        progress.found = links.length;
      }
      totalLinksFound += links.length;

      if (mainWindow) {
        mainWindow.webContents.send("download-progress", {
          current: completedLinks,
          total: totalLinksFound,
        });
        updateOverallProgress();
      }

      for (const link of links) {
        if (isCancelled) break;
        const linkDomainMatch = link.url.match(
          /https?:\/\/(?:www\.)?([^\/]+)/i
        );
        const linkDomain = linkDomainMatch ? linkDomainMatch[1] : "other";
        downloadQueue.push({
          link,
          subredditDir,
          domain: linkDomain,
          sourceUrl: jobUrl, // Link back to the original source job
        });
      }
    } catch (error) {
      log(
        `[ERROR] [${displayName}] An error occurred during scraping: ${error.stack}`
      );
    } finally {
      if (!isCancelled) {
        log(`[INFO] [${displayName}] Scan complete.`);
        const progress = jobProgress.get(jobUrl);
        if (progress) {
          progress.isScraping = false;
        }
        // A job is complete if scraping is finished and all its found files have been downloaded.
        // This covers the case of 0 files found, or all files being downloaded.
        if (
          progress &&
          !progress.isScraping &&
          progress.completed >= progress.found
        ) {
          if (mainWindow) {
            mainWindow.webContents.send("subreddit-complete", jobUrl);
          }
        }
        updateOverallProgress();
      }
    }
  });

  // Start download workers
  const workers = [];
  for (let i = 0; i < MAX_SIMULTANEOUS_DOWNLOADS; i++) {
    workers.push(downloadWorker());
  }

  // Wait for all scraping to finish
  await Promise.all(scrapingPromises);

  // After scraping is done, wait for the download queue to empty
  while (downloadQueue.length > 0 && !isCancelled) {
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  // And for active downloads to finish
  while (activeDownloadsCount > 0 && !isCancelled) {
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  // Final main-queue-updated event to ensure UI is in sync
  if (mainWindow && options && Array.isArray(options.subreddits)) {
    mainWindow.webContents.send("main-queue-updated", options.subreddits);
  }

  if (isCancelled) {
    log("--- DOWNLOADS CANCELLED BY USER ---");
  } else if (isSkipping) {
    log("--- DOWNLOADS SKIPPED BY USER ---");
  } else {
    log("--- ALL JOBS COMPLETE ---");
  }

  // Final cleanup signal to ensure workers exit if they haven't already
  isCancelled = true;
  await Promise.all(workers);
}

// Patch fetchAllMediaLinks to handle yt-dlp links directly
async function fetchAllMediaLinks(
  subredditUrl,
  options,
  log,
  unhandledLogPath
) {
  // --- ashemaletube.com custom logic ---
  try {
    const ashemaletubeMatch = subredditUrl.match(
      /^https?:\/\/(?:www\.)?ashemaletube\.com\/videos\//i
    );

    // --- womennaked.net gallery logic ---
    const womennakedMatch = subredditUrl.match(
      /^https?:\/\/(?:www\.)?womennaked\.net\//i
    );
    if (womennakedMatch) {
      log(`[INFO] Detected womennaked.net gallery page.`);
      const links = await scrapeWomennakedGallery(subredditUrl, log);
      log(`[INFO] [womennaked.net] Found ${links.length} images.`);
      log(`[INFO] [womennaked.net] Scan complete.`);
      return links;
    }

    // --- spankbang.com video page logic ---
    log(`[DEBUG] fetchAllMediaLinks called with URL: ${subredditUrl}`);
    const spankbangMatch = subredditUrl.match(
      /^https?:\/\/(?:[a-zA-Z0-9-]+\.)?spankbang\.com\//i
    );
    if (spankbangMatch) {
      log(`[INFO] Detected spankbang.com video page.`);
      const videoInfo = await extractSpankbangVideoUrl(subredditUrl, log);
      if (videoInfo && videoInfo.url) {
        log(`[SPANKBANG] Successfully extracted direct video URL.`);
        log(`[INFO] [spankbang.com] Found 1 potential file.`);
        log(`[INFO] [spankbang.com] Scan complete.`);
        return [
          {
            url: videoInfo.url,
            type: "video",
            downloader: "multi-thread",
            id: Date.now().toString(),
            title: videoInfo.title,
            domain: "spankbang.com",
          },
        ];
      } else {
        log(`[SPANKBANG] Could not extract video URL.`);
        log(`[INFO] [spankbang.com] Found 0 potential files.`);
        log(`[INFO] [spankbang.com] Scan complete.`);
        return [];
      }
    }

    // --- luxuretv.com video page logic (support all /video/ and /videos/ URLs, any subdomain) ---
    // Add debug log to see what URL is being passed
    log(`[DEBUG] fetchAllMediaLinks called with URL: ${subredditUrl}`);
    const luxuretvMatch = subredditUrl.match(
      /^https?:\/\/(?:[a-zA-Z0-9-]+\.)*luxuretv\.com\/(video|videos)\//i
    );
    if (luxuretvMatch) {
      // Normalize the URL to use base domain luxuretv.com
      let urlObj;
      try {
        urlObj = new URL(subredditUrl);
      } catch (e) {
        log(`[LUXURETV] Invalid URL: ${subredditUrl}`);
        return [];
      }
      urlObj.hostname = "luxuretv.com";
      const normalizedUrl = urlObj.toString();
      log(
        `[INFO] Detected luxuretv.com video page (normalized to base domain).`
      );
      const videoInfo = await extractLuxuretvVideoUrl(normalizedUrl, log);
      if (videoInfo && videoInfo.url) {
        log(`[LUXURETV] Successfully extracted direct video URL.`);
        log(`[INFO] [luxuretv.com] Found 1 potential file.`);
        log(`[INFO] [luxuretv.com] Scan complete.`);
        return [
          {
            url: videoInfo.url,
            type: "video",
            downloader: "multi-thread",
            id: Date.now().toString(),
            title: videoInfo.title,
            domain: "luxuretv.com",
          },
        ];
      } else {
        log(`[LUXURETV] Could not extract video URL.`);
        log(`[INFO] [luxuretv.com] Found 0 potential files.`);
        log(`[INFO] [luxuretv.com] Scan complete.`);
        return [];
      }
    }

    if (ashemaletubeMatch) {
      // Always extract the direct video URL with headless browser
      const urlObject = new URL(subredditUrl);
      const domain = urlObject.hostname.replace(/^www\./, "");
      log(`[INFO] Detected ashemaletube.com video page.`);
      const videoInfo = await extractAshemaletubeVideoUrl(subredditUrl, log);
      if (
        videoInfo &&
        videoInfo.url &&
        videoInfo.url.startsWith("https://cdn.ashemaletube.com/")
      ) {
        log(`[ASHEMALETUBE] Successfully extracted direct video URL.`);
        log(`[INFO] [ashemaletube.com] Found 1 potential file.`);
        log(`[INFO] [ashemaletube.com] Scan complete.`);
        // If FORCE_YTDLP_ONLY_HOSTS includes the domain, use yt-dlp for download
        if (
          FORCE_YTDLP_ONLY_HOSTS &&
          FORCE_YTDLP_ONLY_HOSTS.some((host) => domain.includes(host))
        ) {
          log(
            `[INFO] ashemaletube.com is in FORCE_YTDLP_ONLY_HOSTS, passing extracted link to yt-dlp.`
          );
          return [
            {
              url: videoInfo.url,
              type: "video",
              downloader: "ytdlp",
              id: Date.now().toString(),
              title: videoInfo.title,
            },
          ];
        } else {
          // Otherwise, use multi-threaded downloader
          return [
            {
              url: videoInfo.url,
              type: "video",
              downloader: "multi-thread",
              id: Date.now().toString(),
              title: videoInfo.title,
            },
          ];
        }
      } else {
        log(`[ASHEMALETUBE] Could not extract video URL.`);
        log(`[INFO] [ashemaletube.com] Found 0 potential files.`);
        log(`[INFO] [ashemaletube.com] Scan complete.`);
        return [];
      }
    }
  } catch (e) {
    log(`[ERROR] ashemaletube.com handler failed: ${e.message}`);
    log(`[INFO] [ashemaletube.com] Found 0 potential files.`);
    log(`[INFO] [ashemaletube.com] Scan complete.`);
    return [];
  }
  // --- Image Gallery Host Logic ---
  try {
    const urlObject = new URL(subredditUrl);
    const domain = urlObject.hostname.replace(/^www\./, "");

    if (domain === MOTHERLESS_HOST) {
      log(`[INFO] Detected Motherless host: ${domain}`);
      return await scrapeMotherlessPage(subredditUrl, log);
    }

    if (IMAGE_GALLERY_HOSTS.includes(domain)) {
      log(`[INFO] Detected image gallery host: ${domain}`);
      if (domain === "hentaiera.com") {
        // Match specific gallery pages
        if (urlObject.pathname.startsWith("/gallery/")) {
          return await scrapeHentaiEraGallery(subredditUrl, log);
        } else {
          // Assume any other hentaiera.com link is a collection page (artist, tag, search, etc.)
          log(`[INFO] Detected HentaiEra collection page: ${subredditUrl}`);
          return await scrapeHentaiEraCollection(subredditUrl, log);
        }
      }
    }
  } catch (e) {
    log(`[ERROR] Image gallery handler failed: ${e.message}`);
  }

  // --- heavy-r.com custom logic ---
  try {
    const heavyRVideoMatch = subredditUrl.match(
      /^https?:\/\/(?:www\.)?heavy-r\.com\/video\/[^\/]+\/?/i
    );
    const heavyRProfileMatch = subredditUrl.match(
      /^https?:\/\/(?:www\.)?heavy-r\.com\/user\/([^\/?#]+)/i
    );
    if (heavyRVideoMatch) {
      log(`[INFO] Detected heavy-r.com video page.`);
      const videoInfo = await scrapeHeavyRVideoPage(subredditUrl, log);
      if (videoInfo && videoInfo.url) {
        return [
          {
            url: videoInfo.url,
            type: "video",
            downloader: "axios",
            id: Date.now().toString(),
            title: videoInfo.title,
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
          if (isCancelled) break;
          const pageUrl = `https://www.heavy-r.com/user/${username}?pro=${section}&p=${page}`;
          log(
            `[INFO] [heavy-r] Scanning ${section} page ${page} for user ${username}...`
          );
          const pageLinks = await scrapeHeavyRProfileSection(pageUrl, log);
          if (pageLinks.length === 0) {
            keepGoing = false;
          } else {
            allPageLinks.push(...pageLinks);
            page++;
          }
        }
        if (isCancelled) break;
      }

      if (isCancelled) {
        log(`[INFO] Scan for heavy-r profile ${username} cancelled.`);
        return [];
      }

      log(
        `[INFO] [heavy-r] Found ${allPageLinks.length} video pages for profile ${username}. Now extracting direct links...`
      );

      // Step 2 & 3: Extract direct URLs and create final job list
      const directVideoJobs = [];
      for (const pageLink of allPageLinks) {
        if (isCancelled) break;
        const videoInfo = await scrapeHeavyRVideoPage(pageLink.url, log);
        if (videoInfo && videoInfo.url) {
          directVideoJobs.push({
            url: videoInfo.url,
            type: "video",
            downloader: "axios",
            id: pageLink.id,
            title: videoInfo.title,
          });
        } else {
          log(
            `[ERROR] Could not extract video from heavy-r.com page: ${pageLink.url}`
          );
        }
      }

      log(
        `[INFO] [heavy-r] Extracted ${directVideoJobs.length} direct video links.`
      );
      return directVideoJobs;
    }
  } catch (e) {
    log(`[ERROR] heavy-r.com handler failed: ${e.message}`);
  }
  // --- qosvideos.com custom logic ---
  try {
    const qosvideosMatch = subredditUrl.match(
      /^https?:\/\/(?:www\.)?qosvideos\.com\/\S+/i
    );
    if (qosvideosMatch) {
      log(`[INFO] Detected qosvideos.com video page.`);
      const videoInfo = await scrapeQosvideosPage(subredditUrl, log);
      if (videoInfo && videoInfo.url) {
        return [
          {
            url: videoInfo.url,
            type: "video",
            downloader: "ytdlp",
            id: Date.now().toString(),
            title: videoInfo.title,
          },
        ];
      } else {
        log(`[ERROR] Could not extract video from qosvideos.com page.`);
        return [];
      }
    }
  } catch (e) {
    log(`[ERROR] qosvideos.com handler failed: ${e.message}`);
  }
  // --- pmvhaven.com custom logic ---
  try {
    const pmvhavenProfileMatch = subredditUrl.match(
      /^https?:\/\/(?:www\.)?pmvhaven\.com\/profile\/([^\/?#]+)/i
    );
    const pmvhavenVideoMatch = subredditUrl.match(
      /^https?:\/\/(?:www\.)?pmvhaven\.com\/video\//i
    );
    if (pmvhavenProfileMatch) {
      const username = pmvhavenProfileMatch[1];
      log(`[INFO] Detected pmvhaven.com profile: ${username}`);
      const links = await fetchPmvhavenProfileVideos(username, appLog);
      log(
        `[INFO] [pmvhaven] Found ${links.length} videos/favorites for profile ${username}.`
      );
      return links;
    }
    if (pmvhavenVideoMatch) {
      // Direct video, handled by yt-dlp
      return [
        {
          url: subredditUrl,
          type: "video",
          downloader: "ytdlp",
          id: Date.now().toString(),
          title: subredditUrl,
        },
      ];
    }
  } catch (e) {
    log(`[ERROR] pmvhaven.com handler failed: ${e.message}`);
  }

  // --- crazyshit.com series page handler ---
  try {
    // Detect crazyshit.com series page: e.g. https://crazyshit.com/series/shitty-days_10/
    const crazyshitSeriesMatch = subredditUrl.match(
      /^https?:\/\/(?:www\.)?crazyshit\.com\/series\/([^\/?#]+)\/?/i
    );
    if (crazyshitSeriesMatch) {
      const seriesName = crazyshitSeriesMatch[1];
      log(`[INFO] Detected crazyshit.com series: ${seriesName}`);
      const links = await scrapeCrazyshitSeriesPage(subredditUrl, log);
      // Add seriesFolder property for subfolder organization
      links.forEach((link) => {
        link.seriesFolder = seriesName;
      });
      log(
        `[INFO] [crazyshit.com] Found ${links.length} videos in series '${seriesName}'.`
      );
      return links;
    }
  } catch (e) {
    log(`[ERROR] crazyshit.com handler failed: ${e.message}`);
  }

  if (options.type === "ytdlp" && options.domain) {
    const domain = options.domain;
    // --- Bypass logic for specific hosts ---
    if (FORCE_YTDLP_ONLY_HOSTS.some((host) => domain.includes(host))) {
      log(
        `[INFO] Bypassing multi-thread for ${domain}, using yt-dlp directly.`
      );
      return [
        {
          url: subredditUrl,
          type: "video",
          downloader: "ytdlp",
          id: Date.now().toString(),
          title: subredditUrl,
        },
      ];
    }
    // Only use yt-dlp extraction for domains in HYBRID_EXTRACTION_HOSTS
    if (HYBRID_EXTRACTION_HOSTS.some((host) => domain.includes(host))) {
      log(`[INFO] Using hybrid extraction for ${domain}`);
      // Use yt-dlp for URL extraction, then multi-threaded download
      const extractedInfo = await extractVideoUrlWithYtDlp(
        subredditUrl,
        log,
        Date.now().toString(),
        subredditUrl
      );
      if (extractedInfo && extractedInfo.url) {
        return [
          {
            url: extractedInfo.url,
            type: "video",
            downloader: "multi-thread", // Use multi-threaded downloader
            id: Date.now().toString(),
            title: extractedInfo.title || subredditUrl,
          },
        ];
      } else {
        log(
          `[INFO] Hybrid extraction failed, falling back to regular yt-dlp for ${domain}`
        );
        // Fallback to regular yt-dlp download if extraction fails
        return [
          {
            url: subredditUrl,
            type: "video",
            downloader: "ytdlp",
            id: Date.now().toString(),
            title: subredditUrl,
          },
        ];
      }
    }
    // If not in HYBRID_EXTRACTION_HOSTS, do NOT use yt-dlp by default
    // Do not log or return here; allow default scraping logic to run below
  }

  // Only run the generic Reddit/post scraping logic for Reddit URLs
  const isReddit = subredditUrl.match(/reddit\.com\//i);
  if (isReddit) {
    let allLinks = [];
    let after = null;
    let postCount = 0;
    let currentPage = 1;
    const hasPageEnd =
      options.pageEnd > 0 && options.pageEnd >= options.pageStart;
    const fetchOptions = {
      headers: { "User-Agent": BROWSER_USER_AGENT, Cookie: "over18=1" },
    };

    log(
      `[INFO] Scanning for up to ${options.maxLinks || "unlimited"} links...`
    );

    do {
      if (isCancelled || isSkipping) {
        log(`[INFO] Scan for ${extractName(subredditUrl)} cancelled.`);
        break;
      }
      if (options.maxLinks > 0 && allLinks.length >= options.maxLinks) {
        log(`[INFO] Reached download limit of ${options.maxLinks}.`);
        break;
      }
      if (hasPageEnd && currentPage > options.pageEnd) {
        log(`[INFO] Reached page limit of ${options.pageEnd}.`);
        break;
      }
      // This is the correct way to detect the end of a listing
      if (currentPage > 1 && !after) {
        log(`[INFO] No more pages available from Reddit API.`);
        break;
      } // --- Page Skipping Logic ---

      if (currentPage < options.pageStart) {
        const skipUrl = new URL(`${subredditUrl.replace(/\/$/, "")}.json`);
        skipUrl.searchParams.set("limit", "25");
        if (after) skipUrl.searchParams.set("after", after);

        log(
          `[INFO] Skipping page ${currentPage} to reach start page ${options.pageStart}...`
        );
        try {
          const tempResponse = await fetch(skipUrl.toString(), fetchOptions);
          const tempData = await tempResponse.json();
          if (!tempData.data?.after) {
            after = null;
            break;
          }
          after = tempData.data.after;
          currentPage++;
          continue;
        } catch (e) {
          log(`[ERROR] Failed to skip page ${currentPage}. Stopping scan.`);
          break;
        }
      }

      const url = new URL(`${subredditUrl.replace(/\/$/, "")}.json`);
      url.searchParams.set("limit", "25");
      url.searchParams.set("count", postCount); // Pass the total posts seen so far
      if (after) url.searchParams.set("after", after);

      log(`[INFO] Fetching page ${currentPage} (API count: ${postCount})`);

      try {
        const response = await fetch(url.toString(), fetchOptions);
        if (!response.ok) {
          log(
            `[ERROR] Fetch failed for ${extractName(subredditUrl)}. Status: ${
              response.status
            }`
          );
          break;
        }
        const data = await response.json();
        if (!data.data?.children?.length) {
          log(`[INFO] No more posts found on this page.`);
          break;
        }
        const posts = data.data.children;
        for (const post of posts) {
          if (options.maxLinks > 0 && allLinks.length >= options.maxLinks) {
            after = null;
            break;
          }
          const mediaFromPost = await extractMediaUrlsFromPost(
            post.data,
            log,
            unhandledLogPath
          );
          allLinks.push(...mediaFromPost);
        }

        postCount += posts.length; // Correctly increment the total count
        after = data.data.after; // Get the 'after' token for the next page
        currentPage++;
        if (!after) {
          log(`[INFO] Reached the end of the subreddit listing.`);
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      } catch (error) {
        log(
          `[FATAL] A network error occurred while fetching ${subredditUrl}: ${error.message}`
        );
        break;
      }
    } while (true); // The loop is now broken internally by logic, not just the 'after' token

    log(
      `[INFO] Scan complete. Found ${allLinks.length} potential links after scanning ${postCount} posts.`
    );
    const filteredLinks = allLinks.filter(
      (link) =>
        (options.fileTypes.images && link.type === "image") ||
        (options.fileTypes.gifs && link.type === "gif") ||
        (options.fileTypes.videos && link.type === "video")
    );
    if (options.maxLinks > 0) return filteredLinks.slice(0, options.maxLinks);
    return filteredLinks;
  }
  // If not Reddit and not handled above, return empty
  return [];
}

// --- pmvhaven.com profile/favorites POST helper ---
async function fetchPmvhavenProfileVideos(username, log) {
  const apiUrl = "https://pmvhaven.com/api/v2/profileInput";
  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0",
    Accept: "*/*",
    "Accept-Language": "en-US,en;q=0.5",
    "Content-Type": "text/plain;charset=UTF-8",
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
    Priority: "u=4",
    Pragma: "no-cache",
    "Cache-Control": "no-cache",
    Referer: `https://pmvhaven.com/profile/${username}`,
  };

  // Each entry: { mode, getMoreMode, extraFields }
  const sections = [
    {
      mode: "getProfileVideos",
      getMoreMode: "GetMoreProfileVideos",
      extraFields: {},
    },
    {
      mode: "getProfileFavorites",
      getMoreMode: "GetMoreFavoritedVideos",
      extraFields: { search: null, date: "Date", sort: "Sort" },
    },
  ];

  let allVideos = [];

  for (const section of sections) {
    let page = 1;
    let totalCount = null;
    let collected = 0;
    let perPage = 0;
    let done = false;

    // First request (mode: getProfileVideos or getProfileFavorites)
    try {
      const body = JSON.stringify({
        user: username,
        mode: section.mode,
        ...section.extraFields,
      });
      const response = await axios.post(apiUrl, body, { headers });
      if (
        response.status === 200 &&
        response.data &&
        Array.isArray(response.data.videos)
      ) {
        const videos = response.data.videos;
        totalCount = response.data.count || videos.length;
        perPage = videos.length;
        collected += videos.length;
        appLog(
          `[INFO] ${
            section.mode === "getProfileVideos" ? "Profile Videos" : "Favorites"
          } - Parsing page 1 : found ${videos.length} videos.`
        );
        for (const video of videos) {
          if (video.url) {
            allVideos.push({
              url: video.url,
              type: "video",
              downloader: "ytdlp",
              id: video._id || `${username}_${section.mode}_${video.title}`,
              title: video.title || `${username}_${section.mode}`,
            });
          }
        }
        // If all videos are already collected, skip pagination
        if (collected >= totalCount) continue;
      } else {
        continue;
      }
    } catch (err) {
      log(
        `[ERROR] pmvhaven.com ${section.mode} fetch failed for ${username}: ${err.message}`
      );
      continue;
    }

    // Paginate for remaining videos
    page = 2;
    while (collected < totalCount) {
      try {
        let bodyObj = {
          user: username,
          index: page,
          mode: section.getMoreMode,
          ...section.extraFields,
        };
        const body = JSON.stringify(bodyObj);
        const response = await axios.post(apiUrl, body, { headers });
        let videos = [];
        if (response.status === 200 && response.data) {
          if (Array.isArray(response.data.videos)) {
            videos = response.data.videos;
          } else if (Array.isArray(response.data.data)) {
            videos = response.data.data;
          }
        }
        appLog(
          `[INFO] ${
            section.mode === "getProfileVideos" ? "Profile Videos" : "Favorites"
          } - Parsing page ${page} : found ${videos.length} videos.`
        );
        if (videos.length === 0) break;
        collected += videos.length;
        for (const video of videos) {
          if (video.url) {
            allVideos.push({
              url: video.url,
              type: "video",
              downloader: "ytdlp",
              id:
                video._id ||
                `${username}_${section.getMoreMode}_${video.title}`,
              title: video.title || `${username}_${section.getMoreMode}`,
            });
          }
        }
        page++;
      } catch (err) {
        log(
          `[ERROR] pmvhaven.com ${section.getMoreMode} page ${page} fetch failed for ${username}: ${err.message}`
        );
        break;
      }
    }
  }
  return allVideos;
}

async function getRedgifsToken(log) {
  if (redgifsToken) return redgifsToken;
  try {
    log("[Auth] Requesting Redgifs token...");
    const response = await fetch("https://api.redgifs.com/v2/auth/temporary", {
      headers: { "User-Agent": BROWSER_USER_AGENT },
    });
    if (!response.ok) throw new Error(`Status: ${response.status}`);
    const data = await response.json();
    if (data?.token) {
      redgifsToken = data.token;
      return redgifsToken;
    }
    throw new Error("Invalid token format.");
  } catch (error) {
    log(`[Auth] Redgifs token error: ${error.message}`);
    return null;
  }
}

async function getHeavyRCookiesAndHtml(targetUrl) {
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

async function scrapeHeavyRVideoPage(pageUrl, log) {
  try {
    console.log("running getheavyrcookiesandhtml");
    const { cookieHeader, html } = await getHeavyRCookiesAndHtml(pageUrl);
    // Output the HTML to the terminal for debugging
    console.log("finished");
    // Use cheerio for robust extraction
    const cheerio = require("cheerio");
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

async function scrapeHeavyRProfileSection(pageUrl, log) {
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
    // Output the HTML to the terminal for debugging
    // console.log("=== heavy-r.com HTML response START ===");
    // console.log(html);
    // console.log("=== heavy-r.com HTML response END ===");
    // Find all video links in the section
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

async function scrapeQosvideosPage(pageUrl, log) {
  try {
    const response = await axios.get(pageUrl, {
      headers: { "User-Agent": BROWSER_USER_AGENT },
    });
    const html = response.data;
    // Extract contentURL
    const contentUrlMatch = html.match(
      /<meta\s+itemprop="contentURL"\s+content="([^"]+)"/i
    );
    // Extract name
    const nameMatch = html.match(
      /<meta\s+itemprop="name"\s+content="([^"]+)"/i
    );
    if (contentUrlMatch && contentUrlMatch[1]) {
      return {
        url: contentUrlMatch[1],
        title: nameMatch && nameMatch[1] ? nameMatch[1] : "qosvideos_video",
      };
    }
  } catch (err) {
    log(`[ERROR] Failed to scrape qosvideos.com page: ${err.message}`);
  }
  return null;
}

// --- HentaiEra.com Gallery Scraper ---
async function scrapeHentaiEraGallery(galleryUrl, log) {
  log(`[INFO] Scraping gallery: ${galleryUrl}`);
  try {
    const response = await axios.get(galleryUrl, {
      headers: { "User-Agent": BROWSER_USER_AGENT },
    });
    const html = response.data;
    const cheerio = require("cheerio");
    const $ = cheerio.load(html);

    // 1. Extract gallery title for subfolder
    const galleryTitle = $("h1").first().text().trim();
    if (!galleryTitle) {
      log("[HentaiEra] Could not find gallery title.");
      return [];
    }
    const subfolderName = sanitizeTitleForFilename(galleryTitle);

    // 2. Extract the image data from the script tag
    const scriptTag = $("script")
      .filter((i, el) => {
        return $(el).html().includes("var g_th = $.parseJSON");
      })
      .html();

    if (!scriptTag) {
      log("[HentaiEra] Could not find the g_th script tag.");
      return [];
    }

    const jsonMatch = scriptTag.match(/parseJSON\('(.+?)'\);/);
    if (!jsonMatch || !jsonMatch[1]) {
      log("[HentaiEra] Could not extract JSON from script tag.");
      return [];
    }

    const imagesJson = JSON.parse(jsonMatch[1]);

    // 3. Get the base URL from a thumbnail
    const thumbSrc = $("#append_thumbs .gthumb a img").first().attr("data-src");
    if (!thumbSrc) {
      log("[HentaiEra] Could not find a thumbnail source to build base URL.");
      return [];
    }
    const baseUrl = thumbSrc.substring(0, thumbSrc.lastIndexOf("/") + 1);

    // 4. Helper to get file extension
    const getFileExtension = (key) => {
      if (key === "j") return ".jpg";
      if (key === "p") return ".png";
      if (key === "b") return ".bmp";
      if (key === "g") return ".gif";
      if (key === "w") return ".webp";
      return ".jpg"; // Default
    };

    // 5. Build the list of download jobs
    const downloadJobs = [];
    for (const pageNum in imagesJson) {
      const imageData = imagesJson[pageNum];
      const extKey = imageData.split(",")[0];
      const extension = getFileExtension(extKey);
      const imageUrl = `${baseUrl}${pageNum}${extension}`;

      downloadJobs.push({
        url: imageUrl,
        type: "image",
        downloader: "axios", // Use the standard single-threaded downloader
        id: `${subfolderName}_${pageNum}`, // Unique ID for tracking
        title: `page_${pageNum}`, // Simple title to prevent long filenames
        // Custom property to tell the downloader to use a subfolder
        seriesFolder: subfolderName,
      });
    }

    log(
      `[HentaiEra] Found ${downloadJobs.length} images in gallery "${galleryTitle}".`
    );
    return downloadJobs;
  } catch (error) {
    log(`[HentaiEra] Failed to scrape gallery ${galleryUrl}: ${error.message}`);
    return [];
  }
}

// --- HentaiEra.com Collection Scraper ---
async function scrapeHentaiEraCollection(collectionUrl, log) {
  log(`[HentaiEra] Scraping collection: ${collectionUrl}`);
  const allGalleryLinks = new Set(); // Use a Set to avoid duplicate gallery links
  let allDownloadJobs = [];
  let collectionFolderName = null;

  try {
    const baseUrl = new URL(collectionUrl).origin;
    let nextUrl = collectionUrl;
    let isFirstPage = true;

    while (nextUrl) {
      if (isCancelled) {
        log(`[INFO] Collection scan cancelled.`);
        break;
      }
      log(`[INFO] Scanning page: ${nextUrl}`);
      const response = await axios.get(nextUrl, {
        headers: { "User-Agent": BROWSER_USER_AGENT },
      });
      const html = response.data;
      const cheerio = require("cheerio");
      const $ = cheerio.load(html);

      // On the first page, extract the collection name for the subfolder.
      if (isFirstPage) {
        const collectionTitle =
          $("h1.tag_title span.search_key").first().text().trim() ||
          $("h1.tag_title").first().text().trim();
        if (collectionTitle) {
          // Clean up title like "Read all 1,075 crimson XXX Galleries"
          const cleanedTitle = collectionTitle
            .replace(/Read all [\d,]+/, "")
            .replace(/XXX Galleries/, "")
            .trim();
          // Sanitize for directory name, using a shorter length limit
          collectionFolderName = sanitizeTitleForFilename(cleanedTitle, 80);
          log(
            `[HentaiEra] Determined collection folder: ${collectionFolderName}`
          );
        } else {
          log("[HentaiEra] Could not determine collection folder name.");
        }
        isFirstPage = false;
      }

      // Extract gallery links from the current page
      $("div.thumb h2.gallery_title a").each((i, el) => {
        const galleryPath = $(el).attr("href");
        if (galleryPath) {
          const fullUrl = new URL(galleryPath, baseUrl).href;
          allGalleryLinks.add(fullUrl);
        }
      });

      // Find the link to the next page
      const nextLinkElement = $("ul.pagination a:contains('Next')");
      if (
        nextLinkElement.length > 0 &&
        nextLinkElement.attr("href") &&
        !nextLinkElement.parent().hasClass("disabled")
      ) {
        let nextPath = nextLinkElement.attr("href");
        if (nextPath.startsWith("//")) {
          nextUrl = "https:" + nextPath;
        } else {
          nextUrl = new URL(nextPath, baseUrl).href;
        }
      } else {
        nextUrl = null; // No more pages
      }
      // Add a small delay to avoid getting blocked
      if (nextUrl) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    log(
      `[HentaiEra] Found ${allGalleryLinks.size} unique galleries. Now scraping individual galleries...`
    );

    // Now scrape each gallery found
    const galleryUrls = Array.from(allGalleryLinks);
    for (let i = 0; i < galleryUrls.length; i++) {
      const galleryUrl = galleryUrls[i];
      if (isCancelled) {
        log(`[HentaiEra] Gallery scraping cancelled.`);
        break;
      }
      log(
        `[HentaiEra] Scraping gallery ${i + 1} of ${
          galleryUrls.length
        }: ${galleryUrl}`
      );
      const galleryJobs = await scrapeHentaiEraGallery(galleryUrl, log);

      // Prepend the collection folder to the series folder for each job
      if (collectionFolderName && galleryJobs.length > 0) {
        galleryJobs.forEach((job) => {
          if (job.seriesFolder) {
            job.seriesFolder = path.join(
              collectionFolderName,
              job.seriesFolder
            );
          }
        });
      }

      allDownloadJobs.push(...galleryJobs);
    }

    return allDownloadJobs;
  } catch (error) {
    log(
      `[ERROR] Failed to scrape collection ${collectionUrl}: ${error.message}`
    );
    return [];
  }
}

async function scrapeImgurAlbum(albumUrl, log) {
  const images = [];
  try {
    const response = await axios.get(albumUrl, {
      headers: { "User-Agent": BROWSER_USER_AGENT },
    });
    const html = response.data;
    const match = html.match(/<script>window.postDataJSON\s*=\s*'({.+})'/);
    if (match && match[1]) {
      const postData = JSON.parse(match[1]);
      if (postData.media && Array.isArray(postData.media)) {
        log(`[Imgur Album] Found ${postData.media.length} images in album.`);
        for (const image of postData.media) {
          images.push(`https://i.imgur.com/${image.id}${image.ext}`);
        }
      }
    } else {
      const imageMatches = html.matchAll(
        /"hash":"([a-zA-Z0-9]+)".*?"ext":"(\.[a-zA-Z0-9]+)"/g
      );
      let foundImages = new Set();
      for (const imgMatch of imageMatches) {
        foundImages.add(`https://i.imgur.com/${imgMatch[1]}${imgMatch[2]}`);
      }
      if (foundImages.size > 0) {
        log(`[Imgur Album] Fallback scraper found ${foundImages.size} images.`);
        images.push(...foundImages);
      }
    }
  } catch (error) {
    log(
      `[Parser] Failed to scrape Imgur album at ${albumUrl}: ${error.message}`
    );
  }
  return images;
}

async function scrapeXhamsterPage(pageUrl) {
  try {
    const response = await axios.get(pageUrl, {
      headers: { "User-Agent": BROWSER_USER_AGENT },
    });
    const html = response.data;
    const match = html.match(/'video_url'\s*:\s*'([^']+)'/);
    if (match && match[1]) {
      return JSON.parse(`"${match[1]}"`);
    }
  } catch (error) {
    /* Fails silently */
  }
  return null;
}

// --- crazyshit.com custom logic ---
async function scrapeCrazyshitSeriesPage(seriesUrl, log) {
  try {
    const axiosResponse = await axios.get(seriesUrl, {
      headers: { "User-Agent": BROWSER_USER_AGENT },
    });
    const html = axiosResponse.data;
    const cheerio = require("cheerio");
    const $ = cheerio.load(html);
    const videoLinks = [];
    // Find all <a class="thumb"> inside <div class="tile">
    $("div.tile a.thumb").each((i, el) => {
      const href = $(el).attr("href");
      const title =
        $(el).attr("title") ||
        $(el).find("img[alt]").attr("alt") ||
        "crazyshit_video";
      if (href && href.includes("/cnt/medias/")) {
        videoLinks.push({
          url: href,
          type: "video",
          downloader: "ytdlp",
          id: `${Date.now()}_${i}`,
          title: title.trim(),
        });
      }
    });
    return videoLinks;
  } catch (err) {
    log(`[ERROR] Failed to scrape crazyshit.com series page: ${err.message}`);
    return [];
  }
}

async function extractMediaUrlsFromPost(
  originalPostData,
  log,
  unhandledLogPath
) {
  const postData =
    originalPostData.crosspost_parent_list?.[0] || originalPostData;
  const urls = [];
  const {
    url: postUrl,
    id: postId,
    title: postTitle,
    domain,
    is_video,
    secure_media,
    is_gallery,
    media_metadata,
  } = postData;
  try {
    if (postUrl.includes("/comments/")) {
      return urls;
    }
    if (is_video || domain === "v.redd.it") {
      if (secure_media?.reddit_video)
        urls.push({
          url: secure_media.reddit_video.fallback_url.split("?")[0],
          type: "video",
          downloader: "axios",
          id: postId,
          title: postTitle,
        });
    } else if (domain === "i.redd.it" || domain.includes("redd.it")) {
      // Clean any amp; entities from Reddit URLs (remove all instances of "amp;")
      const cleanUrl = postUrl.replace(/amp;/g, "");
      urls.push({
        url: cleanUrl,
        type: "image",
        downloader: "axios",
        id: postId,
        title: postTitle,
      });
    } else if (is_gallery && media_metadata) {
      Object.values(media_metadata).forEach((item, i) => {
        if (item?.s?.u) {
          // Clean any amp; entities from Reddit gallery URLs (remove all instances of "amp;")
          const cleanUrl = item.s.u.replace(/amp;/g, "");
          urls.push({
            url: cleanUrl,
            type: "image",
            downloader: "axios",
            id: `${postId}_${i}`,
            title: postTitle,
          });
        }
      });
    } else if (domain.includes("redgifs.com")) {
      const token = await getRedgifsToken(log);
      if (token) {
        const slug = postUrl.split("/").pop();
        const apiUrl = `https://api.redgifs.com/v2/gifs/${slug}`;
        const apiResponse = await fetch(apiUrl, {
          headers: {
            Authorization: `Bearer ${token}`,
            "User-Agent": BROWSER_USER_AGENT,
          },
        });
        if (apiResponse.ok) {
          const apiData = await apiResponse.json();
          if (apiData?.gif?.urls?.hd)
            urls.push({
              url: apiData.gif.urls.hd,
              type: "video",
              downloader: "axios",
              id: postId,
              title: postTitle,
            });
        }
      }
    } else if (domain.includes("imgur.com")) {
      if (postUrl.includes("/a/") || postUrl.includes("/gallery/")) {
        const albumImages = await scrapeImgurAlbum(postUrl, log);
        albumImages.forEach((imageUrl, i) => {
          urls.push({
            url: imageUrl,
            type: "image",
            downloader: "axios",
            id: `${postId}_${i}`,
            title: postTitle,
          });
        });
      } else {
        let directUrl = postUrl;
        if (postUrl.endsWith(".gifv")) {
          directUrl = postUrl.replace(".gifv", ".mp4");
        } else if (!postUrl.endsWith(".jpg") && !postUrl.endsWith(".png")) {
          directUrl = `${postUrl}.jpg`;
        }
        urls.push({
          url: directUrl,
          type: "image",
          downloader: "axios",
          id: postId,
          title: postTitle,
        });
      }
    } else if (domain.includes("xhamster.com")) {
      const directVideoUrl = await scrapeXhamsterPage(postUrl);
      if (directVideoUrl) {
        urls.push({
          url: directVideoUrl,
          type: "video",
          downloader: "axios",
          id: postId,
          title: postTitle,
        });
      }
    } else if (FORCE_YTDLP_ONLY_HOSTS.some((host) => domain.includes(host))) {
      // Force yt-dlp for bypass hosts
      urls.push({
        url: postUrl,
        type: "video",
        downloader: "ytdlp",
        id: postId,
        title: postTitle,
      });
    } else if (HYBRID_EXTRACTION_HOSTS.some((host) => domain.includes(host))) {
      // Use yt-dlp for URL extraction, then multi-threaded download
      const extractedInfo = await extractVideoUrlWithYtDlp(
        postUrl,
        log,
        postId,
        postTitle
      );
      if (extractedInfo && extractedInfo.url) {
        urls.push({
          url: extractedInfo.url,
          type: "video",
          downloader: "multi-thread", // Use multi-threaded downloader
          id: postId,
          title: extractedInfo.title || postTitle,
        });
      } else {
        // Fallback to regular yt-dlp download if extraction fails
        urls.push({
          url: postUrl,
          type: "video",
          downloader: "ytdlp",
          id: postId,
          title: postTitle,
        });
      }
    } else {
      // --- crazyshit.com series page: skip direct yt-dlp, let fetchAllMediaLinks handle ---
      if (domain.includes("crazyshit.com") && /\/series\//i.test(postUrl)) {
        // Do not push, let fetchAllMediaLinks handle series
      } else if (YTDLP_SUPPORTED_HOSTS.some((host) => domain.includes(host))) {
        urls.push({
          url: postUrl,
          type: "video",
          downloader: "ytdlp",
          id: postId,
          title: postTitle,
        });
      } else {
        fs.appendFileSync(unhandledLogPath, `${postUrl}\n`);
      }
    }
  } catch (error) {
    log(`[Parser] Failed for post "${postTitle}": ${error.message}`);
  }
  return urls;
}

async function downloadWithYtDlp(
  url,
  outputDir,
  log,
  postId,
  postTitle,
  seriesFolder
) {
  return new Promise((resolve) => {
    const sanitizedTitle = sanitizeTitleForFilename(postTitle);
    const fileNameTemplate = `${sanitizedTitle}_${postId}.%(ext)s`;
    let outputPath;
    if (seriesFolder) {
      outputPath = path.join(outputDir, seriesFolder, fileNameTemplate);
    } else if (outputDir.includes(path.join("reddit.com"))) {
      // For Reddit downloads, organize into videos subfolder (yt-dlp typically handles videos)
      outputPath = path.join(outputDir, "videos", fileNameTemplate);
    } else {
      outputPath = path.join(outputDir, fileNameTemplate);
    }
    try {
      let dirToCheck;
      if (seriesFolder) {
        dirToCheck = path.join(outputDir, seriesFolder);
      } else if (outputDir.includes(path.join("reddit.com"))) {
        dirToCheck = path.join(outputDir, "videos");
      } else {
        dirToCheck = outputDir;
      }

      // Always ensure the directory exists
      if (!fs.existsSync(dirToCheck)) {
        fs.mkdirSync(dirToCheck, { recursive: true });
      }

      const filesInDir = fs.readdirSync(dirToCheck);
      const baseName = `${sanitizedTitle}_${postId}`;
      const fileExists = filesInDir.some(
        (file) => path.parse(file).name === baseName
      );
      if (fileExists) {
        log(`[INFO] Skipping duplicate (yt-dlp): ${baseName}`);
        return resolve(false);
      }
    } catch (e) {
      log(
        `[ERROR] Could not read directory to check for duplicates: ${e.message}`
      );
    }
    const ytDlpPath = getYtDlpPath();
    if (!fs.existsSync(ytDlpPath)) {
      log(`[YTDLP-ERROR] Cannot start download, yt-dlp.exe not found.`);
      return resolve(false);
    }
    const args = [
      "--no-playlist",
      "--quiet",
      "--progress",
      "--concurrent-fragments",
      YTDLP_CONCURRENT_FRAGMENTS.toString(),
      "--extractor-args",
      "generic:impersonate=firefox_windows",
      "-o",
      outputPath,
      url,
    ];
    log(`[INFO] Starting Download: ${postTitle}`);

    // Add to download queue
    const queueId = addToDownloadQueue(url, postTitle, postId);

    const ytDlpProcess = spawn(ytDlpPath, args);

    // Track this process for hard stop functionality
    activeProcesses.add(ytDlpProcess);

    ytDlpProcess.stdout.on("data", (data) => {
      const output = data.toString();
      const progressMatch = output.match(/\[download\]\s+([\d\.]+)%/);
      if (progressMatch && progressMatch[1]) {
        const percent = parseFloat(progressMatch[1]);
        // Update individual download progress
        updateDownloadProgress(queueId, percent);
        if (mainWindow) {
          mainWindow.webContents.send("ytdlp-progress", {
            percent,
            title: sanitizedTitle,
          });
        }
      }
    });
    ytDlpProcess.stderr.on("data", (data) => {
      log(`[YTDLP-INFO] ${data.toString()}`);
    });
    ytDlpProcess.on("close", (code) => {
      // Remove from active processes when done
      activeProcesses.delete(ytDlpProcess);

      if (isCancelled) {
        removeFromDownloadQueue(queueId);
        log(`[INFO] Download cancelled: ${sanitizedTitle}`);
        resolve(false);
        return;
      }

      if (code === 0) {
        removeFromDownloadQueue(queueId);
        log(`[SUCCESS] Download Finished: ${sanitizedTitle}`);
        resolve(true);
      } else {
        removeFromDownloadQueue(queueId);
        log(`[YTDLP-ERROR] Process exited with code ${code} for URL: ${url}`);
        const unhandledLogPath = path.join(
          store.get("downloadPath"),
          "unhandled_links.log"
        );
        fs.appendFileSync(unhandledLogPath, `${url}\n`);
        resolve(false);
      }
    });
    ytDlpProcess.on("error", (err) => {
      // Remove from active processes on error
      activeProcesses.delete(ytDlpProcess);
      log(`[YTDLP-FATAL] Failed to start process: ${err.message}`);
      resolve(false);
    });
  });
}

async function downloadFile(
  url,
  outputDir,
  log,
  postId,
  postTitle,
  seriesFolder
) {
  const sanitizedTitle = sanitizeTitleForFilename(postTitle);
  const urlObj = new URL(url);
  let extension = path.extname(urlObj.pathname);
  if (!extension) extension = ".jpg";

  // For gallery images, postId contains the unique identifier (e.g., "postId_0", "postId_1")
  // For regular images, postId is just the post ID
  // Always include the postId to ensure unique filenames for gallery images
  const fileName = `${sanitizedTitle}_${postId}${extension}`;

  // Check if this is a Reddit download and organize into images/videos subfolders
  let finalOutputDir;
  if (seriesFolder) {
    finalOutputDir = path.join(outputDir, seriesFolder);
  } else if (outputDir.includes(path.join("reddit.com"))) {
    // For Reddit downloads, organize by file type
    const mediaType = extension.match(/\.(mp4|webm|mov|avi|mkv)$/i)
      ? "videos"
      : "images";
    finalOutputDir = path.join(outputDir, mediaType);
  } else {
    finalOutputDir = outputDir;
  }

  const outputPath = path.join(finalOutputDir, fileName);

  try {
    // Always ensure the final output directory exists
    await fsp.mkdir(finalOutputDir, { recursive: true });

    if (fs.existsSync(outputPath)) {
      log(`[INFO] Skipping duplicate (axios): ${fileName}`);
      return true; // Treat as success for progress tracking
    }
  } catch (e) {
    log(`[ERROR] Could not check/create directory for download: ${e.message}`);
    return false;
  }

  // Add to download queue
  const queueId = addToDownloadQueue(url, postTitle, postId);

  try {
    // Create abort controller for cancellation
    const controller = new AbortController();
    activeAxiosControllers.add(controller);

    // Add agent to ignore SSL certificate errors
    const https = require("https");
    const unsafeAgent = new https.Agent({
      rejectUnauthorized: false,
    });

    const response = await axios({
      method: "GET",
      url: url,
      responseType: "stream",
      timeout: 30000,
      headers: { "User-Agent": BROWSER_USER_AGENT },
      signal: controller.signal,
      httpsAgent: unsafeAgent,
      onDownloadProgress: (progressEvent) => {
        if (progressEvent.total) {
          const percent = Math.round(
            (progressEvent.loaded / progressEvent.total) * 100
          );
          updateDownloadProgress(queueId, percent);
        }
      },
    });
    const writer = fs.createWriteStream(outputPath);
    response.data.pipe(writer);
    return new Promise((resolve) => {
      writer.on("finish", () => {
        activeAxiosControllers.delete(controller);
        removeFromDownloadQueue(queueId);
        log(`[SUCCESS] Downloaded: ${fileName}`);
        resolve(true);
      });
      writer.on("error", (err) => {
        activeAxiosControllers.delete(controller);
        removeFromDownloadQueue(queueId);
        log(`[ERROR] Failed to save ${fileName}: ${err.message}`);
        try {
          fs.unlinkSync(outputPath);
        } catch {}
        resolve(false);
      });

      // Handle cancellation
      controller.signal.addEventListener("abort", () => {
        activeAxiosControllers.delete(controller);
        // Remove from download queue
        removeFromDownloadQueue(queueId);
        writer.destroy();
        try {
          fs.unlinkSync(outputPath);
        } catch {}
        log(`[INFO] Download cancelled: ${fileName}`);
        resolve(false);
      });
    });
  } catch (error) {
    if (error.name === "AbortError" || error.code === "ABORT_ERR") {
      log(`[INFO] Download cancelled: ${url}`);
      return false;
    }
    log(
      `[ERROR] Download failed for ${url}. Reason: ${
        error.response?.status || error.code
      }`
    );
    // Ensure queue item is removed on failure
    removeFromDownloadQueue(queueId);
    return false;
  }
}

function sanitizeTitleForFilename(title, maxLength = 80) {
  if (!title) return "untitled";

  // Whitelist of safe characters. Anything not in this list will be removed.
  const whitelist = /[^a-zA-Z0-9\s\-_\[\]\(\)\{\}]/g;

  // 1. Remove any character that is not in the whitelist.
  let sanitized = title.replace(whitelist, "");

  // 2. Replace whitespace with a single underscore.
  sanitized = sanitized.replace(/\s+/g, "_");

  // 3. Truncate to the specified maximum length.
  if (sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength);
  }

  // 4. Clean up any trailing/leading underscores that might result from truncation.
  sanitized = sanitized.replace(/^_+|_+$/g, "");

  return sanitized || "untitled";
}

function extractName(url) {
  try {
    return url.match(/\/r\/([a-zA-Z0-9_]+)/)?.[1] || null;
  } catch {
    return null;
  }
}

// --- Configurable max simultaneous downloads ---

// --- Global settings moved to config/settings.js ---
const MAX_SIMULTANEOUS_DOWNLOADS = settings.MAX_SIMULTANEOUS_DOWNLOADS;
const MAX_DOWNLOADS_PER_DOMAIN = settings.MAX_DOWNLOADS_PER_DOMAIN;
const HYBRID_EXTRACTION_HOSTS = settings.HYBRID_EXTRACTION_HOSTS;
const YTDLP_SUPPORTED_HOSTS = settings.YTDLP_SUPPORTED_HOSTS;
const FORCE_YTDLP_ONLY_HOSTS = settings.FORCE_YTDLP_ONLY_HOSTS;
const IMAGE_GALLERY_HOSTS = settings.IMAGE_GALLERY_HOSTS;
const MOTHERLESS_HOST = settings.MOTHERLESS_HOST;
const YTDLP_CONCURRENT_FRAGMENTS = settings.YTDLP_CONCURRENT_FRAGMENTS;
const MULTI_THREAD_CHUNK_SIZE = settings.MULTI_THREAD_CHUNK_SIZE;
const MULTI_THREAD_CONNECTIONS = settings.MULTI_THREAD_CONNECTIONS;

// --- yt-dlp URL extractor for multi-threaded downloading ---
async function extractVideoUrlWithYtDlp(pageUrl, log, postId, postTitle) {
  return new Promise((resolve) => {
    const ytDlpPath = getYtDlpPath();
    if (!fs.existsSync(ytDlpPath)) {
      log(
        `[YTDLP-EXTRACT] yt-dlp.exe not found, falling back to regular download`
      );
      return resolve(null);
    }

    // Use yt-dlp to extract the direct video URL without downloading
    const args = ["--get-url", "--no-playlist", "--quiet", pageUrl];

    log(`[YTDLP-EXTRACT] Extracting direct URL from: ${pageUrl}`);
    const ytDlpProcess = spawn(ytDlpPath, args);
    let extractedUrl = "";
    let errorOutput = "";

    // Track this process for cancellation
    activeProcesses.add(ytDlpProcess);

    ytDlpProcess.stdout.on("data", (data) => {
      extractedUrl += data.toString().trim();
    });

    ytDlpProcess.stderr.on("data", (data) => {
      errorOutput += data.toString();
    });

    ytDlpProcess.on("close", (code) => {
      activeProcesses.delete(ytDlpProcess);

      if (isCancelled) {
        log(`[YTDLP-EXTRACT] Extraction cancelled: ${postTitle}`);
        return resolve(null);
      }

      if (code === 0 && extractedUrl) {
        // Clean up the URL (remove any extra whitespace/newlines)
        const cleanUrl = extractedUrl.split("\n")[0].trim();
        if (cleanUrl.startsWith("http")) {
          log(
            `[YTDLP-EXTRACT] Successfully extracted URL: ${cleanUrl.substring(
              0,
              60
            )}...`
          );
          resolve({
            url: cleanUrl,
            title: postTitle,
            id: postId,
          });
        } else {
          log(`[YTDLP-EXTRACT] Invalid URL extracted: ${cleanUrl}`);
          resolve(null);
        }
      } else {
        log(
          `[YTDLP-EXTRACT] Failed to extract URL from ${pageUrl}: ${errorOutput.trim()}`
        );
        resolve(null);
      }
    });

    ytDlpProcess.on("error", (err) => {
      activeProcesses.delete(ytDlpProcess);
      log(`[YTDLP-EXTRACT] Process error: ${err.message}`);
      resolve(null);
    });
  });
}

// --- Custom video extractors ---
async function extractThisvidVideoUrl(pageUrl, log) {
  try {
    log(`[THISVID] Extracting direct video URL from: ${pageUrl}`);
    const response = await axios.get(pageUrl, {
      headers: { "User-Agent": BROWSER_USER_AGENT },
      timeout: 15000,
    });
    const html = response.data;

    // Try multiple extraction methods for thisvid.com
    let videoUrl = null;
    let title = null;

    // Method 1: Look for file_url in JavaScript
    const fileUrlMatch = html.match(/file_url['"]\s*:\s*['"]([^'"]+)['"]/i);
    if (fileUrlMatch && fileUrlMatch[1]) {
      videoUrl = fileUrlMatch[1];
      log(`[THISVID] Found video URL via file_url: ${videoUrl}`);
    }

    // Method 2: Look for video sources in HTML
    if (!videoUrl) {
      const videoSourceMatch = html.match(
        /<source[^>]+src=['"]([^'"]+\.mp4[^'"]*)['"][^>]*>/i
      );
      if (videoSourceMatch && videoSourceMatch[1]) {
        videoUrl = videoSourceMatch[1];
        log(`[THISVID] Found video URL via source tag: ${videoUrl}`);
      }
    }

    // Method 3: Look for mp4 URLs in script tags
    if (!videoUrl) {
      const scriptMatches = html.matchAll(
        /<script[^>]*>([\s\S]*?)<\/script>/gi
      );
      for (const scriptMatch of scriptMatches) {
        const scriptContent = scriptMatch[1];
        const mp4Match = scriptContent.match(
          /https?:\/\/[^"'\s]+\.mp4[^"'\s]*/gi
        );
        if (mp4Match && mp4Match[0]) {
          videoUrl = mp4Match[0];
          log(`[THISVID] Found video URL in script: ${videoUrl}`);
          break;
        }
      }
    }

    // Extract title
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch && titleMatch[1]) {
      title = titleMatch[1].replace(/\s*-\s*ThisVid\.com\s*$/i, "").trim();
    }

    if (videoUrl) {
      return {
        url: videoUrl,
        title: title || "thisvid_video",
        supportsRangeRequests: true, // thisvid typically supports range requests
      };
    }

    log(`[THISVID] No video URL found in page`);
    return null;
  } catch (error) {
    log(`[THISVID] Error extracting video: ${error.message}`);
    return null;
  }
}

// --- Multi-threaded downloader ---
async function downloadFileMultiThreaded(url, outputPath, log, postId, title) {
  const https = require("https");
  const unsafeAgent = new https.Agent({
    rejectUnauthorized: false,
  });

  // Add to download queue immediately
  const queueId = addToDownloadQueue(url, title, postId);

  try {
    // First, check if the server supports range requests
    const headResponse = await axios.head(url, {
      headers: { "User-Agent": BROWSER_USER_AGENT },
      timeout: 10000,
      httpsAgent: unsafeAgent,
    });

    const acceptsRanges = headResponse.headers["accept-ranges"] === "bytes";
    const contentLength = parseInt(headResponse.headers["content-length"], 10);

    if (
      !acceptsRanges ||
      !contentLength ||
      contentLength < MULTI_THREAD_CHUNK_SIZE * 2
    ) {
      log(
        `[MULTI-THREAD] Server doesn't support range requests or file too small, using single-threaded download`
      );
      // Fallback to single-threaded, passing the original postId
      return await downloadFile(
        url,
        path.dirname(outputPath),
        log,
        postId,
        title
      );
    }

    log(
      `[MULTI-THREAD] Starting multi-threaded download: ${title} (${Math.round(
        contentLength / 1024 / 1024
      )}MB)`
    );

    // Calculate chunk ranges
    const chunkSize = Math.ceil(contentLength / MULTI_THREAD_CONNECTIONS);
    const chunks = [];

    for (let i = 0; i < MULTI_THREAD_CONNECTIONS; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize - 1, contentLength - 1);
      chunks.push({ start, end, index: i });
    }

    // Create temporary files for chunks
    const tempDir = path.join(
      path.dirname(outputPath),
      ".temp_" + path.basename(outputPath)
    );
    await fsp.mkdir(tempDir, { recursive: true });

    let downloadedBytes = 0;
    const progressUpdate = () => {
      const percent = Math.round((downloadedBytes / contentLength) * 100);
      updateDownloadProgress(queueId, percent);
    };

    // Download chunks concurrently
    const downloadPromises = chunks.map(async (chunk) => {
      const chunkPath = path.join(tempDir, `chunk_${chunk.index}`);
      const controller = new AbortController();
      activeAxiosControllers.add(controller);

      try {
        const response = await axios({
          method: "GET",
          url: url,
          headers: {
            "User-Agent": BROWSER_USER_AGENT,
            Range: `bytes=${chunk.start}-${chunk.end}`,
          },
          responseType: "stream",
          signal: controller.signal,
          timeout: 30000,
          httpsAgent: unsafeAgent,
        });

        const writer = fs.createWriteStream(chunkPath);
        response.data.pipe(writer);

        response.data.on("data", (data) => {
          downloadedBytes += data.length;
          progressUpdate();
        });

        return new Promise((resolve, reject) => {
          writer.on("finish", () => {
            activeAxiosControllers.delete(controller);
            resolve(chunkPath);
          });
          writer.on("error", (err) => {
            activeAxiosControllers.delete(controller);
            reject(err);
          });
          controller.signal.addEventListener("abort", () => {
            activeAxiosControllers.delete(controller);
            writer.destroy();
            reject(new Error("Download aborted"));
          });
        });
      } catch (error) {
        activeAxiosControllers.delete(controller);
        throw error;
      }
    });

    // Wait for all chunks to complete
    const chunkPaths = await Promise.all(downloadPromises);

    // Combine chunks into final file
    const finalWriter = fs.createWriteStream(outputPath);
    for (const chunkPath of chunkPaths) {
      const chunkData = await fsp.readFile(chunkPath);
      finalWriter.write(chunkData);
    }
    finalWriter.end();

    // Clean up temp files
    await Promise.all(
      chunkPaths.map((chunkPath) => fsp.unlink(chunkPath).catch(() => {}))
    );
    await fsp.rmdir(tempDir).catch(() => {});

    log(`[SUCCESS] Download completed: ${title}`);
    removeFromDownloadQueue(queueId);
    return true;
  } catch (error) {
    log(
      `[MULTI-THREAD] HEAD request failed (e.g., 405 Method Not Allowed). Falling back to single-threaded download for ${title}`
    );
    // Since the item is already in the queue, we can just call the single-threaded downloader.
    // It will use the existing queue item.
    const fallbackSuccess = await downloadFile(
      url,
      path.dirname(outputPath),
      log,
      postId, // Pass the original postId
      title
    );
    // The success of the overall job depends on the fallback.
    // The queue item will be removed by downloadFile on success/failure.
    return fallbackSuccess;
  }
}
