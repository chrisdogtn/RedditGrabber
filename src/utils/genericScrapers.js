const axios = require('axios');
const { BROWSER_USER_AGENT } = require('./apiUtils');

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
        if (log) log(`[Imgur Album] Found ${postData.media.length} images in album.`);
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
        if (log) log(`[Imgur Album] Fallback scraper found ${foundImages.size} images.`);
        images.push(...foundImages);
      }
    }
  } catch (error) {
    if (log) log(`[Parser] Failed to scrape Imgur album at ${albumUrl}: ${error.message}`);
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

module.exports = { scrapeImgurAlbum, scrapeXhamsterPage };
