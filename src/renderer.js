document.addEventListener("DOMContentLoaded", () => {
  // ===== Element Selectors =====
  const setPathBtn = document.getElementById("set-path-btn");
  const downloadPathDisplay = document.getElementById("download-path-display");
  const notification = document.getElementById("notification");
  const notificationMessage = document.getElementById("notification-message");
  const closeNotificationBtn = document.getElementById(
    "close-notification-btn"
  );
  const restartButton = document.getElementById("restart-btn");
  const progressContainer = document.getElementById("progress-container");
  const progressLabel = document.getElementById("progress-label");
  const progressValue = document.getElementById("progress-value");
  const progressBar = document.getElementById("progress-bar-foreground");
  const overallProgressContainer = document.getElementById(
    "overall-progress-container"
  );
  const overallProgressLabel = document.getElementById(
    "overall-progress-label"
  );
  const overallProgressValue = document.getElementById(
    "overall-progress-value"
  );
  const overallProgressBar = document.getElementById(
    "overall-progress-bar-foreground"
  );
  const startBtn = document.getElementById("start-btn");
  const skipBtn = document.getElementById("skip-btn");
  const stopBtn = document.getElementById("stop-btn");
  const subredditList = document.getElementById("subreddit-list");
  const logArea = document.getElementById("log-area");
  const typeImages = document.getElementById("type-images");
  const typeGifs = document.getElementById("type-gifs");
  const typeVideos = document.getElementById("type-videos");
  const limitLinksInput = document.getElementById("limit-links");
  const pageStart = document.getElementById("page-start");
  const pageEnd = document.getElementById("page-end");
  const clearQueueBtn = document.getElementById("clear-queue-btn");
  const subredditTextArea = document.getElementById("subreddit-textarea");
  const loadFromFileBtn = document.getElementById("load-from-file-btn");
  const addFromTextBtn = document.getElementById("add-from-text-btn");
  const clearCompletedBtn = document.getElementById("clear-completed-btn");
  const autoClearToggle = document.getElementById("auto-clear-toggle");

  // ===== State Management =====
  let subreddits = [];

  // ===== SVG Icons =====
  const TRASH_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512" fill="currentColor"><path d="M135.2 17.7L128 32H32C14.3 32 0 46.3 0 64S14.3 96 32 96H416c17.7 0 32-14.3 32-32s-14.3-32-32-32H320l-7.2-14.3C307.4 6.8 296.3 0 284.2 0H163.8c-12.1 0-23.2 6.8-28.6 17.7zM416 128H32L53.2 467c1.6 25.3 22.6 45 47.9 45H346.9c25.3 0 46.3-19.7 47.9-45L416 128z"/></svg>`;
  const CHECK_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512" fill="currentColor"><path d="M438.6 105.4c12.5 12.5 12.5 32.8 0 45.3l-256 256c-12.5 12.5-32.8 12.5-45.3 0l-128-128c-12.5-12.5-12.5-32.8 0-45.3s32.8-12.5 45.3 0L160 338.7 393.4 105.4c12.5-12.5 32.8-12.5 45.3 0z"/></svg>`;

  // ===== URL Processing =====
  function processAndValidateUrl(rawUrl) {
    try {
      const trimmedUrl = rawUrl.trim();
      const regex =
        /(https?:\/\/(?:www\.|old\.)?reddit\.com\/r\/[a-zA-Z0-9_]+)/;
      const match = trimmedUrl.match(regex);
      return match ? match[1] : null;
    } catch {
      return null;
    }
  }

  // ===== Queue Management =====
  function renderSubreddits() {
    subredditList.innerHTML = "";
    subreddits.forEach((sub, index) => {
      const li = document.createElement("li");
      if (sub.status === "complete") li.classList.add("item-complete");
      const urlSpan = document.createElement("span");
      urlSpan.className = "item-url";
      urlSpan.textContent = sub.url;
      li.appendChild(urlSpan);
      const controlsDiv = document.createElement("div");
      controlsDiv.className = "item-controls";
      if (sub.status === "complete") {
        const checkIcon = document.createElement("div");
        checkIcon.className = "check-icon";
        checkIcon.innerHTML = CHECK_ICON_SVG;
        controlsDiv.appendChild(checkIcon);
      }
      const trashIcon = document.createElement("div");
      trashIcon.className = "trash-icon";
      trashIcon.innerHTML = TRASH_ICON_SVG;
      trashIcon.onclick = () => {
        subreddits.splice(index, 1);
        renderSubreddits();
      };
      controlsDiv.appendChild(trashIcon);
      li.appendChild(controlsDiv);
      subredditList.appendChild(li);
    });
  }

  function addUrlsToQueue(urlArray) {
    const existingUrls = new Set(subreddits.map((s) => s.url));
    let addedCount = 0;
    let rejectedCount = 0;
    urlArray.forEach((rawUrl) => {
      const cleanedUrl = processAndValidateUrl(rawUrl);
      if (cleanedUrl) {
        if (!existingUrls.has(cleanedUrl)) {
          existingUrls.add(cleanedUrl);
          subreddits.push({ url: cleanedUrl, status: "pending" });
          addedCount++;
        }
      } else if (rawUrl.trim() !== "") {
        rejectedCount++;
      }
    });
    if (addedCount > 0)
      addLogMessage(
        `[SUCCESS] Added ${addedCount} new subreddits to the queue.`
      );
    if (rejectedCount > 0)
      addLogMessage(`[INFO] Ignored ${rejectedCount} invalid entries.`);
    if (
      addedCount === 0 &&
      rejectedCount === 0 &&
      urlArray.some((u) => u.trim() !== "")
    ) {
      addLogMessage("[INFO] No new subreddits were added.");
    }
    renderSubreddits();
  }

  // ===== UI State Management =====
  function setUiForDownloading(isDownloading) {
    startBtn.classList.toggle("hidden", isDownloading);
    skipBtn.classList.toggle("hidden", !isDownloading);
    stopBtn.classList.toggle("hidden", !isDownloading);
    if (!isDownloading) {
      progressContainer.classList.add("hidden");
      overallProgressContainer.classList.add("hidden");
    } else {
      progressContainer.classList.remove("hidden");
      overallProgressContainer.classList.remove("hidden");
    }
  }

  // ===== Event Listeners =====
  setPathBtn.addEventListener("click", async () => {
    const newPath = await window.api.setDownloadPath();
    if (newPath) {
      downloadPathDisplay.textContent = newPath;
      addLogMessage(`[INFO] Download location set to: ${newPath}`);
    }
  });

  clearQueueBtn.addEventListener("click", () => {
    subreddits = [];
    renderSubreddits();
    addLogMessage("[INFO] Queue has been cleared.");
  });

  clearCompletedBtn.addEventListener("click", () => {
    const originalCount = subreddits.length;
    subreddits = subreddits.filter((s) => s.status !== "complete");
    const removedCount = originalCount - subreddits.length;
    if (removedCount > 0) {
      addLogMessage(
        `[INFO] Removed ${removedCount} completed items from the queue.`
      );
      renderSubreddits();
    } else {
      addLogMessage("[INFO] No completed items to clear.");
    }
  });

  addFromTextBtn.addEventListener("click", () => {
    const urls = subredditTextArea.value
      .split("\n")
      .filter((url) => url.trim() !== "");
    if (urls.length > 0) {
      addUrlsToQueue(urls);
      subredditTextArea.value = "";
    }
  });

  loadFromFileBtn.addEventListener("click", async () => {
    const content = await window.api.openFile();
    if (content) {
      const urls = content.split("\n");
      addUrlsToQueue(urls);
    }
  });

  startBtn.addEventListener("click", () => {
    const pendingSubs = subreddits.filter((s) => s.status === "pending");
    if (pendingSubs.length > 0) {
      setUiForDownloading(true);
      logArea.innerHTML = "";
      addLogMessage("[INFO] Starting download process...");
      progressBar.classList.remove("indeterminate");
      progressBar.style.width = "0%";
      progressValue.textContent = "0%";
      progressLabel.textContent = "Initializing...";
      overallProgressBar.style.width = "0%";
      overallProgressValue.textContent = "0%";
      const options = {
        subreddits: subreddits,
        autoClear: autoClearToggle.checked,
        fileTypes: {
          images: typeImages.checked,
          gifs: typeGifs.checked,
          videos: typeVideos.checked,
        },
        maxLinks: parseInt(limitLinksInput.value, 10) || 0,
        pageStart: parseInt(pageStart.value, 10) || 1,
        pageEnd: parseInt(pageEnd.value, 10) || 0,
      };
      window.api.startDownload(options);
    } else {
      addLogMessage("[INFO] No pending subreddits in the queue to download.");
    }
  });

  stopBtn.addEventListener("click", () => {
    window.api.stopDownload();
    addLogMessage("[INFO] Stop command sent. Finishing current operations...");
  });

  skipBtn.addEventListener("click", () => {
    window.api.skipSubreddit();
    addLogMessage("[INFO] Skip command sent. Moving to next subreddit...");
  });

  closeNotificationBtn.addEventListener("click", () => {
    notification.classList.add("hidden");
  });

  restartButton.addEventListener("click", () => {
    window.api.restartApp();
  });

  // ===== IPC & Log Handlers =====
  function addLogMessage(message) {
    if (
      message.includes("--- ALL JOBS COMPLETE ---") ||
      message.includes("[FATAL]")
    ) {
      setUiForDownloading(false);
    }
    if (message.includes("Starting scan...")) {
      progressBar.classList.add("indeterminate");
      progressLabel.textContent = "Scanning for media...";
      progressValue.textContent = "";
    } else if (
      message.includes("Found") &&
      message.includes("potential files")
    ) {
      progressBar.classList.remove("indeterminate");
    }
    const logMessage = document.createElement("div");
    logMessage.className = "log-message";
    if (message.includes("[SUCCESS]")) logMessage.classList.add("log-success");
    else if (message.includes("[ERROR]") || message.includes("FATAL"))
      logMessage.classList.add("log-error");
    else if (message.includes("[Auth]")) logMessage.classList.add("log-auth");
    else if (message.includes("[INFO]")) logMessage.classList.add("log-info");
    else return;
    logMessage.textContent = message;
    logArea.appendChild(logMessage);
    logArea.scrollTop = logArea.scrollHeight;
  }

  window.api.onLogUpdate((event, message) => addLogMessage(message));

  window.api.onDownloadProgress((event, { current, total }) => {
    progressBar.classList.remove("indeterminate");
    const percentage = Math.round((current / total) * 100);
    progressBar.style.width = `${percentage}%`;
    progressValue.textContent = `${percentage}%`;
    progressLabel.textContent = `Downloading ${current} of ${total}...`;
  });

  window.api.onYtDlpProgress((event, { percent, title }) => {
    progressBar.classList.remove("indeterminate");
    const percentage = Math.round(percent);
    progressBar.style.width = `${percentage}%`;
    progressValue.textContent = `${percentage}%`;
    progressLabel.textContent = `Downloading: ${title}`;
  });

  window.api.onQueueProgress((event, { current, total }) => {
    const percentage = Math.round((current / total) * 100);
    overallProgressBar.style.width = `${percentage}%`;
    overallProgressValue.textContent = `${percentage}%`;
    overallProgressLabel.textContent = `Overall Progress (${current} of ${total})`;
  });

  window.api.onSubredditComplete((event, completedUrl) => {
    const subToUpdate = subreddits.find((s) => s.url === completedUrl);
    if (subToUpdate) {
      if (autoClearToggle.checked) {
        subreddits = subreddits.filter((s) => s.url !== completedUrl);
      } else {
        subToUpdate.status = "complete";
      }
      renderSubreddits();
    }
  });

  window.api.onUpdateNotification((event, { message, showRestart }) => {
    notificationMessage.textContent = message;
    notification.classList.remove("hidden");
    restartButton.classList.toggle("hidden", !showRestart);
  });

  // ===== Initial Setup =====
  async function loadInitialSettings() {
    const savedPath = await window.api.getDownloadPath();
    downloadPathDisplay.textContent = savedPath;
    addLogMessage(
      "[INFO] Welcome! Choose a download location, then add subreddits."
    );
  }
  loadInitialSettings();
});
