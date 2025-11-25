const ScraperBase = require('../core/ScraperBase');
const axios = require('axios');
const cheerio = require('cheerio');
const { BROWSER_USER_AGENT } = require('../utils/apiUtils');
const { sanitizeTitleForFilename } = require('../utils/stringUtils');

class HentaiEraScraper extends ScraperBase {
  getName() {
    return 'HentaiEra';
  }

  canHandle(url) {
    return /hentaiera\.com\//i.test(url);
  }

  async scrape(url, log) {
    const urlObject = new URL(url);
    
    // Match specific gallery pages
    if (urlObject.pathname.startsWith("/gallery/")) {
      return await this.scrapeHentaiEraGallery(url, log);
    } else {
      // Assume any other hentaiera.com link is a collection page (artist, tag, search, etc.)
      log(`[INFO] Detected HentaiEra collection page: ${url}`);
      return await this.scrapeHentaiEraCollection(url, log);
    }
  }

  async scrapeHentaiEraGallery(galleryUrl, log) {
    log(`[INFO] Scraping gallery: ${galleryUrl}`);
    try {
      const response = await axios.get(galleryUrl, {
        headers: { "User-Agent": BROWSER_USER_AGENT },
      });
      const html = response.data;
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
          domain: 'hentaiera.com'
        });
      }
  
      log(`[HentaiEra] Found ${downloadJobs.length} images in gallery "${galleryTitle}".`);
      return downloadJobs;
    } catch (error) {
      log(`[HentaiEra] Failed to scrape gallery ${galleryUrl}: ${error.message}`);
      return [];
    }
  }

  async scrapeHentaiEraCollection(collectionUrl, log) {
    log(`[INFO] Scraping collection: ${collectionUrl}`);
    try {
      const response = await axios.get(collectionUrl, {
        headers: { "User-Agent": BROWSER_USER_AGENT },
      });
      const html = response.data;
      const $ = cheerio.load(html);
  
      // Extract collection name for subfolder (e.g., Artist Name, Tag Name)
      let collectionName = $("h1").first().text().trim();
      if (!collectionName) collectionName = "HentaiEra_Collection";
      const collectionFolderName = sanitizeTitleForFilename(collectionName);
  
      // Find all gallery links
      const galleryLinks = [];
      $(".gallery_grid_item > a").each((i, el) => {
        let href = $(el).attr("href");
        if (href) {
          if (!href.startsWith("http")) {
             href = new URL(href, "https://hentaiera.com").href;
          }
          galleryLinks.push(href);
        }
      });
  
      log(`[HentaiEra] Found ${galleryLinks.length} galleries in collection "${collectionName}".`);
  
      const allDownloadJobs = [];
      // Process each gallery
      for (const galleryUrl of galleryLinks) {
        // Reuse scrapeHentaiEraGallery logic
        const galleryJobs = await this.scrapeHentaiEraGallery(galleryUrl, log);
        
        // Prepend the collection folder to the series folder for each job
        if (collectionFolderName && galleryJobs.length > 0) {
          galleryJobs.forEach((job) => {
            if (job.seriesFolder) {
              job.seriesFolder = `${collectionFolderName}/${job.seriesFolder}`;
            }
          });
        }
  
        allDownloadJobs.push(...galleryJobs);
      }
  
      return allDownloadJobs;
    } catch (error) {
      log(`[ERROR] Failed to scrape collection ${collectionUrl}: ${error.message}`);
      return [];
    }
  }
}

module.exports = HentaiEraScraper;
