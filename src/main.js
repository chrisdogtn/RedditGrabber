// --- Changelog content (update as needed) ---
const APP_CHANGELOG = `
<h2 style="color:rgb(209, 52, 52)">Phil Downloader Changelog V1.6.2</h2>
<ul>
  <li>Added support for xnxx.com & xhamster.com</li>
  <li>Added supported domains can be clicked to open in system browser</li>

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
    <ul>${domains
      .map(
        (d) =>
          `<li><a style="color: white;" href="https://${d}" target="_blank" rel="noopener">${d}</a></li>`
      )
      .join("")}</ul>
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
        `<html>
          <head><title>Supported Domains</title></head>
          <body style="font-family:sans-serif;padding:20px;background: #111111; color: white; overflow-y: auto;">
            ${html}
            <script>
              document.addEventListener('click', function(e) {
                if (e.target.tagName === 'A' && e.target.href) {
                  e.preventDefault();
                  require('electron').shell.openExternal(e.target.href);
                }
              });
            </script>
          </body>
        </html>`
      )
  );
}
// Legacy scrapers removed
const { app, BrowserWindow, ipcMain, dialog, Menu } = require("electron");
const fs = require("fs");
const path = require("path");
const fsp = require("fs").promises;
const axios = require("axios");
const { autoUpdater } = require("electron-updater");
const { spawn } = require("child_process");
const ScraperManager = require("./core/ScraperManager");
const { sanitizeTitleForFilename, extractName } = require("./utils/stringUtils");
const settings = require("./config/settings.js");
const { extractVideoUrlWithYtDlp, getYtDlpPath } = require("./utils/ytDlpUtils");

// Load all scrapers
ScraperManager.loadAll(path.join(__dirname, "scrapers"));

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
          
          let downloadDir = jobToDownload.subredditDir;
          if (jobToDownload.link.seriesFolder) {
             downloadDir = path.join(store.get("downloadPath"), jobToDownload.link.seriesFolder);
          }
          await fsp.mkdir(downloadDir, { recursive: true });

          const outputPath = path.join(downloadDir, fileName);
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
        { ...options, type, domain, isCancelled: () => isCancelled },
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
  // 1. Try ScraperManager
  const scraper = ScraperManager.getScraper(subredditUrl);
  if (scraper) {
    log(`[Scraper] Found scraper: ${scraper.getName()} for ${subredditUrl}`);
    try {
      return await scraper.scrape(subredditUrl, log, options);
    } catch (error) {
      log(`[Scraper] Error in ${scraper.getName()}: ${error.message}`);
      return [];
    }
  }

  // 2. Fallback: Generic yt-dlp check
  const { YTDLP_SUPPORTED_HOSTS } = settings;
  const domainMatch = subredditUrl.match(/https?:\/\/(?:www\.)?([^\/]+)/i);
  const domain = domainMatch ? domainMatch[1] : null;

  if (domain && YTDLP_SUPPORTED_HOSTS && YTDLP_SUPPORTED_HOSTS.some(host => domain.includes(host))) {
     log(`[Scraper] No specific scraper found, but domain is in YTDLP whitelist. Using generic yt-dlp.`);
     
     // Try to get metadata first
     const { getVideoMetadata } = require("./utils/ytDlpUtils");
     let title = "generic_download";
     let id = Date.now().toString();

     try {
        const metadata = await getVideoMetadata(subredditUrl, log);
        if (metadata) {
            title = metadata.title;
            id = metadata.id;
            // Sanitize title
            title = sanitizeTitleForFilename(title);
        }
     } catch (e) {
        log(`[Scraper] Failed to fetch metadata for generic download: ${e.message}`);
     }

     // Return a generic job
     return [{
       url: subredditUrl,
       type: "video",
       downloader: "ytdlp",
       id: id,
       title: title, 
       domain: domain
     }];
  }

  // Log unhandled
  if (unhandledLogPath) {
    try {
      fs.appendFileSync(unhandledLogPath, `${subredditUrl}\n`);
    } catch (e) {
      log(`[Error] Could not write to unhandled log: ${e.message}`);
    }
  }
  return [];
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

// sanitizeTitleForFilename is imported from utils/stringUtils.js



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
