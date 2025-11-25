const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const BROWSER_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

let redgifsToken = null;

async function getRedgifsToken(log) {
  if (redgifsToken) return redgifsToken;
  try {
    if (log) log("[Auth] Requesting Redgifs token...");
    const response = await fetch("https://api.redgifs.com/v2/auth/temporary", {
      headers: { "User-Agent": BROWSER_USER_AGENT },
    });
    if (!response.ok) throw new Error(`Status: ${response.status}`);
    const data = await response.json();
    if (data?.token) {
      redgifsToken = data.token;
      return redgifsToken;
    }
    throw new Error("Invalid token format.");
  } catch (error) {
    if (log) log(`[Auth] Redgifs token error: ${error.message}`);
    return null;
  }
}

module.exports = { getRedgifsToken, BROWSER_USER_AGENT };
