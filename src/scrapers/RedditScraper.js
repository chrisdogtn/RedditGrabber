const ScraperBase = require('../core/ScraperBase');
const { extractName, sanitizeTitleForFilename } = require('../utils/stringUtils');
const { getRedgifsToken, BROWSER_USER_AGENT } = require('../utils/apiUtils');
const { extractVideoUrlWithYtDlp } = require('../utils/ytDlpUtils');
const { scrapeImgurAlbum, scrapeXhamsterPage } = require('../utils/genericScrapers');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const fs = require('fs');
const path = require('path');
const settings = require('../config/settings'); // Assuming settings are here or need to be passed

class RedditScraper extends ScraperBase {
  getName() {
    return 'Reddit';
  }

  canHandle(url) {
    return /reddit\.com\/r\/[a-zA-Z0-9_]+/i.test(url);
  }

  async scrape(url, log, options = {}) {
    const { 
      pageStart = 1, 
      pageEnd = 0, 
      maxLinks = 0, 
      fileTypes = { images: true, gifs: true, videos: true },
      isCancelled = () => false,
      isSkipping = () => false,
      unhandledLogPath
    } = options;

    let allLinks = [];
    let after = null;
    let postCount = 0;
    let currentPage = 1;
    const hasPageEnd = pageEnd > 0 && pageEnd >= pageStart;
    const fetchOptions = {
      headers: { "User-Agent": BROWSER_USER_AGENT, Cookie: "over18=1" },
    };

    log(`[INFO] Scanning for up to ${maxLinks || "unlimited"} links...`);

    do {
      if (isCancelled() || isSkipping()) {
        log(`[INFO] Scan for ${extractName(url)} cancelled/skipped.`);
        break;
      }
      if (maxLinks > 0 && allLinks.length >= maxLinks) {
        log(`[INFO] Reached download limit of ${maxLinks}.`);
        break;
      }
      if (hasPageEnd && currentPage > pageEnd) {
        log(`[INFO] Reached page limit of ${pageEnd}.`);
        break;
      }
      if (currentPage > 1 && !after) {
        log(`[INFO] No more pages available from Reddit API.`);
        break;
      }

      // Page Skipping Logic
      if (currentPage < pageStart) {
        const skipUrl = new URL(`${url.replace(/\/$/, "")}.json`);
        skipUrl.searchParams.set("limit", "25");
        if (after) skipUrl.searchParams.set("after", after);

        log(`[INFO] Skipping page ${currentPage} to reach start page ${pageStart}...`);
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

      const apiUrl = new URL(`${url.replace(/\/$/, "")}.json`);
      apiUrl.searchParams.set("limit", "25");
      apiUrl.searchParams.set("count", postCount);
      if (after) apiUrl.searchParams.set("after", after);

      log(`[INFO] Fetching page ${currentPage} (API count: ${postCount})`);

      try {
        const response = await fetch(apiUrl.toString(), fetchOptions);
        if (!response.ok) {
          log(`[ERROR] Fetch failed for ${extractName(url)}. Status: ${response.status}`);
          break;
        }
        const data = await response.json();
        if (!data.data?.children?.length) {
          log(`[INFO] No more posts found on this page.`);
          break;
        }
        const posts = data.data.children;
        for (const post of posts) {
          if (maxLinks > 0 && allLinks.length >= maxLinks) {
            after = null;
            break;
          }
          const mediaFromPost = await this.extractMediaUrlsFromPost(
            post.data,
            log,
            unhandledLogPath,
            options.settings || settings // Pass settings if available
          );
          allLinks.push(...mediaFromPost);
        }

        postCount += posts.length;
        after = data.data.after;
        currentPage++;
        if (!after) {
          log(`[INFO] Reached the end of the subreddit listing.`);
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      } catch (error) {
        log(`[FATAL] A network error occurred while fetching ${url}: ${error.message}`);
        break;
      }
    } while (true);

    log(`[INFO] Scan complete. Found ${allLinks.length} potential links after scanning ${postCount} posts.`);
    
    const filteredLinks = allLinks.filter(
      (link) =>
        (fileTypes.images && link.type === "image") ||
        (fileTypes.gifs && link.type === "gif") ||
        (fileTypes.videos && link.type === "video")
    );
    
    if (maxLinks > 0) return filteredLinks.slice(0, maxLinks);
    return filteredLinks;
  }

  async extractMediaUrlsFromPost(originalPostData, log, unhandledLogPath, appSettings) {
    const postData = originalPostData.crosspost_parent_list?.[0] || originalPostData;
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

    // Use settings from options or require them
    const FORCE_YTDLP_ONLY_HOSTS = appSettings?.FORCE_YTDLP_ONLY_HOSTS || [];
    const HYBRID_EXTRACTION_HOSTS = appSettings?.HYBRID_EXTRACTION_HOSTS || [];
    const YTDLP_SUPPORTED_HOSTS = appSettings?.YTDLP_SUPPORTED_HOSTS || [];

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
        urls.push({
          url: postUrl,
          type: "video",
          downloader: "ytdlp",
          id: postId,
          title: postTitle,
        });
      } else if (HYBRID_EXTRACTION_HOSTS.some((host) => domain.includes(host))) {
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
            downloader: "multi-thread",
            id: postId,
            title: extractedInfo.title || postTitle,
          });
        } else {
          urls.push({
            url: postUrl,
            type: "video",
            downloader: "ytdlp",
            id: postId,
            title: postTitle,
          });
        }
      } else {
        if (domain.includes("crazyshit.com") && /\/series\//i.test(postUrl)) {
           // Skip, handled by Crazyshit scraper if we were routing correctly, 
           // but here we are inside a Reddit post? 
           // Actually Reddit posts pointing to Crazyshit series are rare but possible.
           // We'll leave it as is.
        } else if (YTDLP_SUPPORTED_HOSTS.some((host) => domain.includes(host))) {
          urls.push({
            url: postUrl,
            type: "video",
            downloader: "ytdlp",
            id: postId,
            title: postTitle,
          });
        } else {
          if (unhandledLogPath) {
             try {
                fs.appendFileSync(unhandledLogPath, `${postUrl}\n`);
             } catch(e) {}
          }
        }
      }
    } catch (error) {
      log(`[Parser] Failed for post "${postTitle}": ${error.message}`);
    }
    return urls;
  }
}

module.exports = RedditScraper;
