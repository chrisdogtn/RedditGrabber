const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { app } = require('electron');

function getYtDlpPath() {
  // We need to handle the case where app is not ready or we are in a different context
  // But typically this runs in main process
  const isPackaged = app.isPackaged;
  const devPath = path.join(__dirname, '..', '..', 'bin', 'yt-dlp.exe');
  const prodPath = path.join(process.resourcesPath, 'bin', 'yt-dlp.exe');
  return isPackaged ? prodPath : devPath;
}

async function extractVideoUrlWithYtDlp(pageUrl, log, postId, postTitle, isCancelled = () => false) {
  return new Promise((resolve) => {
    const ytDlpPath = getYtDlpPath();
    if (!fs.existsSync(ytDlpPath)) {
      log(`[YTDLP-EXTRACT] yt-dlp.exe not found, falling back to regular download`);
      return resolve(null);
    }

    // Use yt-dlp to extract the direct video URL without downloading
    const args = ["--get-url", "--no-playlist", "--quiet", pageUrl];

    log(`[YTDLP-EXTRACT] Extracting direct URL from: ${pageUrl}`);
    const ytDlpProcess = spawn(ytDlpPath, args);
    let extractedUrl = "";
    let errorOutput = "";

    ytDlpProcess.stdout.on("data", (data) => {
      extractedUrl += data.toString().trim();
    });

    ytDlpProcess.stderr.on("data", (data) => {
      errorOutput += data.toString();
    });

    ytDlpProcess.on("close", (code) => {
      if (isCancelled()) {
        log(`[YTDLP-EXTRACT] Extraction cancelled: ${postTitle}`);
        return resolve(null);
      }

      if (code === 0 && extractedUrl) {
        // Clean up the URL (remove any extra whitespace/newlines)
        const cleanUrl = extractedUrl.split("\n")[0].trim();
        if (cleanUrl.startsWith("http")) {
          log(`[YTDLP-EXTRACT] Successfully extracted URL: ${cleanUrl.substring(0, 60)}...`);
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
        log(`[YTDLP-EXTRACT] Failed to extract URL from ${pageUrl}: ${errorOutput.trim()}`);
        resolve(null);
      }
    });

    ytDlpProcess.on("error", (err) => {
      log(`[YTDLP-EXTRACT] Process error: ${err.message}`);
      resolve(null);
    });
  });
}

async function getVideoMetadata(url, log) {
  return new Promise((resolve) => {
    const ytDlpPath = getYtDlpPath();
    if (!fs.existsSync(ytDlpPath)) {
      log(`[YTDLP-META] yt-dlp.exe not found`);
      return resolve(null);
    }

    // Use yt-dlp to dump json metadata
    const args = ["--dump-json", "--no-playlist", "--quiet", url];

    log(`[YTDLP-META] Fetching metadata for: ${url}`);
    const ytDlpProcess = spawn(ytDlpPath, args);
    let output = "";
    let errorOutput = "";

    ytDlpProcess.stdout.on("data", (data) => {
      output += data.toString();
    });

    ytDlpProcess.stderr.on("data", (data) => {
      errorOutput += data.toString();
    });

    ytDlpProcess.on("close", (code) => {
      if (code === 0 && output) {
        try {
          const metadata = JSON.parse(output);
          resolve({
            title: metadata.title || "unknown_title",
            id: metadata.id || Date.now().toString(),
            uploader: metadata.uploader || null,
            duration: metadata.duration || null,
            view_count: metadata.view_count || null,
            url: url
          });
        } catch (e) {
          log(`[YTDLP-META] Failed to parse JSON: ${e.message}`);
          resolve(null);
        }
      } else {
        log(`[YTDLP-META] Failed to fetch metadata: ${errorOutput.trim()}`);
        resolve(null);
      }
    });

    ytDlpProcess.on("error", (err) => {
      log(`[YTDLP-META] Process error: ${err.message}`);
      resolve(null);
    });
  });
}

module.exports = { extractVideoUrlWithYtDlp, getYtDlpPath, getVideoMetadata };
