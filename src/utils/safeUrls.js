export function normalizeExternalUrl(value) {
  const text = String(value || "").trim();
  if (!text || [...text].some(char => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127 || char === "\\")) return null;
  // Reject explicit non-HTTP schemes before adding HTTPS to a bare hostname.
  if (/^[a-z][a-z0-9+.-]*:/i.test(text) && !/^https?:\/\//i.test(text)) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || !url.hostname) return null;
    return url.href;
  } catch {
    return null;
  }
}
