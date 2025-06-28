const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const fs = require("fs");
const path = require("path");
const fsp = require("fs").promises;
const axios = require("axios");
const { autoUpdater } = require("electron-updater");

// highlight-start
// The 'electron-store' library is now an ES Module, so we cannot use require().
// We will import it dynamically inside an async function.
let Store;
let store;
// highlight-end

let mainWindow;

// --- Main Application Setup ---
async function createWindow() {
  // highlight-start
  // Dynamically import and initialize electron-store
  const { default: StoreClass } = await import("electron-store");
  Store = StoreClass;
  store = new Store();
  // highlight-end

  mainWindow = new BrowserWindow({
    width: 1300,
    height: 900,
    minWidth: 940,
    minHeight: 700,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "index.html"));

  mainWindow.once("ready-to-show", () => {
    autoUpdater.checkForUpdatesAndNotify();
  });
}

// --- Auto-Updater Logic ---
autoUpdater.on("update-available", () => {
  if (mainWindow) {
    mainWindow.webContents.send("update-notification", {
      message: "Update available. Downloading...",
    });
  }
});
autoUpdater.on("update-downloaded", () => {
  if (mainWindow) {
    mainWindow.webContents.send("update-notification", {
      message: "Update downloaded. Restart to install.",
      showRestart: true,
    });
  }
});
ipcMain.on("restart_app", () => {
  autoUpdater.quitAndInstall();
});

// --- App Event Handlers ---
app.whenReady().then(createWindow);

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// --- IPC Handlers ---
ipcMain.handle("dialog:openFile", async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ["openFile"],
    filters: [{ name: "Text Files", extensions: ["txt"] }],
  });
  if (!canceled && filePaths.length > 0) {
    return fs.readFileSync(filePaths[0], "utf-8");
  }
  return null;
});

ipcMain.handle("dialog:setDownloadPath", async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory"],
  });
  if (!canceled && filePaths.length > 0) {
    const selectedPath = filePaths[0];
    store.set("downloadPath", selectedPath); // Save the path
    return selectedPath;
  }
  return null;
});

ipcMain.handle("settings:getDownloadPath", () => {
  return store.get("downloadPath", app.getPath("downloads"));
});

ipcMain.on("start-download", (event, options) => {
  const log = (message) => {
    if (mainWindow) {
      mainWindow.webContents.send("log-update", message);
    }
  };
  runDownloader(options, log).catch((err) =>
    log(`[FATAL] Unhandled error: ${err.message}`)
  );
});

// --- CORE DOWNLOADER LOGIC (No changes below this line) ---
const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
let redgifsToken = null;

async function runDownloader(options, log) {
  log(`[INFO] Starting download process...`);
  const downloadPath = store.get("downloadPath");
  if (!downloadPath) {
    log("[ERROR] Download location not set. Please choose a folder first.");
    return;
  }
  redgifsToken = null;
  await fsp.mkdir(downloadPath, { recursive: true });
  const subredditsToDownload = options.subreddits.filter(
    (s) => s.status === "pending"
  );
  if (subredditsToDownload.length === 0) {
    log("[INFO] No pending subreddits in the queue to download.");
    return;
  }
  log(`[INFO] ${subredditsToDownload.length} subreddits are pending download.`);
  for (const subreddit of subredditsToDownload) {
    const { url: subredditUrl } = subreddit;
    const subredditName = extractName(subredditUrl);
    if (!subredditName) {
      log(`[ERROR] Invalid URL, cannot extract name: ${subredditUrl}`);
      if (mainWindow)
        mainWindow.webContents.send("subreddit-complete", subredditUrl);
      continue;
    }
    const subredditDir = path.join(downloadPath, subredditName);
    await fsp.mkdir(subredditDir, { recursive: true });
    log(`[INFO] [${subredditName}] Starting scan...`);
    try {
      const links = await fetchAllMediaLinks(subredditUrl, options, log);
      log(`[INFO] [${subredditName}] Found ${links.length} potential files.`);
      let downloadCount = 0;
      if (links.length > 0) {
        for (let i = 0; i < links.length; i++) {
          const link = links[i];
          if (mainWindow)
            mainWindow.webContents.send("download-progress", {
              current: i + 1,
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
      log(
        `[SUCCESS] [${subredditName}] Downloaded ${downloadCount} new files.`
      );
      if (mainWindow)
        mainWindow.webContents.send("subreddit-complete", subredditUrl);
    } catch (error) {
      log(`[ERROR] [${subredditName}] An error occurred: ${error.stack}`);
      if (mainWindow)
        mainWindow.webContents.send("subreddit-complete", subredditUrl);
    }
  }
  log("--- ALL JOBS COMPLETE ---");
}

async function fetchAllMediaLinks(subredditUrl, options, log) {
  let allLinks = [];
  let after = null;
  let postCount = 0;
  let currentPage = 1;
  const hasPageEnd =
    options.pageEnd > 0 && options.pageEnd >= options.pageStart;
  const fetchOptions = {
    headers: { "User-Agent": BROWSER_USER_AGENT, Cookie: "over18=1" },
  };
  do {
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
        const mediaFromPost = await extractMediaUrlsFromPost(post.data, log);
        allLinks.push(...mediaFromPost);
      }
      after = data.data.after;
      currentPage++;
      postCount += posts.length;
      if (hasPageEnd && currentPage > options.pageEnd) after = null;
      if (options.maxPosts > 0 && postCount >= options.maxPosts) after = null;
      await new Promise((resolve) => setTimeout(resolve, 500));
    } catch (error) {
      log(
        `[FATAL] A network error occurred while fetching ${subredditUrl}: ${error.message}`
      );
      break;
    }
  } while (after);
  const filteredLinks = allLinks.filter(
    (link) =>
      (options.fileTypes.images && link.type === "image") ||
      (options.fileTypes.gifs && link.type === "gif") ||
      (options.fileTypes.videos && link.type === "video")
  );
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

async function extractMediaUrlsFromPost(originalPostData, log) {
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
    if (domain === "redgifs.com") {
      const token = await getRedgifsToken(log);
      if (!token) throw new Error("Auth failed");
      const slug = postUrl.split("/").pop();
      const apiUrl = `https://api.redgifs.com/v2/gifs/${slug}`;
      const apiResponse = await fetch(apiUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
          "User-Agent": BROWSER_USER_AGENT,
        },
      });
      if (!apiResponse.ok) throw new Error(`API status ${apiResponse.status}`);
      const apiData = await apiResponse.json();
      if (apiData?.gif?.urls?.hd)
        urls.push({
          url: apiData.gif.urls.hd,
          type: "video",
          id: postId,
          title: postTitle,
        });
    } else if (is_video || domain === "v.redd.it") {
      if (secure_media?.reddit_video)
        urls.push({
          url: secure_media.reddit_video.fallback_url.split("?")[0],
          type: "video",
          id: postId,
          title: postTitle,
        });
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
    } else {
      const extension = path.extname(postUrl).toLowerCase();
      if ([".jpg", ".jpeg", ".png", ".webp", ".bmp"].includes(extension))
        urls.push({
          url: postUrl,
          type: "image",
          id: postId,
          title: postTitle,
        });
      else if ([".gif"].includes(extension))
        urls.push({ url: postUrl, type: "gif", id: postId, title: postTitle });
      else if (extension === ".gifv")
        urls.push({
          url: postUrl.replace(".gifv", ".mp4"),
          type: "gif",
          id: postId,
          title: postTitle,
        });
      else if (postUrl.includes("i.imgur.com"))
        urls.push({
          url: `${postUrl}.jpg`,
          type: "image",
          id: postId,
          title: postTitle,
        });
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
    const extension = path.extname(new URL(url).pathname);
    const fileName = `${sanitizedTitle}_${postId}${extension}`;
    const outputPath = path.join(outputDir, fileName);
    if (fs.existsSync(outputPath)) {
      log(`[INFO] Skipping duplicate: ${fileName}`);
      return false;
    }
    const response = await axios({
      method: "GET",
      url: url,
      responseType: "stream",
      timeout: 30000,
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
