const ScraperBase = require('../core/ScraperBase');
const axios = require('axios');

class PmvhavenScraper extends ScraperBase {
  getName() {
    return 'Pmvhaven';
  }

  canHandle(url) {
    return /pmvhaven\.com\/(profile|video)\//i.test(url);
  }

  async scrape(url, log) {
    const pmvhavenProfileMatch = url.match(
      /^https?:\/\/(?:www\.)?pmvhaven\.com\/profile\/([^\/?#]+)/i
    );
    const pmvhavenVideoMatch = url.match(
      /^https?:\/\/(?:www\.)?pmvhaven\.com\/video\//i
    );

    if (pmvhavenProfileMatch) {
      const username = pmvhavenProfileMatch[1];
      log(`[INFO] Detected pmvhaven.com profile: ${username}`);
      const links = await this.fetchPmvhavenProfileVideos(username, log);
      log(`[INFO] [pmvhaven] Found ${links.length} videos/favorites for profile ${username}.`);
      return links;
    }

    if (pmvhavenVideoMatch) {
      // Direct video, handled by yt-dlp
      return [
        {
          url: url,
          type: "video",
          downloader: "ytdlp",
          id: Date.now().toString(),
          title: url,
          domain: 'pmvhaven.com'
        },
      ];
    }
    
    return [];
  }

  async fetchPmvhavenProfileVideos(username, log) {
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
          log(
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
                domain: 'pmvhaven.com'
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
          log(
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
                domain: 'pmvhaven.com'
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
}

module.exports = PmvhavenScraper;
