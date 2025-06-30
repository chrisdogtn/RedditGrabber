const { app, BrowserWindow, ipcMain, dialog, Menu } = require("electron");
const fs = require("fs");
const path = require("path");
const fsp = require("fs").promises;
const axios = require("axios");
const { autoUpdater } = require("electron-updater");
const { spawn } = require("child_process");

let Store;
let store;
let mainWindow;
let isCancelled = false;
let isSkipping = false;

// --- Built-in Logging System, yt-dlp Helpers, Menu, createWindow, and all other setup functions ---
// This code is identical to the version you provided and is known to be stable.
function appLog(message) {
  if (mainWindow) {
    mainWindow.webContents.send("log-update", message);
  }
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
    appLog("[YTDLP] Checking for yt-dlp updates...");
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
    ],
  },
];
async function createWindow() {
  const { default: StoreClass } = await import("electron-store");
  Store = StoreClass;
  store = new Store();
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 1200,
    minWidth: 940,
    minHeight: 700,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  const menu = Menu.buildFromTemplate(menuTemplate);
  Menu.setApplicationMenu(menu);
  mainWindow.loadFile(path.join(__dirname, "index.html"));
  mainWindow.webContents.on("did-finish-load", async () => {
    appLog("[INFO] Checking for app updates...");
    autoUpdater.checkForUpdatesAndNotify();
    await updateYtDlp();
  });
}
autoUpdater.on("checking-for-update", () =>
  appLog("[Updater] Checking for update...")
);
autoUpdater.on("update-not-available", (info) =>
  appLog("[Updater] You are on the latest version.")
);
autoUpdater.on("update-available", (info) => {
  appLog(`[Updater] Update available (v${info.version}).`);
  mainWindow.webContents.send("update-notification", {
    message: "Update available. Downloading...",
  });
});
autoUpdater.on("download-progress", (progressObj) =>
  appLog(`[Updater] Downloading update: ${Math.round(progressObj.percent)}%`)
);
autoUpdater.on("update-downloaded", (info) => {
  appLog(`[Updater] Update v${info.version} downloaded.`);
  mainWindow.webContents.send("update-notification", {
    message: "Update downloaded. Restart to install.",
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
});
ipcMain.on("skip-subreddit", () => {
  isSkipping = true;
});

// --- CORE DOWNLOADER LOGIC ---
const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
let redgifsToken = null;

async function runDownloader(options, log) {
  log(`[INFO] Starting download process...`);
  isCancelled = false;
  isSkipping = false;
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
  const subredditsToDownload = options.subreddits.filter(
    (s) => s.status === "pending"
  );
  const totalJobs = subredditsToDownload.length;
  if (totalJobs === 0) {
    log("[INFO] No pending subreddits to download.");
    log("--- ALL JOBS COMPLETE ---");
    return;
  }
  log(`[INFO] ${totalJobs} subreddits are pending download.`);
  if (mainWindow)
    mainWindow.webContents.send("queue-progress", {
      current: 0,
      total: totalJobs,
    });
  for (let i = 0; i < totalJobs; i++) {
    if (isCancelled) {
      log("[INFO] Download process stopped by user.");
      break;
    }
    isSkipping = false;
    const subreddit = subredditsToDownload[i];
    const { url: subredditUrl } = subreddit;
    const subredditName = extractName(subredditUrl);
    if (!subredditName) {
      log(`[ERROR] Invalid URL: ${subredditUrl}`);
      if (mainWindow)
        mainWindow.webContents.send("subreddit-complete", subredditUrl);
      continue;
    }
    const subredditDir = path.join(downloadPath, subredditName);
    await fsp.mkdir(subredditDir, { recursive: true });
    log(`[INFO] [${subredditName}] Starting scan...`);
    try {
      const links = await fetchAllMediaLinks(
        subredditUrl,
        options,
        log,
        unhandledLogPath
      );
      log(`[INFO] [${subredditName}] Found ${links.length} potential files.`);
      let downloadCount = 0;
      if (links.length > 0) {
        for (let j = 0; j < links.length; j++) {
          if (isCancelled || isSkipping) break;
          const link = links[j];
          if (mainWindow)
            mainWindow.webContents.send("download-progress", {
              current: j + 1,
              total: links.length,
            });
          let success = false;
          if (link.downloader === "ytdlp") {
            success = await downloadWithYtDlp(
              link.url,
              subredditDir,
              log,
              link.id,
              link.title
            );
          } else {
            success = await downloadFile(
              link.url,
              subredditDir,
              log,
              link.id,
              link.title
            );
          }
          if (success) downloadCount++;
        }
      }
      if (isSkipping) log(`[INFO] [${subredditName}] Skipped by user.`);
      else if (!isCancelled)
        log(
          `[SUCCESS] [${subredditName}] Downloaded ${downloadCount} new files.`
        );
    } catch (error) {
      log(`[ERROR] [${subredditName}] An error occurred: ${error.stack}`);
    } finally {
      if (mainWindow) {
        mainWindow.webContents.send("subreddit-complete", subredditUrl);
        mainWindow.webContents.send("queue-progress", {
          current: i + 1,
          total: totalJobs,
        });
      }
    }
  }
  if (isCancelled) log("[INFO] Download process stopped by user.");
  log("--- ALL JOBS COMPLETE ---");
}

async function fetchAllMediaLinks(
  subredditUrl,
  options,
  log,
  unhandledLogPath
) {
  let allLinks = [];
  let after = null;
  let postCount = 0;
  let currentPage = 1;
  const hasPageEnd =
    options.pageEnd > 0 && options.pageEnd >= options.pageStart;
  const fetchOptions = {
    headers: { "User-Agent": BROWSER_USER_AGENT, Cookie: "over18=1" },
  };

  log(`[INFO] Scanning for up to ${options.maxLinks || "unlimited"} links...`);

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
// highlight-end

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

const YT_DLP_HOSTS = [
  "youtube.com",
  "youtu.be",
  "x.com",
  "facebook.com",
  "twitch.tv",
  "instagram.com",
  "xhamster.com",
  "pornhub.com",
];

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
    } else if (domain === "i.redd.it") {
      urls.push({
        url: postUrl,
        type: "image",
        downloader: "axios",
        id: postId,
        title: postTitle,
      });
    } else if (is_gallery && media_metadata) {
      Object.values(media_metadata).forEach((item, i) => {
        if (item?.s?.u)
          urls.push({
            url: item.s.u.replace(/&/g, "&"),
            type: "image",
            downloader: "axios",
            id: `${postId}_${i}`,
            title: postTitle,
          });
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
    } else {
      const extension = path.extname(new URL(postUrl).pathname).toLowerCase();
      const imageExtensions = [".jpg", ".jpeg", ".png", ".webp", ".bmp"];
      const gifExtensions = [".gif"];
      if (imageExtensions.includes(extension)) {
        urls.push({
          url: postUrl,
          type: "image",
          downloader: "axios",
          id: postId,
          title: postTitle,
        });
      } else if (gifExtensions.includes(extension)) {
        urls.push({
          url: postUrl.replace(".gifv", ".mp4"),
          type: "video",
          downloader: "axios",
          id: postId,
          title: postTitle,
        });
      } else if (YT_DLP_HOSTS.some((host) => domain.includes(host))) {
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

async function downloadWithYtDlp(url, outputDir, log, postId, postTitle) {
  return new Promise((resolve) => {
    const sanitizedTitle = sanitizeTitleForFilename(postTitle);
    const fileNameTemplate = `${sanitizedTitle}_${postId}.%(ext)s`;
    const outputPath = path.join(outputDir, fileNameTemplate);
    try {
      const filesInDir = fs.readdirSync(outputDir);
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
      "-o",
      outputPath,
      url,
    ];
    log(`[INFO] Starting Download: ${postTitle}`);
    const ytDlpProcess = spawn(ytDlpPath, args);
    ytDlpProcess.stdout.on("data", (data) => {
      const output = data.toString();
      const progressMatch = output.match(/\[download\]\s+([\d\.]+)%/);
      if (progressMatch && progressMatch[1]) {
        const percent = parseFloat(progressMatch[1]);
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
      if (code === 0) {
        log(`[SUCCESS] Download Finished: ${sanitizedTitle}`);
        resolve(true);
      } else {
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
      log(`[YTDLP-FATAL] Failed to start process: ${err.message}`);
      resolve(false);
    });
  });
}

async function downloadFile(url, outputDir, log, postId, postTitle) {
  try {
    const sanitizedTitle = sanitizeTitleForFilename(postTitle);
    const urlObj = new URL(url);
    let extension = path.extname(urlObj.pathname);
    if (!extension) extension = ".jpg";
    const fileName = `${sanitizedTitle}_${postId}${extension}`;
    const outputPath = path.join(outputDir, fileName);
    if (fs.existsSync(outputPath)) return false;
    const response = await axios({
      method: "GET",
      url: url,
      responseType: "stream",
      timeout: 30000,
      headers: { "User-Agent": BROWSER_USER_AGENT },
    });
    const writer = fs.createWriteStream(outputPath);
    response.data.pipe(writer);
    return new Promise((resolve) => {
      writer.on("finish", () => {
        log(`[SUCCESS] Downloaded: ${fileName}`);
        resolve(true);
      });
      writer.on("error", (err) => {
        log(`[ERROR] Failed to save ${fileName}: ${err.message}`);
        try {
          fs.unlinkSync(outputPath);
        } catch {}
        resolve(false);
      });
    });
  } catch (error) {
    log(
      `[ERROR] Download failed for ${url}. Reason: ${
        error.response?.status || error.code
      }`
    );
    return false;
  }
}

function sanitizeTitleForFilename(title) {
  if (!title) return "untitled";
  const illegalChars = /[\\/:\*\?"<>\|]/g;
  return title.replace(illegalChars, "").replace(/\s+/g, "_").substring(0, 150);
}

function extractName(url) {
  try {
    return url.match(/\/r\/([a-zA-Z0-9_]+)/)?.[1] || null;
  } catch {
    return null;
  }
}
