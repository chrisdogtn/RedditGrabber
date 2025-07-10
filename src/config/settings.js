// Global settings for RedditGrabber

// --- Download concurrency settings ---
const MAX_SIMULTANEOUS_DOWNLOADS = 8;
const MAX_DOWNLOADS_PER_DOMAIN = {
  "motherless.com": 2,
  "reddit.com": 10,
  "heavy-r.com": 1,
  "crazyshit.com": 5,
  "hentaiera.com": 8,
  "thisvid.com": 5,
  "xhamster.com": 5,
  "cuteboytube.com": 5,
  "boy18tube.com": 5,
  "qosvideos.com": 5,
  "pmvhaven.com": 5,
  "efukt.com": 5,
  "pervertium.com": 5,
  "ashemaletube.com": 5,
  default: 4, // fallback for all other domains
};

// --- Hybrid extraction hosts (yt-dlp for extraction, multi-thread for download) ---
const HYBRID_EXTRACTION_HOSTS = [
  "thisvid.com",
  "xhamster.com",
  "pornhub.com",
  "xvideos.com",
  "hypnotube.com",
  "webmshare.com",
  "ratedgross.com",
  "pervertium.com",
  "efukt.com",
  "sissyhypno.com",
  "boy18tube.com",
  "cuteboytube.com",
  "pornpawg.com",
  "heavy-r.com",
  "crazyshit.com",
  "motherless.com",
  "qosvideos.com",
  "pmvhaven.com",
  "nsfw.sex"
 
];

// --- main whitelist ---
const YTDLP_SUPPORTED_HOSTS = [
  "youtube.com",
  "youtu.be",
  "x.com",
  "facebook.com",
  "twitch.tv",
  "instagram.com",
  "xhamster.com",
  "pornhub.com",
  "hypnotube.com",
  "xvideos.com",
  "twitter.com",
  "thisvid.com",
  "webmshare.com",
  "pmvhaven.com",
  "ratedgross.com",
  "pervertium.com",
  "crazyshit.com",
  "efukt.com",
  "sissyhypno.com",
  "boy18tube.com",
  "cuteboytube.com",
  "pornpawg.com",
  "qosvideos.com",
  "heavy-r.com",
  "hentaiera.com",
  "motherless.com",
  "ashemaletube.com",
  "luxuretv.com",
  "spankbang.com",
  "womennaked.net",
  "nsfw.sex"
];

// --- Hosts that should always use yt-dlp (never multi-thread) ---
const FORCE_YTDLP_ONLY_HOSTS = [
  "pornpawg.com",
  "boy18tube.com",
  "motherless.com",
  "ashemaletube.com",
  "xhamster.com",
  "pornhub.com",
  "youtube.com",
  "youtu.be",
];

// --- Hosts that require special image gallery scraping ---
const IMAGE_GALLERY_HOSTS = ["hentaiera.com"];
const MOTHERLESS_HOST = "motherless.com";

// --- yt-dlp fragment concurrency ---
const YTDLP_CONCURRENT_FRAGMENTS = 8; // 1-16 recommended

// --- Multi-threaded download settings ---
const MULTI_THREAD_CHUNK_SIZE = 1024 * 1024; // 1MB
const MULTI_THREAD_CONNECTIONS = 20;

module.exports = {
  MAX_SIMULTANEOUS_DOWNLOADS,
  MAX_DOWNLOADS_PER_DOMAIN,
  HYBRID_EXTRACTION_HOSTS,
  YTDLP_SUPPORTED_HOSTS,
  FORCE_YTDLP_ONLY_HOSTS,
  IMAGE_GALLERY_HOSTS,
  MOTHERLESS_HOST,
  YTDLP_CONCURRENT_FRAGMENTS,
  MULTI_THREAD_CHUNK_SIZE,
  MULTI_THREAD_CONNECTIONS,
};
