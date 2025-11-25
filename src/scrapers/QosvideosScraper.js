const ScraperBase = require('../core/ScraperBase');
const axios = require('axios');
const { BROWSER_USER_AGENT } = require('../utils/apiUtils');

class QosvideosScraper extends ScraperBase {
  getName() {
    return 'Qosvideos';
  }

  canHandle(url) {
    return /qosvideos\.com\/\S+/i.test(url);
  }

  async scrape(url, log) {
    log(`[INFO] Detected qosvideos.com video page.`);
    try {
      const response = await axios.get(url, {
        headers: { "User-Agent": BROWSER_USER_AGENT },
      });
      const html = response.data;
      // Extract contentURL
      const contentUrlMatch = html.match(
        /<meta\s+itemprop="contentURL"\s+content="([^"]+)"/i
      );
      // Extract name
      const nameMatch = html.match(
        /<meta\s+itemprop="name"\s+content="([^"]+)"/i
      );
      if (contentUrlMatch && contentUrlMatch[1]) {
        return [{
            url: contentUrlMatch[1],
            title: nameMatch && nameMatch[1] ? nameMatch[1] : "qosvideos_video",
            type: 'video',
            downloader: 'ytdlp',
            id: Date.now().toString(),
            domain: 'qosvideos.com'
        }];
      } else {
        log(`[ERROR] Could not extract video from qosvideos.com page.`);
        return [];
      }
    } catch (err) {
      log(`[ERROR] Failed to scrape qosvideos.com page: ${err.message}`);
      return [];
    }
  }
}

module.exports = QosvideosScraper;
