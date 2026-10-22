// URLs for an ESP32-CAM running the standard CameraWebServer firmware:
// MJPEG stream on port 81 at /stream, a single JPEG on port 80 at /capture.

export function cameraUrls(streamUrl: string) {
  try {
    const u = new URL(streamUrl);
    const isStdStream = u.port === "81" && u.pathname.replace(/\/$/, "") === "/stream";
    const snapshot = isStdStream ? `${u.protocol}//${u.hostname}/capture` : null;
    return { host: u.hostname, snapshot, isStdStream };
  } catch {
    return { host: streamUrl, snapshot: null, isStdStream: false };
  }
}

/** True when an https page would load an http stream (browsers block or upgrade it). */
export function isMixedContent(streamUrl: string) {
  return (
    typeof window !== "undefined" &&
    window.location.protocol === "https:" &&
    /^http:\/\//i.test(streamUrl)
  );
}

/** Appends a cache-busting param so a reconnect opens a fresh connection. */
export function withBust(url: string, n: number) {
  if (!n) return url;
  return `${url}${url.includes("?") ? "&" : "?"}_r=${n}`;
}
