class ScraperBase {
  constructor() {
    if (this.constructor === ScraperBase) {
      throw new Error("Abstract class 'ScraperBase' cannot be instantiated directly.");
    }
  }

  /**
   * Returns the name of the scraper.
   * @returns {string}
   */
  getName() {
    throw new Error("Method 'getName()' must be implemented.");
  }

  /**
   * Checks if the scraper can handle the given URL.
   * @param {string} url
   * @returns {boolean}
   */
  canHandle(url) {
    throw new Error("Method 'canHandle(url)' must be implemented.");
  }

  /**
   * Scrapes the given URL for media links.
   * @param {string} url
   * @param {function} log - Logging function
   * @param {object} options - Additional options
   * @returns {Promise<Array>} - Array of media objects
   */
  async scrape(url, log, options = {}) {
    throw new Error("Method 'scrape(url, log, options)' must be implemented.");
  }
}

module.exports = ScraperBase;
