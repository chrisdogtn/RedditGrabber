// Global settings for RedditGrabber

// --- Download concurrency settings ---
const MAX_SIMULTANEOUS_DOWNLOADS = 20;
const MAX_DOWNLOADS_PER_DOMAIN = {
  "motherless.com": 2,
  "reddit.com": 10,
  "heavy-r.com": 1,
  "crazyshit.com": 10,
  default: 1, // fallback for all other domains
};

// --- yt-dlp and multi-thread extraction hosts ---
const YTDLP_EXTRACT_HOSTS = [
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
];

const YT_DLP_HOSTS = [
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
];

// --- Hosts to bypass multi-thread downloader and use yt-dlp directly ---
const BYPASS_YTDLP_HOSTS = ["pornpawg.com", "boy18tube.com", "motherless.com"];

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
  YTDLP_EXTRACT_HOSTS,
  YT_DLP_HOSTS,
  BYPASS_YTDLP_HOSTS,
  IMAGE_GALLERY_HOSTS,
  MOTHERLESS_HOST,
  YTDLP_CONCURRENT_FRAGMENTS,
  MULTI_THREAD_CHUNK_SIZE,
  MULTI_THREAD_CONNECTIONS,
};
