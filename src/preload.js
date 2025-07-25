const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  // To send data from renderer to main
  startDownload: (options) => ipcRenderer.send("start-download", options),
  openFile: () => ipcRenderer.invoke("dialog:openFile"),
  setDownloadPath: () => ipcRenderer.invoke("dialog:setDownloadPath"),
  getDownloadPath: () => ipcRenderer.invoke("settings:getDownloadPath"),
  restartApp: () => ipcRenderer.send("restart_app"),
  stopDownload: () => ipcRenderer.send("stop-download"),
  skipSubreddit: () => ipcRenderer.send("skip-subreddit"),

  // To receive data from main in renderer
  onLogUpdate: (callback) => ipcRenderer.on("log-update", callback),
  onDownloadProgress: (callback) =>
    ipcRenderer.on("download-progress", callback),
  onSubredditComplete: (callback) =>
    ipcRenderer.on("subreddit-complete", callback),
  onUpdateNotification: (callback) =>
    ipcRenderer.on("update-notification", callback),
  onQueueProgress: (callback) => ipcRenderer.on("queue-progress", callback),
  onYtDlpProgress: (callback) => ipcRenderer.on("ytdlp-progress", callback),
  onUpdateDownloadProgress: (callback) =>
    ipcRenderer.on("update-download-progress", callback),
  getYtDlpWhitelist: () => ipcRenderer.invoke("getYtDlpWhitelist"),

  // Download queue management
  getActiveDownloads: () => ipcRenderer.invoke("get-active-downloads"),

  onDownloadQueueUpdated: (callback) =>
    ipcRenderer.on("download-queue-updated", callback),

  // Generic event bridge for all events (including main-queue-updated)
  on: (channel, listener) => {
    // Only allow certain channels for security
    const validChannels = [
      "main-queue-updated",
      "download-queue-updated",
      "log-update",
      "download-progress",
      "subreddit-complete",
      "update-notification",
      "queue-progress",
      "ytdlp-progress",
      "update-download-progress",
    ];
    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, listener);
    }
  },

  // Clipboard access
  readClipboard: () => navigator.clipboard.readText(),
});
