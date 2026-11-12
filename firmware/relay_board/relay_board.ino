// =====================================================
// POULTRY GRID - INCUBATOR RELAY BOARD
// =====================================================
// ESP32 with four relays: incubator controller, fan, light and strip light.
//
// Two ways to switch them:
//   - From the PoultryGrid site: Automation -> tap a part of the incubator.
//     The board checks in with the site (every 15 s, or every 1.5 s while
//     someone has Automation open) and switches to what the site wants.
//   - From its own page on the farm Wi-Fi: http://<board-ip>/ (printed on the
//     serial monitor). Changes made there are sent to the site straight away,
//     so the site always shows the real state.
// With no Wi-Fi or no site, the relays keep their last state.
//
// Library (Arduino Library Manager): ArduinoJson (v7)
// Board: ESP32 Dev Module (arduino-esp32 core 2.x or 3.x)
//
// Setup: copy secrets.example.h to secrets.h (same folder) and fill it in with
// your Wi-Fi and the three lines the site shows when you add the board
// (Devices -> Add device -> Incubator relay board). secrets.h is not committed.
// =====================================================

#include <WiFi.h>
#include <WebServer.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

#include "secrets.h"
#include "root_ca.h"

#define FIRMWARE_VERSION "relay-board 1.0"

// ---- Relay pins ----
#define INCUBATOR_PIN 22
#define FAN_PIN       23
#define LIGHT_PIN     21
#define STRIP_PIN     19

// Relay modules differ: most switch ON with HIGH, some ("active low") with LOW.
#define RELAY_ON  HIGH
#define RELAY_OFF LOW

// Only for testing against a server with no valid HTTPS certificate.
// Leave at 0 for a real site: 1 lets anyone on the network impersonate it.
#ifndef PG_INSECURE_TLS
#define PG_INSECURE_TLS 0
#endif

#define HTTP_TIMEOUT_MS   6000
#define WIFI_RETRY_MS     15000
#define MIN_CHECKIN_MS    1000
#define MAX_CHECKIN_MS    30000

WebServer server(80);

struct Relay {
  const char* name;   // the site's name for it
  const char* label;  // shown on the serial monitor
  int pin;
  bool on;
};

// All default ON at power-up, as before; the site's last setting follows on the first check-in.
Relay relays[] = {
  {"incubator", "incubator",   INCUBATOR_PIN, true},
  {"fan",       "fan",         FAN_PIN,       true},
  {"light",     "light",       LIGHT_PIN,     true},
  {"strip",     "strip light", STRIP_PIN,     true},
};
const int RELAY_COUNT = sizeof(relays) / sizeof(relays[0]);

long appliedVersion = 0;          // the site's settings version these relays follow
bool changedLocally = false;      // switched on this board's page since the last check-in
unsigned long nextCheckin = 0;
unsigned long checkinEvery = 15000;
unsigned long lastWifiAttempt = 0;
bool siteOnline = false;

const char htmlPage[] PROGMEM = R"rawliteral(
<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Poultry Control</title>
  <style>
    body { font-family: sans-serif; text-align: center; background:#111; color:#eee; padding: 30px 10px; }
    h1 { font-size: 1.6em; margin-bottom: 30px; }
    .card {
      background:#1b1b1b; border-radius: 14px; padding: 18px;
      margin: 0 auto 20px auto; max-width: 360px;
      box-shadow: 0 2px 6px rgba(0,0,0,0.4);
    }
    .card h2 { margin: 0 0 10px 0; font-size: 1.2em; }
    .status { font-size: 1.1em; margin: 10px 0; }
    .on  { color: #4caf50; }
    .off { color: #f44336; }
    button {
      font-size: 1.1em; padding: 12px 28px; margin: 6px; border: none;
      border-radius: 10px; cursor: pointer; color: white;
    }
    .btn-on  { background: #4caf50; }
    .btn-off { background: #f44336; }
    .site { color: #999; font-size: 0.9em; }
  </style>
</head>
<body>
  <h1>Poultry Relay Control</h1>

  <div class="card">
    <h2>Incubator Controller</h2>
    <div class="status">Status: <span id="state-incubator" class="on">...</span></div>
    <button class="btn-on" onclick="setRelay('incubator',1)">Turn ON</button>
    <button class="btn-off" onclick="setRelay('incubator',0)">Turn OFF</button>
  </div>

  <div class="card">
    <h2>Fan</h2>
    <div class="status">Status: <span id="state-fan" class="on">...</span></div>
    <button class="btn-on" onclick="setRelay('fan',1)">Turn ON</button>
    <button class="btn-off" onclick="setRelay('fan',0)">Turn OFF</button>
  </div>

  <div class="card">
    <h2>Light</h2>
    <div class="status">Status: <span id="state-light" class="on">...</span></div>
    <button class="btn-on" onclick="setRelay('light',1)">Turn ON</button>
    <button class="btn-off" onclick="setRelay('light',0)">Turn OFF</button>
  </div>

  <div class="card">
    <h2>Strip Light</h2>
    <div class="status">Status: <span id="state-strip" class="on">...</span></div>
    <button class="btn-on" onclick="setRelay('strip',1)">Turn ON</button>
    <button class="btn-off" onclick="setRelay('strip',0)">Turn OFF</button>
  </div>

  <p class="site">PoultryGrid site: <span id="site">...</span></p>

  <script>
    const relays = ['incubator', 'fan', 'light', 'strip'];

    function refresh() {
      fetch('/status').then(r => r.json()).then(d => {
        relays.forEach(name => {
          const el = document.getElementById('state-' + name);
          const isOn = d[name];
          el.textContent = isOn ? 'ON' : 'OFF';
          el.className = isOn ? 'on' : 'off';
        });
        document.getElementById('site').textContent = d.site ? 'connected' : 'not connected';
      });
    }

    function setRelay(name, v) {
      fetch('/' + name + '/' + (v ? 'on' : 'off')).then(refresh);
    }

    refresh();
    setInterval(refresh, 3000);
  </script>
</body>
</html>
)rawliteral";

// ---- Relays ----

void setRelay(Relay& r, bool on) {
  if (r.on == on) return;
  r.on = on;
  digitalWrite(r.pin, on ? RELAY_ON : RELAY_OFF);
  Serial.print(r.label);
  Serial.println(on ? " on" : " off");
}

Relay* findRelay(const String& name) {
  for (int i = 0; i < RELAY_COUNT; i++)
    if (name == relays[i].name) return &relays[i];
  return nullptr;
}

// ---- Local web page ----

void handleRoot() {
  server.send_P(200, "text/html", htmlPage);
}

void handleStatus() {
  JsonDocument doc;
  for (int i = 0; i < RELAY_COUNT; i++) doc[relays[i].name] = relays[i].on;
  doc["site"] = siteOnline;
  String json;
  serializeJson(doc, json);
  server.send(200, "application/json", json);
}

// /incubator/on, /fan/off, ... (same addresses as before)
void handleNotFound() {
  String path = server.uri();  // e.g. "/fan/on"
  int slash = path.indexOf('/', 1);
  if (slash > 0) {
    Relay* r = findRelay(path.substring(1, slash));
    String action = path.substring(slash + 1);
    if (r && (action == "on" || action == "off")) {
      setRelay(*r, action == "on");
      changedLocally = true;
      nextCheckin = 0;  // tell the site now
      server.send(200, "application/json", String("{\"state\":") + (r->on ? "true" : "false") + "}");
      return;
    }
  }
  server.send(404, "text/plain", "Not found");
}

// ---- PoultryGrid site ----

String buildCheckin() {
  JsonDocument doc;
  JsonObject state = doc["state"].to<JsonObject>();
  for (int i = 0; i < RELAY_COUNT; i++) state[relays[i].name] = relays[i].on;
  doc["version"] = appliedVersion;
  doc["local"] = changedLocally;
  doc["firmware"] = FIRMWARE_VERSION;
  doc["rssi"] = WiFi.RSSI();
  String out;
  serializeJson(doc, out);
  return out;
}

void checkinWithSite() {
  String url = String(PG_API_URL) + "/api/public/devices/relays";
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

  bool wasLocal = changedLocally;
  int code = http.POST(buildCheckin());
  if (code == 200) {
    if (!siteOnline) Serial.println("Site: online");
    siteOnline = true;
    if (wasLocal) changedLocally = false;
    JsonDocument res;
    if (!deserializeJson(res, http.getString())) {
      long version = res["version"] | 0L;
      JsonObjectConst desired = res["desired"];
      // A newer setting from the site (or the one we just sent): follow it.
      if (version != appliedVersion && !desired.isNull() && !changedLocally) {
        for (int i = 0; i < RELAY_COUNT; i++) {
          JsonVariantConst v = desired[relays[i].name];
          if (v.is<bool>()) setRelay(relays[i], v.as<bool>());
        }
        appliedVersion = version;
      }
      unsigned long next = res["next_ms"] | 15000UL;
      checkinEvery = constrain(next, (unsigned long)MIN_CHECKIN_MS, (unsigned long)MAX_CHECKIN_MS);
    }
  } else {
    if (siteOnline) Serial.println("Site: offline");
    siteOnline = false;
    checkinEvery = 15000;
    Serial.printf("Site check-in failed: HTTP %d %s\n", code,
                  code < 0 ? http.errorToString(code).c_str() : http.getString().c_str());
  }
  http.end();
}

void maintainWifi() {
  if (WiFi.status() == WL_CONNECTED) return;
  siteOnline = false;
  if (lastWifiAttempt != 0 && millis() - lastWifiAttempt < WIFI_RETRY_MS) return;
  lastWifiAttempt = millis();
  // Status: 1 = network not found, 4 = wrong password / rejected, 6 = disconnected
  Serial.printf("Connecting to WiFi... (last status %d)\n", WiFi.status());
  WiFi.disconnect();
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
}

void setup() {
  for (int i = 0; i < RELAY_COUNT; i++) {
    pinMode(relays[i].pin, OUTPUT);
    digitalWrite(relays[i].pin, relays[i].on ? RELAY_ON : RELAY_OFF);
  }

  Serial.begin(115200);

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  lastWifiAttempt = millis();
  Serial.print("Connecting to WiFi");

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 20) {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("Connected! IP address: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.print("WiFi FAILED to connect, will keep trying. Status code: ");
    Serial.println(WiFi.status());
  }

  server.on("/", handleRoot);
  server.on("/status", handleStatus);
  server.onNotFound(handleNotFound);
  server.begin();
  Serial.println("Web server started");
}

void loop() {
  server.handleClient();
  maintainWifi();

  static bool wasConnected = false;
  bool connected = WiFi.status() == WL_CONNECTED;
  if (connected && !wasConnected) {
    Serial.print("Connected! IP address: ");
    Serial.println(WiFi.localIP());
    nextCheckin = 0;
  }
  wasConnected = connected;

  if (connected && (long)(millis() - nextCheckin) >= 0) {
    checkinWithSite();
    nextCheckin = millis() + checkinEvery;
  }
}
