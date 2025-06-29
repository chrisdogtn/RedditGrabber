const { app, BrowserWindow, ipcMain, dialog, Menu } = require("electron");
const fs = require("fs");
const path = require("path");
const fsp = require("fs").promises;
const axios = require("axios");
const { autoUpdater } = require("electron-updater");

// Dynamically import electron-store
let Store;
let store;

let mainWindow;
let isCancelled = false;
let isSkipping = false;

// Simplified logging for the UI
function appLog(message) {
  if (mainWindow) {
    mainWindow.webContents.send("log-update", message);
  }
  console.log(message);
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

  mainWindow.webContents.on("did-finish-load", () => {
    // With a public repo, this simple call is all that's needed.
    autoUpdater.checkForUpdatesAndNotify();
  });
}

// Auto-Updater Listeners
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

// App Event Handlers
app.whenReady().then(createWindow);
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// IPC Handlers
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
ipcMain.on("stop-download", () => {
  isCancelled = true;
});
ipcMain.on("skip-subreddit", () => {
  isSkipping = true;
});

// --- CORE DOWNLOADER LOGIC AND HELPERS ---
// This entire section is stable and does not need any changes.
// It can be pasted from our last working version.
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
  fs.writeFileSync(
    unhandledLogPath,
    `--- Log for session started at ${new Date().toISOString()} ---\n`
  );
  log(`[INFO] Unhandled links will be saved to: ${unhandledLogPath}`);
  redgifsToken = null;
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
    const subreddit = subredditsToDownload[i];
    if (isCancelled) {
      log("[INFO] Download process stopped by user.");
      break;
    }
    isSkipping = false;
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
          const success = await downloadFile(
            link.url,
            subredditDir,
            log,
            link.id,
            link.title
          );
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
    const url = `${subredditUrl.replace(
      /\/$/,
      ""
    )}.json?limit=100&count=${postCount}&after=${after || ""}`;
    try {
      const response = await fetch(url, fetchOptions);
      if (!response.ok) {
        log(
          `[ERROR] Fetch failed for ${extractName(
            subredditUrl
          )} on page ${currentPage}. Status: ${response.status}`
        );
        break;
      }
      const data = await response.json();
      if (!data.data?.children?.length) {
        log(`[INFO] No more posts found for ${extractName(subredditUrl)}.`);
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
        postCount++;
      }
      if (!after) break;
      after = data.data.after;
      currentPage++;
      if (hasPageEnd && currentPage > options.pageEnd) after = null;
      await new Promise((resolve) => setTimeout(resolve, 500));
    } catch (error) {
      log(
        `[FATAL] A network error occurred while fetching ${subredditUrl}: ${error.message}`
      );
      break;
    }
  } while (after);
  log(`[INFO] Scan complete. Scanned ${postCount} posts.`);
  const filteredLinks = allLinks.filter(
    (link) =>
      (options.fileTypes.images && link.type === "image") ||
      (options.fileTypes.gifs && link.type === "gif") ||
      (options.fileTypes.videos && link.type === "video")
  );
  if (options.maxLinks > 0) return filteredLinks.slice(0, options.maxLinks);
  return filteredLinks;
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
    if (domain === "v.redd.it" || is_video) {
      if (secure_media?.reddit_video)
        urls.push({
          url: secure_media.reddit_video.fallback_url.split("?")[0],
          type: "video",
          id: postId,
          title: postTitle,
        });
    } else if (domain === "i.redd.it") {
      urls.push({ url: postUrl, type: "image", id: postId, title: postTitle });
    } else if (is_gallery && media_metadata) {
      Object.values(media_metadata).forEach((item, i) => {
        if (item?.s?.u)
          urls.push({
            url: item.s.u.replace(/&amp;/g, "&"),
            type: "image",
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
            id: `${postId}_${i}`,
            title: postTitle,
          });
        });
      } else {
        const directUrl =
          postUrl.endsWith(".jpg") || postUrl.endsWith(".png")
            ? postUrl
            : `${postUrl}.jpg`;
        urls.push({
          url: directUrl,
          type: "image",
          id: postId,
          title: postTitle,
        });
      }
    } else if (domain.includes("xhamster.com")) {
      log(`[INFO] Probing xhamster page for video...`);
      const directVideoUrl = await scrapeXhamsterPage(postUrl);
      if (directVideoUrl) {
        log(`[SUCCESS] Found xhamster video link.`);
        urls.push({
          url: directVideoUrl,
          type: "video",
          id: postId,
          title: postTitle,
        });
      }
    } else {
      const extension = path.extname(new URL(postUrl).pathname).toLowerCase();
      const imageExtensions = [
        ".jpg",
        ".jpeg",
        ".png",
        ".webp",
        ".bmp",
        ".tif",
        ".tiff",
      ];
      const gifExtensions = [".gif"];
      if (imageExtensions.includes(extension)) {
        urls.push({
          url: postUrl,
          type: "image",
          id: postId,
          title: postTitle,
        });
      } else if (gifExtensions.includes(extension)) {
        urls.push({ url: postUrl, type: "gif", id: postId, title: postTitle });
      } else if (postUrl.endsWith(".gifv")) {
        urls.push({
          url: postUrl.replace(".gifv", ".mp4"),
          type: "gif",
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

function sanitizeTitleForFilename(title) {
  if (!title) return "untitled";
  const illegalChars = /[\\/:\*\?"<>\|]/g;
  return title.replace(illegalChars, "").replace(/\s+/g, "_").substring(0, 150);
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

function extractName(url) {
  try {
    return url.match(/\/r\/([a-zA-Z0-9_]+)/)?.[1] || null;
  } catch {
    return null;
  }
}
