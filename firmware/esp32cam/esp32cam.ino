// =====================================================
// POULTRY GRID - ESP32-CAM WITH AUTO ADDRESS
// =====================================================
// A drop-in for the stock CameraWebServer sketch, with the same addresses:
//   http://<cam-ip>:81/stream   MJPEG live view (Cameras page)
//   http://<cam-ip>/capture     one JPEG (the vision worker, Snapshot button)
//   http://<cam-ip>/            a small page with both
// plus:
//  - Auto address: every 60 s, and right after it joins the Wi-Fi, it tells the
//    PoultryGrid site its current IP. The site updates the camera's stream URL, so
//    the camera keeps working when the router hands it a new address.
//  - Low latency, PG-CAM push: it finds the PC relay (edge/cam_relay.py, started by
//    `npm start`) with a UDP broadcast and pushes every frame the moment it's
//    captured over one TCP connection with Nagle off. The relay serves all viewers
//    and the vision worker, so the camera never splits itself between them. With no
//    relay (PC off) it serves its own /stream as before, and switches back by itself.
//  - Mounting: the site's "Mounted: upside down" setting flips the picture in the
//    sensor (saved in flash), so every viewer gets it upright at no cost.
//
// Board: "AI Thinker ESP32-CAM" (arduino-esp32 core 2.x or 3.x), PSRAM enabled.
// Library (Arduino Library Manager): ArduinoJson (v7)
//
// Setup: on the site, Cameras -> Add camera -> Address "Updates itself" (or the
// camera's "Auto address" button). Copy secrets.example.h to secrets.h here and
// paste in the three lines it shows, plus your Wi-Fi. secrets.h is not committed.
// =====================================================

#include "esp_camera.h"
#include "esp_http_server.h"
#include "esp_timer.h"
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <WiFiUdp.h>
#include <Preferences.h>

// Your Wi-Fi and the site's key: secrets.h (ignored by git). Without one, the values in
// secrets.example.h are used, so never commit real ones there.
#if __has_include("secrets.h")
#include "secrets.h"
#else
#include "secrets.example.h"
#endif
#include "root_ca.h"

#define FIRMWARE_VERSION "pg-cam 1.1"

// Only for testing against a server with no valid HTTPS certificate.
#ifndef PG_INSECURE_TLS
#define PG_INSECURE_TLS 0
#endif

#define CHECKIN_MS      60000
#define WIFI_RETRY_MS   15000
#define HTTP_TIMEOUT_MS 8000

// ---- PG-CAM push (to the PC relay) ----
#define RELAY_DISCOVER_PORT 5006
#define RELAY_RETRY_MS      10000   // look for the relay again this often while it's away

// ---- AI Thinker ESP32-CAM pins ----
#define PWDN_GPIO_NUM  32
#define RESET_GPIO_NUM -1
#define XCLK_GPIO_NUM   0
#define SIOD_GPIO_NUM  26
#define SIOC_GPIO_NUM  27
#define Y9_GPIO_NUM    35
#define Y8_GPIO_NUM    34
#define Y7_GPIO_NUM    39
#define Y6_GPIO_NUM    36
#define Y5_GPIO_NUM    21
#define Y4_GPIO_NUM    19
#define Y3_GPIO_NUM    18
#define Y2_GPIO_NUM     5
#define VSYNC_GPIO_NUM 25
#define HREF_GPIO_NUM  23
#define PCLK_GPIO_NUM  22

httpd_handle_t webHttpd = NULL;     // port 80: /, /capture, /status
httpd_handle_t streamHttpd = NULL;  // port 81: /stream

unsigned long nextCheckin = 0;
unsigned long lastWifiAttempt = 0;
bool siteOnline = false;
String lastIp;

Preferences prefs;
bool flipped = false;                 // mounted upside down: flip in the sensor

// The push task (core 0) owns the relay connection; loop() (core 1) only reads these.
SemaphoreHandle_t relayLock;
volatile bool relayUp = false;
String relayUrl;                      // http://<pc>:5007/cam/<id>.mjpg while pushing
volatile uint32_t pushedFrames = 0;

// ---- Camera ----

bool startCamera() {
  camera_config_t c = {};
  c.ledc_channel = LEDC_CHANNEL_0;
  c.ledc_timer = LEDC_TIMER_0;
  c.pin_d0 = Y2_GPIO_NUM;
  c.pin_d1 = Y3_GPIO_NUM;
  c.pin_d2 = Y4_GPIO_NUM;
  c.pin_d3 = Y5_GPIO_NUM;
  c.pin_d4 = Y6_GPIO_NUM;
  c.pin_d5 = Y7_GPIO_NUM;
  c.pin_d6 = Y8_GPIO_NUM;
  c.pin_d7 = Y9_GPIO_NUM;
  c.pin_xclk = XCLK_GPIO_NUM;
  c.pin_pclk = PCLK_GPIO_NUM;
  c.pin_vsync = VSYNC_GPIO_NUM;
  c.pin_href = HREF_GPIO_NUM;
  c.pin_sccb_sda = SIOD_GPIO_NUM;
  c.pin_sccb_scl = SIOC_GPIO_NUM;
  c.pin_pwdn = PWDN_GPIO_NUM;
  c.pin_reset = RESET_GPIO_NUM;
  c.xclk_freq_hz = 20000000;
  c.pixel_format = PIXFORMAT_JPEG;
  c.grab_mode = CAMERA_GRAB_LATEST;  // always the newest frame, never a stale one
  if (psramFound()) {
    c.frame_size = FRAMESIZE_VGA;    // 640x480: what YOLO11n works at
    c.jpeg_quality = 12;
    c.fb_count = 2;
    c.fb_location = CAMERA_FB_IN_PSRAM;
  } else {
    c.frame_size = FRAMESIZE_QVGA;
    c.jpeg_quality = 14;
    c.fb_count = 1;
    c.fb_location = CAMERA_FB_IN_DRAM;
  }
  esp_err_t err = esp_camera_init(&c);
  if (err != ESP_OK) {
    Serial.printf("Camera init failed: 0x%x\n", err);
    return false;
  }
  applyFlip(flipped);
  return true;
}

// Upside down = flip both ways (a 180 degree turn), done by the sensor itself.
void applyFlip(bool on) {
  sensor_t* s = esp_camera_sensor_get();
  if (!s) return;
  s->set_vflip(s, on ? 1 : 0);
  s->set_hmirror(s, on ? 1 : 0);
}

// ---- Web servers ----

static esp_err_t captureHandler(httpd_req_t* req) {
  camera_fb_t* fb = esp_camera_fb_get();
  if (!fb) {
    httpd_resp_send_500(req);
    return ESP_FAIL;
  }
  httpd_resp_set_type(req, "image/jpeg");
  httpd_resp_set_hdr(req, "Content-Disposition", "inline; filename=capture.jpg");
  httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
  esp_err_t res = httpd_resp_send(req, (const char*)fb->buf, fb->len);
  esp_camera_fb_return(fb);
  return res;
}

#define PART_BOUNDARY "123456789000000000000987654321"
static const char* STREAM_CONTENT_TYPE = "multipart/x-mixed-replace;boundary=" PART_BOUNDARY;
static const char* STREAM_BOUNDARY = "\r\n--" PART_BOUNDARY "\r\n";
static const char* STREAM_PART = "Content-Type: image/jpeg\r\nContent-Length: %u\r\n\r\n";

static esp_err_t streamHandler(httpd_req_t* req) {
  char part[64];
  esp_err_t res = httpd_resp_set_type(req, STREAM_CONTENT_TYPE);
  if (res != ESP_OK) return res;
  httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
  while (true) {
    camera_fb_t* fb = esp_camera_fb_get();
    if (!fb) {
      res = ESP_FAIL;
      break;
    }
    size_t hlen = snprintf(part, sizeof(part), STREAM_PART, fb->len);
    res = httpd_resp_send_chunk(req, STREAM_BOUNDARY, strlen(STREAM_BOUNDARY));
    if (res == ESP_OK) res = httpd_resp_send_chunk(req, part, hlen);
    if (res == ESP_OK) res = httpd_resp_send_chunk(req, (const char*)fb->buf, fb->len);
    esp_camera_fb_return(fb);
    if (res != ESP_OK) break;  // the viewer closed the page
  }
  return res;
}

static esp_err_t statusHandler(httpd_req_t* req) {
  JsonDocument doc;
  doc["firmware"] = FIRMWARE_VERSION;
  doc["ip"] = WiFi.localIP().toString();
  doc["rssi"] = WiFi.RSSI();
  doc["site"] = siteOnline;
  doc["uptime_s"] = millis() / 1000;
  doc["flipped"] = flipped;
  doc["relay"] = relayUp ? relayUrl : String("");
  doc["pushed_frames"] = pushedFrames;
  String out;
  serializeJson(doc, out);
  httpd_resp_set_type(req, "application/json");
  return httpd_resp_send(req, out.c_str(), out.length());
}

static esp_err_t indexHandler(httpd_req_t* req) {
  String ip = WiFi.localIP().toString();
  String html =
      "<!DOCTYPE html><html><head><meta name='viewport' content='width=device-width,initial-scale=1'>"
      "<title>PoultryGrid camera</title><style>body{font-family:sans-serif;background:#111;color:#eee;"
      "text-align:center;margin:0;padding:16px}img{max-width:100%;border-radius:8px}a{color:#9fe0b8}"
      "</style></head><body><h2>PoultryGrid camera</h2><img src='http://" + ip + ":81/stream'>"
      "<p><a href='/capture'>Snapshot</a> &middot; <a href='/status'>Status</a> &middot; "
      FIRMWARE_VERSION "</p></body></html>";
  httpd_resp_set_type(req, "text/html");
  return httpd_resp_send(req, html.c_str(), html.length());
}

void startServers() {
  httpd_config_t config = HTTPD_DEFAULT_CONFIG();
  config.server_port = 80;
  config.ctrl_port = 32768;
  httpd_uri_t index = {"/", HTTP_GET, indexHandler, NULL};
  httpd_uri_t capture = {"/capture", HTTP_GET, captureHandler, NULL};
  httpd_uri_t status = {"/status", HTTP_GET, statusHandler, NULL};
  if (httpd_start(&webHttpd, &config) == ESP_OK) {
    httpd_register_uri_handler(webHttpd, &index);
    httpd_register_uri_handler(webHttpd, &capture);
    httpd_register_uri_handler(webHttpd, &status);
  }
  // The stream gets its own server so /capture still answers while someone watches.
  config.server_port = 81;
  config.ctrl_port = 32769;
  httpd_uri_t stream = {"/stream", HTTP_GET, streamHandler, NULL};
  if (httpd_start(&streamHttpd, &config) == ESP_OK) {
    httpd_register_uri_handler(streamHttpd, &stream);
  }
}

// ---- PoultryGrid site ----

void checkinWithSite() {
  String url = String(PG_API_URL) + "/api/public/devices/camera";
  bool https = url.startsWith("https://");
  WiFiClientSecure secureClient;
  WiFiClient plainClient;
  HTTPClient http;
  http.setTimeout(HTTP_TIMEOUT_MS);

  bool ok;
  if (https) {
#if PG_INSECURE_TLS
    secureClient.setInsecure();
#else
    secureClient.setCACert(ROOT_CA_BUNDLE);
#endif
    ok = http.begin(secureClient, url);
  } else {
    ok = http.begin(plainClient, url);
  }
  if (!ok) {
    siteOnline = false;
    return;
  }
  http.addHeader("content-type", "application/json");
  http.addHeader("x-device-id", PG_DEVICE_ID);
  http.addHeader("x-api-key", PG_DEVICE_API_KEY);

  JsonDocument doc;
  doc["ip"] = WiFi.localIP().toString();
  doc["stream_port"] = 81;
  doc["firmware"] = FIRMWARE_VERSION;
  doc["rssi"] = WiFi.RSSI();
  if (relayUp && xSemaphoreTake(relayLock, pdMS_TO_TICKS(100))) {
    if (relayUp) doc["relay_url"] = relayUrl;
    xSemaphoreGive(relayLock);
  }
  String body;
  serializeJson(doc, body);

  int code = http.POST(body);
  if (code == 200) {
    if (!siteOnline) Serial.println("Site: online, address sent");
    siteOnline = true;
    JsonDocument res;
    if (!deserializeJson(res, http.getString()) && res["flip"].is<bool>()) {
      bool want = res["flip"].as<bool>();
      if (want != flipped) {
        flipped = want;
        prefs.putBool("flip", flipped);
        applyFlip(flipped);
        Serial.printf("Picture %s (set on the site)\n", flipped ? "flipped: mounted upside down" : "upright");
      }
    }
  } else {
    siteOnline = false;
    Serial.printf("Site check-in failed: HTTP %d %s\n", code,
                  code < 0 ? http.errorToString(code).c_str() : http.getString().c_str());
  }
  http.end();
}

// ---- PG-CAM push ----

// Ask the network for the PC relay: "PG-CAM?" -> "PG-CAM <push-port> <http-port>".
bool discoverRelay(IPAddress& ip, uint16_t& port) {
  WiFiUDP udp;
  if (!udp.begin(RELAY_DISCOVER_PORT + 10)) return false;
  IPAddress bcast = WiFi.localIP();
  IPAddress mask = WiFi.subnetMask();
  for (int i = 0; i < 4; i++) bcast[i] = (bcast[i] & mask[i]) | (~mask[i] & 0xFF);
  bool found = false;
  for (int attempt = 0; attempt < 2 && !found; attempt++) {
    udp.beginPacket(bcast, RELAY_DISCOVER_PORT);
    udp.print("PG-CAM?");
    udp.endPacket();
    unsigned long until = millis() + 800;
    while (millis() < until) {
      if (udp.parsePacket() > 0) {
        char buf[48] = {0};
        udp.read(buf, sizeof(buf) - 1);
        int p = 0, h = 0;
        if (sscanf(buf, "PG-CAM %d %d", &p, &h) == 2 && p > 0) {
          ip = udp.remoteIP();
          port = p;
          found = true;
          break;
        }
      }
      vTaskDelay(pdMS_TO_TICKS(10));
    }
  }
  udp.stop();
  return found;
}

void setRelay(bool up, const String& url) {
  xSemaphoreTake(relayLock, portMAX_DELAY);
  relayUp = up;
  relayUrl = url;
  xSemaphoreGive(relayLock);
  nextCheckin = 0;  // tell the site which URL to use, now
}

void pushTask(void*) {
  WiFiClient relay;
  unsigned long nextTry = 0;
  for (;;) {
    if (WiFi.status() != WL_CONNECTED || (long)(millis() - nextTry) < 0) {
      vTaskDelay(pdMS_TO_TICKS(200));
      continue;
    }
    IPAddress ip;
    uint16_t port = 0;
    nextTry = millis() + RELAY_RETRY_MS;
    if (!discoverRelay(ip, port) || !relay.connect(ip, port, 3000)) continue;
    relay.setNoDelay(true);  // send each frame at once, never wait to fill a packet
    relay.printf("PGCAM/1 %s %s\n", PG_DEVICE_ID, PG_DEVICE_API_KEY);
    String reply = relay.readStringUntil('\n');  // "OK <camera-id> <url>" or "ERR ..."
    if (!reply.startsWith("OK ")) {
      Serial.printf("Relay refused the camera: %s\n", reply.c_str());
      relay.stop();
      nextTry = millis() + 60000;
      continue;
    }
    String url = reply.substring(reply.lastIndexOf(' ') + 1);
    url.trim();
    Serial.printf("PG-CAM push to %s:%u, viewers on %s\n", ip.toString().c_str(), port, url.c_str());
    setRelay(true, url);

    while (relay.connected() && WiFi.status() == WL_CONNECTED) {
      camera_fb_t* fb = esp_camera_fb_get();  // the newest frame (CAMERA_GRAB_LATEST)
      if (!fb) {
        vTaskDelay(pdMS_TO_TICKS(5));
        continue;
      }
      uint8_t hdr[4] = {(uint8_t)(fb->len >> 24), (uint8_t)(fb->len >> 16), (uint8_t)(fb->len >> 8),
                        (uint8_t)fb->len};
      size_t sent = relay.write(hdr, 4);
      if (sent == 4) sent += relay.write(fb->buf, fb->len);
      bool ok = sent == 4 + fb->len;
      esp_camera_fb_return(fb);
      if (!ok) break;
      pushedFrames++;
    }
    relay.stop();
    Serial.println("Relay gone: serving /stream directly");
    setRelay(false, "");
    nextTry = millis() + 2000;
  }
}

void maintainWifi() {
  if (WiFi.status() == WL_CONNECTED) return;
  siteOnline = false;
  if (lastWifiAttempt != 0 && millis() - lastWifiAttempt < WIFI_RETRY_MS) return;
  lastWifiAttempt = millis();
  Serial.printf("Connecting to WiFi... (last status %d)\n", WiFi.status());
  WiFi.disconnect();
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
}

void setup() {
  Serial.begin(115200);
  Serial.println();
  relayLock = xSemaphoreCreateMutex();
  prefs.begin("pgcam", false);
  flipped = prefs.getBool("flip", false);
  if (!startCamera()) {
    delay(3000);
    ESP.restart();  // a loose ribbon cable or brown-out: try again from scratch
  }

  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);  // no power-save naps between frames: lower, steadier latency
  WiFi.setTxPower(WIFI_POWER_19_5dBm);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  lastWifiAttempt = millis();
  Serial.print("Connecting to WiFi");
  for (int i = 0; i < 30 && WiFi.status() != WL_CONNECTED; i++) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();

  startServers();
  // Frames go out from core 0; Wi-Fi, check-ins and the local servers keep core 1.
  xTaskCreatePinnedToCore(pushTask, "pgcam-push", 8192, NULL, 2, NULL, 0);
}

void loop() {
  maintainWifi();
  bool connected = WiFi.status() == WL_CONNECTED;
  if (connected) {
    String ip = WiFi.localIP().toString();
    // New address (first connect, reconnect, or the router gave a new one): tell the site now.
    if (ip != lastIp) {
      lastIp = ip;
      Serial.printf("Camera ready: http://%s:81/stream  (snapshot http://%s/capture)\n",
                    ip.c_str(), ip.c_str());
      nextCheckin = 0;
    }
    if ((long)(millis() - nextCheckin) >= 0) {
      checkinWithSite();
      nextCheckin = millis() + (siteOnline ? CHECKIN_MS : 15000);
    }
  }
  delay(50);
}
