# ESP32-CAM with auto address

The camera for the Cameras page, with one addition over the stock **CameraWebServer**
sketch: it tells the site its IP address every minute, and right after it joins the Wi-Fi.
The site updates the camera's stream URL to match. When the router gives the camera a
new address, after a power cut, a router restart or a new router, the live view and the
YOLO vision worker (`edge/vision.py`) follow it by themselves, with nobody editing anything.

| Address | What |
|---|---|
| `http://<ip>:81/stream` | MJPEG live view, same as the stock sketch |
| `http://<ip>/capture` | one JPEG (the vision worker reads this, so it never takes the one live stream) |
| `http://<ip>/status` | firmware, IP, Wi-Fi signal, whether the site answered |
| `http://<ip>/` | a small page with the stream |

## Set up

1. On the site: **Cameras → Add camera**, Address **Updates itself** (or the **Auto address**
   button on a camera you already added). It shows three lines, once.
2. Copy `secrets.example.h` to `secrets.h` here, put in your Wi-Fi name and password and those
   three lines. `PG_API_URL` must be the address the camera can reach, i.e. the live site
   (not `localhost`). `secrets.h` is ignored by git.
3. Arduino IDE: install **ArduinoJson** (v7). Board **AI Thinker ESP32-CAM**, PSRAM enabled.
   Upload (hold IO0 to GND while it resets if your board has no auto-reset), open the serial
   monitor at 115200 baud. It prints `Camera ready: http://<ip>:81/stream`, then
   `Site: online, address sent`.

Within a minute the camera's tile on the Cameras page shows the stream and "Auto address".
If it stops checking in for 3 minutes, the tile says it's offline and since when.

Another camera board: change the pin block at the top of `esp32cam.ino` (the pins for
each board are in the stock `CameraWebServer` example's `camera_pins.h`).

## How it talks to the site

`POST /api/public/devices/camera` with headers `x-device-id` and `x-api-key`:

```json
{ "ip": "192.168.1.57", "stream_port": 81, "firmware": "pg-cam 1.0", "rssi": -63 }
```

Reply: `{ "ok": true, "stream_url": "http://192.168.1.57:81/stream", "next_ms": 60000 }`.

## Still on the stock CameraWebServer?

It works as before, with a fixed stream URL typed in on the Cameras page. To keep its address
from changing, reserve its IP in the router's DHCP settings (by the camera's MAC address).
