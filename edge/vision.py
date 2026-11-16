"""PoultryGrid camera vision: YOLO11n on each ESP32-CAM -> pests and inactive birds -> the app.

Runs anywhere on the farm network: the Raspberry Pi, or a Windows / macOS / Linux PC.
Only needs onnxruntime, numpy and Pillow (no PyTorch, no OpenCV):

    pip install -r requirements-vision.txt
    python vision.py                          # every camera on the Cameras page
    python vision.py --once --dry-run         # one pass, print instead of sending
    python vision.py --image coop.jpg         # test the model on a photo, writes coop.annotated.jpg
    python vision.py --camera http://192.168.1.40:81/stream --dry-run   # one camera, no app

Settings come from the environment, vision.env, or agent.env next to this file
(the same PG_API_URL / PG_DEVICE_ID / PG_DEVICE_API_KEY the Pi agent uses; on a PC,
register a device under Devices and use its ID and key). See README.md, "Camera vision".

What it does for each camera, every few seconds:
  1. grabs one JPEG (the ESP32-CAM's /capture on port 80, so it doesn't take the
     one MJPEG stream away from people watching; any other URL is read as MJPEG)
  2. runs YOLO11n (models/yolo11n.onnx)
  3. tracks each bird from frame to frame. A bird whose box hasn't moved for
     PG_INACTIVE_MIN minutes is "inactive" (sick, injured, or dead birds sit still),
     and the share of birds that moved in the last minute is the flock's activity
  4. any pest or predator class (cat, dog, and rat/snake/hawk... with a fine-tuned
     model) is an event straight away
and reports to the app every PG_VISION_REPORT_S seconds, or at once on a new event,
with a small annotated frame. Events also open alerts on the Alerts page.

Stock YOLO11n is trained on COCO: it finds chickens as "bird" and knows cat and dog,
but not rats or snakes, and a low ESP32-CAM picture from above is harder than a
photo. Fine-tune it on your own coop for real accuracy (README.md shows how); the
new model's class names are picked up automatically.
"""

from __future__ import annotations

import argparse
import ast
import base64
import datetime as dt
import io
import json
import logging
import os
import socket
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).parent
log = logging.getLogger("poultrygrid.vision")
VERSION = "vision 1.0"


def _load_env_file(path: Path):
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def _csv(v: str) -> set[str]:
    return {x.strip().lower() for x in v.split(",") if x.strip()}


@dataclass
class Config:
    api_url: str
    device_id: str
    api_key: str
    model_path: Path
    conf: float
    interval_s: float
    report_s: float
    inactive_min: float
    low_activity: float
    quiet_hours: tuple[int, int] | None
    bird_classes: set[str]
    pest_classes: set[str]
    worker: str
    img_size: int

    @classmethod
    def from_env(cls) -> "Config":
        e = os.environ.get
        quiet = e("PG_VISION_QUIET_HOURS", "19-6").strip()
        q = None
        if quiet and quiet != "0":
            a, b = quiet.split("-")
            q = (int(a), int(b))
        return cls(
            api_url=e("PG_API_URL", "http://localhost:3000").rstrip("/"),
            device_id=e("PG_DEVICE_ID", ""),
            api_key=e("PG_DEVICE_API_KEY", ""),
            model_path=Path(e("PG_VISION_MODEL", str(HERE / "models" / "yolo11n.onnx"))),
            conf=float(e("PG_VISION_CONF", "0.35")),
            interval_s=float(e("PG_VISION_INTERVAL_S", "3")),
            report_s=float(e("PG_VISION_REPORT_S", "30")),
            inactive_min=float(e("PG_INACTIVE_MIN", "10")),
            low_activity=float(e("PG_LOW_ACTIVITY", "0.15")),
            quiet_hours=q,
            bird_classes=_csv(e("PG_BIRD_CLASSES", "bird,chicken,hen,rooster,chick,broiler,layer,poultry")),
            pest_classes=_csv(e(
                "PG_PEST_CLASSES",
                "cat,dog,rat,mouse,snake,hawk,eagle,fox,mongoose,weasel,monitor_lizard,lizard,cockroach",
            )),
            worker=e("PG_VISION_WORKER", socket.gethostname())[:60],
            img_size=int(e("PG_VISION_IMGSZ", "640")),
        )

    def quiet_now(self) -> bool:
        """Birds roost at night: being still then is normal, so no inactivity events."""
        if not self.quiet_hours:
            return False
        a, b = self.quiet_hours
        h = dt.datetime.now().hour
        return (a <= h or h < b) if a > b else (a <= h < b)


# --------------------------------------------------------------------------- model


class Yolo:
    """YOLO11 (ultralytics ONNX export, 1x(4+C)xN output) with numpy pre/post-processing."""

    def __init__(self, path: Path, img_size: int = 640):
        import onnxruntime as ort

        if not path.exists():
            sys.exit(f"Model not found: {path}\nSee README.md, 'Camera vision', to get yolo11n.onnx.")
        opts = ort.SessionOptions()
        opts.intra_op_num_threads = max(1, (os.cpu_count() or 2) - 1)
        self.sess = ort.InferenceSession(str(path), opts, providers=ort.get_available_providers())
        inp = self.sess.get_inputs()[0]
        self.input_name = inp.name
        shape = inp.shape
        self.size = int(shape[2]) if isinstance(shape[2], int) else img_size
        meta = self.sess.get_modelmeta().custom_metadata_map
        try:
            names = ast.literal_eval(meta.get("names", "{}"))
            self.names = [str(names[i]) for i in sorted(names)]
        except (ValueError, SyntaxError):
            self.names = []
        # COCO's "mouse" is a computer mouse.
        self.coco = "keyboard" in self.names

    def __call__(self, img: Image.Image, conf: float, iou: float = 0.5):
        """-> list of (x1, y1, x2, y2, score, class_name) in image pixels."""
        w, h = img.size
        s = self.size
        r = min(s / w, s / h)
        nw, nh = int(round(w * r)), int(round(h * r))
        px, py = (s - nw) // 2, (s - nh) // 2
        canvas = np.full((s, s, 3), 114, np.float32)
        canvas[py:py + nh, px:px + nw] = _resize_linear(np.asarray(img.convert("RGB"), np.float32), nw, nh)
        x = canvas.transpose(2, 0, 1)[None] / 255.0
        out = self.sess.run(None, {self.input_name: x})[0][0]  # (4+C, N)
        out = out.T
        boxes, scores_all = out[:, :4], out[:, 4:]
        cls = scores_all.argmax(1)
        score = scores_all[np.arange(len(cls)), cls]
        keep = score >= conf
        boxes, score, cls = boxes[keep], score[keep], cls[keep]
        if not len(score):
            return []
        cx, cy, bw, bh = boxes.T
        xyxy = np.stack([cx - bw / 2, cy - bh / 2, cx + bw / 2, cy + bh / 2], 1)
        xyxy[:, [0, 2]] = (xyxy[:, [0, 2]] - px) / r
        xyxy[:, [1, 3]] = (xyxy[:, [1, 3]] - py) / r
        xyxy[:, [0, 2]] = xyxy[:, [0, 2]].clip(0, w)
        xyxy[:, [1, 3]] = xyxy[:, [1, 3]].clip(0, h)
        # Class-agnostic NMS: one label per object, so a chick that also scores a
        # little as "dog" is not reported as a pest.
        dets = []
        for j in _nms(xyxy, score, iou):
            c = int(cls[j])
            name = self.names[c] if c < len(self.names) else str(c)
            dets.append((*xyxy[j].tolist(), float(score[j]), name))
        return dets


def _resize_linear(a: np.ndarray, w: int, h: int) -> np.ndarray:
    """Bilinear resize like OpenCV's INTER_LINEAR (what YOLO is trained with). Pillow's
    BILINEAR blurs when shrinking, which costs the model a lot of confidence."""
    H, W = a.shape[:2]
    ys = ((np.arange(h) + 0.5) * (H / h) - 0.5).clip(0, H - 1)
    xs = ((np.arange(w) + 0.5) * (W / w) - 0.5).clip(0, W - 1)
    y0, x0 = np.floor(ys).astype(int), np.floor(xs).astype(int)
    y1, x1 = np.minimum(y0 + 1, H - 1), np.minimum(x0 + 1, W - 1)
    wy, wx = (ys - y0)[:, None, None], (xs - x0)[None, :, None]
    top = a[y0][:, x0] * (1 - wx) + a[y0][:, x1] * wx
    bot = a[y1][:, x0] * (1 - wx) + a[y1][:, x1] * wx
    return top * (1 - wy) + bot * wy


def _nms(b: np.ndarray, s: np.ndarray, thr: float) -> list[int]:
    order = s.argsort()[::-1]
    keep = []
    area = (b[:, 2] - b[:, 0]) * (b[:, 3] - b[:, 1])
    while len(order):
        i = order[0]
        keep.append(int(i))
        xx1 = np.maximum(b[i, 0], b[order[1:], 0])
        yy1 = np.maximum(b[i, 1], b[order[1:], 1])
        xx2 = np.minimum(b[i, 2], b[order[1:], 2])
        yy2 = np.minimum(b[i, 3], b[order[1:], 3])
        inter = (xx2 - xx1).clip(0) * (yy2 - yy1).clip(0)
        order = order[1:][inter / (area[i] + area[order[1:]] - inter + 1e-9) < thr]
    return keep


def _iou(a, b) -> float:
    xx1, yy1 = max(a[0], b[0]), max(a[1], b[1])
    xx2, yy2 = min(a[2], b[2]), min(a[3], b[3])
    inter = max(0.0, xx2 - xx1) * max(0.0, yy2 - yy1)
    u = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / u if u > 0 else 0.0


# --------------------------------------------------------------------------- tracking


@dataclass
class Track:
    id: int
    box: tuple[float, float, float, float]
    first_seen: float
    last_seen: float
    anchor: tuple[float, float]  # where it was when it last moved
    last_moved: float
    hits: int = 1


@dataclass
class BirdTracker:
    """Greedy IoU tracker. A bird 'moves' when its centre leaves a circle of
    MOVE_FRAC x its box size around where it last moved."""

    MOVE_FRAC = 0.25
    LOST_S = 20.0
    tracks: list[Track] = field(default_factory=list)
    next_id: int = 1

    def update(self, boxes: list[tuple[float, float, float, float]], now: float):
        unmatched = list(range(len(boxes)))
        pairs = sorted(
            ((_iou(t.box, boxes[i]), ti, i) for ti, t in enumerate(self.tracks) for i in unmatched),
            reverse=True,
        )
        used_t, used_b = set(), set()
        for iou, ti, i in pairs:
            if iou < 0.2 or ti in used_t or i in used_b:
                continue
            used_t.add(ti)
            used_b.add(i)
            t = self.tracks[ti]
            t.box, t.last_seen, t.hits = boxes[i], now, t.hits + 1
            c = _centre(t.box)
            size = max(t.box[2] - t.box[0], t.box[3] - t.box[1])
            if np.hypot(c[0] - t.anchor[0], c[1] - t.anchor[1]) > self.MOVE_FRAC * size:
                t.anchor, t.last_moved = c, now
        # A bird that walked further than its own size between frames doesn't overlap
        # its old box: match what's left by the nearest centre, within 2 box sizes.
        near = sorted(
            (np.hypot(*np.subtract(_centre(t.box), _centre(boxes[i]))), ti, i)
            for ti, t in enumerate(self.tracks) if ti not in used_t and t.last_seen < now
            for i in range(len(boxes)) if i not in used_b
        )
        for dist, ti, i in near:
            t = self.tracks[ti]
            size = max(t.box[2] - t.box[0], t.box[3] - t.box[1])
            if ti in used_t or i in used_b or dist > 2 * size:
                continue
            used_t.add(ti)
            used_b.add(i)
            t.box, t.last_seen, t.hits = boxes[i], now, t.hits + 1
            t.anchor, t.last_moved = _centre(t.box), now
        for i in range(len(boxes)):
            if i not in used_b:
                c = _centre(boxes[i])
                self.tracks.append(Track(self.next_id, boxes[i], now, now, c, now))
                self.next_id += 1
        self.tracks = [t for t in self.tracks if now - t.last_seen < self.LOST_S]


def _centre(b):
    return ((b[0] + b[2]) / 2, (b[1] + b[3]) / 2)


# --------------------------------------------------------------------------- cameras


def snapshot_url(stream_url: str) -> str | None:
    """ESP32-CAM CameraWebServer: stream on :81/stream, single JPEG on :80/capture."""
    u = urllib.parse.urlparse(stream_url)
    if u.port == 81 and u.path.rstrip("/") == "/stream":
        return f"{u.scheme}://{u.hostname}/capture"
    return None


def grab_frame(url: str, timeout: float = 8.0) -> Image.Image:
    """One frame: a JPEG URL, or the first frame of an MJPEG stream."""
    snap = snapshot_url(url)
    if snap:
        try:
            with urllib.request.urlopen(snap, timeout=timeout) as r:
                return Image.open(io.BytesIO(r.read())).convert("RGB")
        except (urllib.error.URLError, OSError) as e:
            log.debug("capture failed (%s), reading the stream instead", e)
    with urllib.request.urlopen(url, timeout=timeout) as r:
        ctype = r.headers.get("content-type", "")
        if "multipart" not in ctype:
            return Image.open(io.BytesIO(r.read())).convert("RGB")
        buf = b""
        deadline = time.time() + timeout
        while time.time() < deadline:
            chunk = r.read(4096)
            if not chunk:
                break
            buf += chunk
            a = buf.find(b"\xff\xd8")
            b = buf.find(b"\xff\xd9", a + 2) if a >= 0 else -1
            if a >= 0 and b > a:
                return Image.open(io.BytesIO(buf[a:b + 2])).convert("RGB")
            if len(buf) > 2_000_000:
                buf = buf[-500_000:]
    raise TimeoutError("no frame from the stream")


@dataclass
class CameraState:
    id: str
    name: str
    url: str
    tracker: BirdTracker = field(default_factory=BirdTracker)
    last_report: float = 0.0
    last_event: dict = field(default_factory=dict)  # (kind,label) -> time
    low_since: float | None = None
    failures: int = 0


# --------------------------------------------------------------------------- analysis


def analyse(cfg: Config, model: Yolo, cam: CameraState, img: Image.Image, now: float):
    dets = model(img, cfg.conf)
    pest_classes = set(cfg.pest_classes)
    if model.coco:
        pest_classes.discard("mouse")  # computer mouse in COCO
    birds = [d for d in dets if d[5].lower() in cfg.bird_classes]
    pests = [d for d in dets if d[5].lower() in pest_classes]
    cam.tracker.update([tuple(d[:4]) for d in birds], now)

    tracks = [t for t in cam.tracker.tracks if t.last_seen == now]
    inactive_s = cfg.inactive_min * 60
    quiet = cfg.quiet_now()
    inactive = [t for t in tracks if now - t.first_seen >= inactive_s and now - t.last_moved >= inactive_s]
    warm = [t for t in tracks if now - t.first_seen >= 60]
    activity = (sum(1 for t in warm if now - t.last_moved < 60) / len(warm)) if len(warm) >= 2 else None

    events = []
    for p in pests:
        events.append(("pest", p[5].lower(), f"{p[5]} detected ({p[4]:.0%} sure)."))
    if inactive and not quiet:
        n = len(inactive)
        events.append((
            "inactive", "inactive",
            f"{n} bird{'s' if n > 1 else ''} hasn't moved for {cfg.inactive_min:.0f}+ minutes. "
            "Check for sick, injured or dead birds.",
        ))
    if activity is not None and len(warm) >= 3 and activity < cfg.low_activity and not quiet:
        cam.low_since = cam.low_since or now
        if now - cam.low_since >= inactive_s:
            events.append((
                "low_activity", "low_activity",
                f"Only {activity:.0%} of the flock moved in the last minute for {cfg.inactive_min:.0f}+ minutes. "
                "Check heat, water and feed.",
            ))
    else:
        cam.low_since = None

    # The same event at most every 10 minutes per camera.
    fresh = []
    for kind, label, detail in events:
        k = (kind, label)
        if now - cam.last_event.get(k, 0) >= 600:
            cam.last_event[k] = now
            fresh.append({"kind": kind, "label": label, "detail": detail})

    inactive_ids = {t.id for t in inactive}
    frame = annotate(img, birds, pests, tracks, inactive_ids)
    return {
        "birds": len(birds),
        "inactive": len(inactive),
        "activity": None if activity is None else round(activity, 3),
        "pests": [{"label": p[5].lower(), "confidence": round(p[4], 3)} for p in pests],
        "events": fresh,
    }, frame


def annotate(img: Image.Image, birds, pests, tracks, inactive_ids) -> Image.Image:
    im = img.copy()
    d = ImageDraw.Draw(im)
    lw = max(2, im.width // 320)
    try:
        font = ImageFont.load_default(size=max(12, im.width // 50))
    except TypeError:  # Pillow < 10.1
        font = ImageFont.load_default()
    by_box = {t.box: t for t in tracks}
    for b in birds:
        t = by_box.get(tuple(b[:4]))
        bad = t is not None and t.id in inactive_ids
        col = (230, 57, 70) if bad else (46, 204, 113)
        d.rectangle(b[:4], outline=col, width=lw)
        label = f"#{t.id} still" if bad else f"bird {b[4]:.0%}"
        d.text((b[0] + 3, b[1] + 2), label, fill=col, font=font)
    for p in pests:
        d.rectangle(p[:4], outline=(255, 140, 0), width=lw + 1)
        d.text((p[0] + 3, p[1] + 2), f"{p[5]} {p[4]:.0%}", fill=(255, 140, 0), font=font)
    return im


def jpeg_b64(img: Image.Image, max_w: int = 640, quality: int = 70) -> str:
    if img.width > max_w:
        img = img.resize((max_w, round(img.height * max_w / img.width)), Image.BILINEAR)
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=quality, optimize=True)
    return base64.b64encode(buf.getvalue()).decode()


# --------------------------------------------------------------------------- app


class App:
    def __init__(self, cfg: Config, dry_run: bool):
        self.cfg, self.dry = cfg, dry_run

    def _req(self, method: str, body: dict | None = None):
        req = urllib.request.Request(
            f"{self.cfg.api_url}/api/public/devices/vision",
            data=None if body is None else json.dumps(body).encode(),
            method=method,
            headers={"content-type": "application/json", "x-device-id": self.cfg.device_id,
                     "x-api-key": self.cfg.api_key, "user-agent": f"poultrygrid-{VERSION}"},
        )
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.loads(r.read() or b"{}")

    def cameras(self) -> list[dict]:
        return self._req("GET").get("cameras", [])

    def report(self, cam: CameraState, result: dict, frame: Image.Image):
        body = {"camera_id": cam.id, **result, "frame_jpeg_b64": jpeg_b64(frame), "worker": self.cfg.worker}
        if self.dry:
            log.info("[dry run] %s: %s", cam.name, {k: v for k, v in body.items() if k != "frame_jpeg_b64"})
            return
        self._req("POST", body)


def run(cfg: Config, args):
    model = Yolo(cfg.model_path, cfg.img_size)
    log.info("YOLO model %s (%d classes) on %s, worker %s", cfg.model_path.name, len(model.names),
             ",".join(model.sess.get_providers()), cfg.worker)

    if args.image:
        img = Image.open(args.image).convert("RGB")
        dets = model(img, cfg.conf)
        for d in dets:
            print(f"{d[5]:>12} {d[4]:.2f}  box {[round(v) for v in d[:4]]}")
        birds = [d for d in dets if d[5].lower() in cfg.bird_classes]
        pests = [d for d in dets if d[5].lower() in cfg.pest_classes and not (model.coco and d[5] == "mouse")]
        out = Path(args.image).with_suffix(".annotated.jpg")
        annotate(img, birds, pests, [], set()).save(out, quality=85)
        print(f"{len(birds)} birds, {len(pests)} pests -> {out}")
        return

    app = App(cfg, args.dry_run)
    cams: dict[str, CameraState] = {}
    next_list = 0.0
    while True:
        now = time.time()
        if args.camera:
            if not cams:
                cams["local"] = CameraState("00000000-0000-0000-0000-000000000000", "camera", args.camera)
        elif now >= next_list:
            try:
                listed = [c for c in app.cameras() if c.get("stream_url")]
                cams = {c["id"]: cams.get(c["id"]) or CameraState(c["id"], c["name"], c["stream_url"])
                        for c in listed}
                for c in listed:
                    cams[c["id"]].url = c["stream_url"]
                log.info("%d camera(s): %s", len(cams), ", ".join(c.name for c in cams.values()) or "none")
            except (urllib.error.URLError, OSError, ValueError) as e:
                log.warning("Couldn't get the camera list: %s", e)
            # Cameras on firmware/esp32cam update their own address on the site, so
            # re-read the list every few minutes, and soon after a camera stops answering.
            next_list = now + 180

        for cam in list(cams.values()):
            t = time.time()
            try:
                img = grab_frame(cam.url)
                cam.failures = 0
            except (urllib.error.URLError, OSError, TimeoutError, ValueError) as e:
                cam.failures += 1
                if cam.failures in (1, 10) or cam.failures % 100 == 0:
                    log.warning("%s: no picture (%s)", cam.name, e)
                if cam.failures == 3 and not args.camera:
                    next_list = min(next_list, time.time() + 20)  # its IP may have changed
                continue
            result, frame = analyse(cfg, model, cam, img, t)
            if result["events"] or t - cam.last_report >= cfg.report_s or args.once:
                try:
                    app.report(cam, result, frame)
                    cam.last_report = t
                    for e in result["events"]:
                        log.warning("%s: %s", cam.name, e["detail"])
                except (urllib.error.URLError, OSError) as e:
                    log.warning("Couldn't report %s: %s", cam.name, e)
            if args.save_frames:
                frame.save(Path(args.save_frames) / f"{cam.name}.jpg", quality=80)
        if args.once:
            return
        time.sleep(max(0.2, cfg.interval_s - (time.time() - now)))


def main():
    for f in ("vision.env", "agent.env"):
        _load_env_file(HERE / f)
    _load_env_file(Path("/etc/poultrygrid/agent.env"))
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    p.add_argument("--dry-run", action="store_true", help="print results instead of sending them")
    p.add_argument("--once", action="store_true", help="one pass over the cameras, then exit")
    p.add_argument("--camera", help="analyse this stream URL only (no camera list from the app)")
    p.add_argument("--image", help="run the model on one photo and save an annotated copy")
    p.add_argument("--save-frames", metavar="DIR", help="also save each annotated frame here")
    p.add_argument("-v", "--verbose", action="store_true")
    args = p.parse_args()
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO,
                        format="%(asctime)s %(levelname)s %(message)s")
    cfg = Config.from_env()
    if not args.image and not args.dry_run and not (cfg.device_id and cfg.api_key):
        sys.exit("Set PG_DEVICE_ID and PG_DEVICE_API_KEY (a device registered under Devices in the app).")
    if args.camera and not args.dry_run:
        sys.exit("--camera has no camera in the app to report to: add --dry-run.")
    try:
        run(cfg, args)
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
