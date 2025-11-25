function sanitizeTitleForFilename(title, maxLength = 80) {
  if (!title) return "untitled";

  // Whitelist of safe characters. Anything not in this list will be removed.
  const whitelist = /[^a-zA-Z0-9\s\-_\[\]\(\)\{\}]/g;

  // 1. Remove any character that is not in the whitelist.
  let sanitized = title.replace(whitelist, "");

  // 2. Replace whitespace with a single underscore.
  sanitized = sanitized.replace(/\s+/g, "_");

  // 3. Truncate to the specified maximum length.
  if (sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength);
  }

  // 4. Clean up any trailing/leading underscores that might result from truncation.
  sanitized = sanitized.replace(/^_+|_+$/g, "");

  return sanitized || "untitled";
}

function extractName(url) {
  try {
    return url.match(/\/r\/([a-zA-Z0-9_]+)/)?.[1] || null;
  } catch {
    return null;
  }
}

module.exports = { sanitizeTitleForFilename, extractName };
