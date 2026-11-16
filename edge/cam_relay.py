"""PoultryGrid camera relay (PG-CAM push): low-latency live video from the ESP32-CAMs.

The stock ESP32-CAM serves its MJPEG stream to one viewer at a time, from a small chip
that also has to capture. Here the camera does the least work possible instead: it
finds this PC and *pushes* every frame, the moment it's captured, over one TCP
connection (TCP_NODELAY on both ends, so nothing is held back to fill packets). This
relay keeps only the newest frame per camera and fans it out:

    ESP32-CAM --PG-CAM push (TCP :5006)--> relay --MJPEG http://<pc>:5007/cam/<id>.mjpg--> every viewer
                                                 --JPEG  http://<pc>:5007/cam/<id>.jpg ---> vision worker

Slow viewers never slow the camera or each other: each gets the newest frame when it is
ready for one (old frames are skipped, not queued), so the delay stays one frame.

Protocol (PG-CAM/1):
  discovery  camera -> UDP broadcast :5006  "PG-CAM?"
             relay  -> reply                "PG-CAM 5006 5007"      (push port, http port)
  handshake  camera -> TCP :5006            "PGCAM/1 <device-id> <api-key>\\n"
             relay  -> "OK <camera-id> <stream-url>\\n"  or  "ERR <reason>\\n"
  frames     camera -> repeated: 4-byte big-endian length, then that many bytes of JPEG
The relay checks the camera's key with the site (GET /api/public/devices/vision, as that
camera), so only cameras registered on your account are relayed. The camera then tells
the site the relay URL in its check-in, so the Cameras page and the vision worker use it.
If the PC goes away, the camera falls back to its own /stream within seconds.

    python cam_relay.py            # npm start runs this for you
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import struct
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

HERE = Path(__file__).parent
log = logging.getLogger("poultrygrid.camrelay")

PUSH_PORT = int(os.environ.get("PG_CAM_PUSH_PORT", "5006"))
HTTP_PORT = int(os.environ.get("PG_CAM_HTTP_PORT", "5007"))
API_URL = os.environ.get("PG_API_URL", "https://ghana-poultry-vision.vercel.app").rstrip("/")
MAX_FRAME = 1_500_000
BOUNDARY = b"pgcamframe"


@dataclass
class Cam:
    id: str
    name: str
    frame: bytes = b""
    seq: int = 0
    at: float = 0.0
    fps: float = 0.0
    connected: bool = False
    new_frame: asyncio.Event = field(default_factory=asyncio.Event)


cams: dict[str, Cam] = {}
_auth_cache: dict[tuple[str, str], tuple[float, dict | None]] = {}


def _check_with_site(device_id: str, api_key: str) -> dict | None:
    """The camera's own entry from the site, or None if the key is wrong."""
    req = urllib.request.Request(
        f"{API_URL}/api/public/devices/vision",
        headers={"x-device-id": device_id, "x-api-key": api_key, "user-agent": "poultrygrid-camrelay/1"},
    )
    with urllib.request.urlopen(req, timeout=10) as r:
        listed = json.loads(r.read() or b"{}").get("cameras", [])
    return next((c for c in listed if c.get("device_code") == device_id), None)


async def authorise(device_id: str, api_key: str) -> dict | None:
    key = (device_id, api_key)
    hit = _auth_cache.get(key)
    # A known camera is trusted for 10 minutes; a refusal is re-checked after 30 s.
    if hit and time.time() - hit[0] < (600 if hit[1] else 30):
        return hit[1]
    try:
        cam = await asyncio.to_thread(_check_with_site, device_id, api_key)
    except urllib.error.HTTPError as e:
        cam = None if e.code in (401, 403) else (hit[1] if hit else None)
    except (urllib.error.URLError, OSError, ValueError):
        # Site unreachable (internet down): keep relaying a camera we already know.
        return hit[1] if hit else None
    _auth_cache[key] = (time.time(), cam)
    return cam


# ---------------------------------------------------------------- push (camera side)


async def handle_push(reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
    peer = writer.get_extra_info("peername")
    sock = writer.get_extra_info("socket")
    if sock is not None:
        import socket

        sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
    cam = None
    try:
        line = (await asyncio.wait_for(reader.readline(), 10)).decode(errors="replace").split()
        if len(line) != 3 or line[0] != "PGCAM/1":
            writer.write(b"ERR bad handshake\n")
            return
        info = await authorise(line[1], line[2])
        if not info:
            writer.write(b"ERR unknown camera or wrong key\n")
            log.warning("Refused camera %s from %s", line[1], peer[0])
            return
        local_ip = writer.get_extra_info("sockname")[0]
        url = f"http://{local_ip}:{HTTP_PORT}/cam/{info['id']}.mjpg"
        cam = cams.get(info["id"]) or Cam(info["id"], info["name"])
        cams[cam.id] = cam
        cam.connected = True
        writer.write(f"OK {cam.id} {url}\n".encode())
        await writer.drain()
        log.info("%s connected from %s, pushing frames -> %s", cam.name, peer[0], url)

        last = time.monotonic()
        while True:
            (n,) = struct.unpack(">I", await asyncio.wait_for(reader.readexactly(4), 15))
            if not 0 < n <= MAX_FRAME:
                raise ValueError(f"bad frame length {n}")
            data = await asyncio.wait_for(reader.readexactly(n), 15)
            now = time.monotonic()
            cam.fps = 0.9 * cam.fps + 0.1 * (1.0 / max(now - last, 1e-3))
            last = now
            cam.frame, cam.seq, cam.at = data, cam.seq + 1, time.time()
            # Wake every viewer waiting for a frame, then reset for the next one.
            cam.new_frame.set()
            cam.new_frame = asyncio.Event()
    except (asyncio.IncompleteReadError, asyncio.TimeoutError, ConnectionError, ValueError, OSError) as e:
        if cam:
            log.info("%s disconnected (%s)", cam.name, type(e).__name__)
    finally:
        if cam:
            cam.connected = False
            cam.new_frame.set()
        try:
            await writer.drain()
            writer.close()
        except (ConnectionError, OSError):
            pass


class Discovery(asyncio.DatagramProtocol):
    def connection_made(self, transport):
        self.transport = transport

    def datagram_received(self, data, addr):
        if data.strip().startswith(b"PG-CAM?"):
            self.transport.sendto(f"PG-CAM {PUSH_PORT} {HTTP_PORT}".encode(), addr)


# ---------------------------------------------------------------- http (viewer side)


async def handle_http(reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
    sock = writer.get_extra_info("socket")
    if sock is not None:
        import socket

        sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
    try:
        req = (await asyncio.wait_for(reader.readline(), 10)).decode(errors="replace").split()
        while (await asyncio.wait_for(reader.readline(), 10)) not in (b"\r\n", b"\n", b""):
            pass
        path = req[1].split("?")[0] if len(req) > 1 else "/"
        if path in ("/", "/health"):
            body = json.dumps({
                "ok": True,
                "cameras": {c.id: {"name": c.name, "connected": c.connected, "fps": round(c.fps, 1),
                                   "age_ms": round((time.time() - c.at) * 1000) if c.at else None}
                            for c in cams.values()},
            }).encode()
            return await _send(writer, 200, "application/json", body)
        if path.startswith("/cam/") and (path.endswith(".mjpg") or path.endswith(".jpg")):
            cam = cams.get(path[5:].rsplit(".", 1)[0])
            if not cam or not cam.frame:
                return await _send(writer, 404, "text/plain", b"camera not connected to this relay")
            if path.endswith(".jpg"):
                return await _send(writer, 200, "image/jpeg", cam.frame)
            await _mjpeg(writer, cam)
            return
        await _send(writer, 404, "text/plain", b"not found")
    except (asyncio.TimeoutError, ConnectionError, OSError, IndexError):
        pass
    finally:
        try:
            writer.close()
        except (ConnectionError, OSError):
            pass


async def _send(writer, code: int, ctype: str, body: bytes):
    writer.write(
        f"HTTP/1.1 {code} {'OK' if code == 200 else 'Not Found'}\r\nContent-Type: {ctype}\r\n"
        f"Content-Length: {len(body)}\r\nCache-Control: no-store\r\nAccess-Control-Allow-Origin: *\r\n"
        f"Connection: close\r\n\r\n".encode() + body
    )
    await writer.drain()


async def _mjpeg(writer, cam: Cam):
    writer.write(
        b"HTTP/1.1 200 OK\r\nContent-Type: multipart/x-mixed-replace;boundary=" + BOUNDARY +
        b"\r\nCache-Control: no-store\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n"
    )
    sent = -1
    while True:
        if cam.seq == sent:
            ev = cam.new_frame
            try:
                await asyncio.wait_for(ev.wait(), 20)
            except asyncio.TimeoutError:
                if not cam.connected:
                    return
                continue
        if not cam.connected and cam.seq == sent:
            return
        frame, sent = cam.frame, cam.seq  # always the newest; anything older is skipped
        writer.write(b"--" + BOUNDARY + b"\r\nContent-Type: image/jpeg\r\nContent-Length: " +
                     str(len(frame)).encode() + b"\r\n\r\n" + frame + b"\r\n")
        await writer.drain()  # a slow viewer waits here, without holding anyone else up


async def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s", stream=sys.stdout)
    loop = asyncio.get_running_loop()
    await loop.create_datagram_endpoint(Discovery, local_addr=("0.0.0.0", PUSH_PORT))
    push = await asyncio.start_server(handle_push, "0.0.0.0", PUSH_PORT)
    http = await asyncio.start_server(handle_http, "0.0.0.0", HTTP_PORT)
    log.info("Camera relay: PG-CAM push on :%d (TCP+UDP), viewers on http://<this-pc>:%d/cam/<id>.mjpg -> %s",
             PUSH_PORT, HTTP_PORT, API_URL)
    async with push, http:
        await asyncio.gather(push.serve_forever(), http.serve_forever())


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
