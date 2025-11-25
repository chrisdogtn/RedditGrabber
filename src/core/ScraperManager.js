const fs = require('fs');
const path = require('path');

class ScraperManager {
  constructor() {
    this.scrapers = [];
  }

  register(scraper) {
    this.scrapers.push(scraper);
  }

  loadAll(directory) {
    if (!fs.existsSync(directory)) return;
    
    const files = fs.readdirSync(directory);
    for (const file of files) {
      if (file.endsWith('.js')) {
        try {
          const ScraperClass = require(path.join(directory, file));
          // Check if it's a class and extends ScraperBase (duck typing or instance check)
          if (typeof ScraperClass === 'function') {
            const instance = new ScraperClass();
            if (instance.getName && instance.canHandle && instance.scrape) {
              this.register(instance);
              console.log(`[ScraperManager] Registered: ${instance.getName()}`);
            }
          }
        } catch (error) {
          console.error(`[ScraperManager] Failed to load scraper ${file}:`, error);
        }
      }
    }
  }

  getScraper(url) {
    return this.scrapers.find(scraper => scraper.canHandle(url));
  }
  
  getAllScrapers() {
      return this.scrapers;
  }
}

module.exports = new ScraperManager();
