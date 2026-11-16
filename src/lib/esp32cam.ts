// URLs for an ESP32-CAM: the standard CameraWebServer firmware (and firmware/esp32cam)
// serve MJPEG on port 81 at /stream and a single JPEG on port 80 at /capture. A camera
// pushing to the PC relay (edge/cam_relay.py) is watched at /cam/<id>.mjpg on the PC,
// with the newest frame at /cam/<id>.jpg.

export function cameraUrls(streamUrl: string) {
  try {
    const u = new URL(streamUrl);
    const isStdStream = u.port === "81" && u.pathname.replace(/\/$/, "") === "/stream";
    const isRelay = /^\/cam\/[\w-]+\.mjpg$/.test(u.pathname);
    const snapshot = isStdStream
      ? `${u.protocol}//${u.hostname}/capture`
      : isRelay
        ? streamUrl.replace(/\.mjpg$/, ".jpg")
        : null;
    return { host: u.hostname, snapshot, isStdStream, isRelay };
  } catch {
    return { host: streamUrl, snapshot: null, isStdStream: false, isRelay: false };
  }
}

/** CSS that turns a camera picture mounted at 90/270 degrees upright (180 is done in the camera). */
export function rotationStyle(rotation: number): React.CSSProperties | undefined {
  if (rotation !== 90 && rotation !== 270) return undefined;
  // Turned sideways, a 4:3 picture in a 16:9 box has to shrink to fit its height.
  return { transform: `rotate(${rotation}deg) scale(0.75)` };
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
