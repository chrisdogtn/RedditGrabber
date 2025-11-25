const ScraperBase = require('../core/ScraperBase');
const axios = require('axios');
const cheerio = require('cheerio');
const { BROWSER_USER_AGENT } = require('../utils/apiUtils');

class CrazyshitScraper extends ScraperBase {
  getName() {
    return 'Crazyshit';
  }

  canHandle(url) {
    return /crazyshit\.com\/series\//i.test(url);
  }

  async scrape(url, log) {
    const crazyshitSeriesMatch = url.match(
      /^https?:\/\/(?:www\.)?crazyshit\.com\/series\/([^\/?#]+)\/?/i
    );
    if (crazyshitSeriesMatch) {
      const seriesName = crazyshitSeriesMatch[1];
      log(`[INFO] Detected crazyshit.com series: ${seriesName}`);
      const links = await this.scrapeCrazyshitSeriesPage(url, log);
      // Add seriesFolder property for subfolder organization
      links.forEach((link) => {
        link.seriesFolder = seriesName;
        link.domain = 'crazyshit.com';
      });
      log(`[INFO] [crazyshit.com] Found ${links.length} videos in series '${seriesName}'.`);
      return links;
    }
    return [];
  }

  async scrapeCrazyshitSeriesPage(seriesUrl, log) {
    try {
      const axiosResponse = await axios.get(seriesUrl, {
        headers: { "User-Agent": BROWSER_USER_AGENT },
      });
      const html = axiosResponse.data;
      const $ = cheerio.load(html);
      const videoLinks = [];
      // Find all <a class="thumb"> inside <div class="tile">
      $("div.tile a.thumb").each((i, el) => {
        const href = $(el).attr("href");
        const title =
          $(el).attr("title") ||
          $(el).find("img[alt]").attr("alt") ||
          "crazyshit_video";
        if (href && href.includes("/cnt/medias/")) {
          videoLinks.push({
            url: href,
            type: "video",
            downloader: "ytdlp",
            id: `${Date.now()}_${i}`,
            title: title.trim(),
          });
        }
      });
      return videoLinks;
    } catch (err) {
      log(`[ERROR] Failed to scrape crazyshit.com series page: ${err.message}`);
      return [];
    }
  }
}

module.exports = CrazyshitScraper;
