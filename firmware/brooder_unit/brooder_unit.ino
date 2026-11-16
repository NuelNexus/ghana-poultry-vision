// =====================================================
// POULTRY GRID - BROODING AREA UNIT (ESP32)
// =====================================================
// DHT22 (temperature, humidity) and MQ-135 (ammonia / gas) in the brooding area.
// Every PG_REPORT_MS it sends the reading, signed with this unit's device ID and API
// key, to the PoultryGrid brooder AI on your PC (edge/brooder_server.py, started by
// `npm start`). The PC runs the coop model (status, causes, fan decision) and reports
// to the site, so the Dashboard, AI Health and Alerts pages show it like the Pi did.
//
// The ESP32 finds the PC by itself: it broadcasts "PG-BROODER?" on UDP port 5004 and
// the PC answers. If the PC gets a new IP, the next failed send looks for it again.
// To skip the search, set PG_PC_HOST in secrets.h.
//
// Optional fan relay: set FAN_RELAY_PIN to the relay's IN pin and the unit switches the
// fan the way the AI (or a manager's override on Automation) says. -1 = no relay.
//
// Wiring:
//   DHT22   DATA -> GPIO 4 (10k pull-up to 3.3 V on a bare sensor), VCC 3.3 V, GND
//   MQ-135  AO -> 10k -> GPIO 34 -> 10k -> GND   (the divider halves its 0-5 V output)
//           VCC 5 V, GND. Let it warm up (24 h the first time, minutes after that).
//
// Libraries (Arduino Library Manager): "DHT sensor library" by Adafruit
//   (+ "Adafruit Unified Sensor"), ArduinoJson (v7)
// Board: ESP32 Dev Module (arduino-esp32 core 2.x or 3.x)
//
// Setup: copy secrets.example.h to secrets.h (same folder): your Wi-Fi, and the
// device ID and API key from the site (Devices -> Register device -> Unit 1).
// =====================================================

#include <WiFi.h>
#include <WiFiUdp.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include "DHT.h"

// Your Wi-Fi and this unit's key: secrets.h (ignored by git). Without one, the values in
// secrets.example.h are used, so never commit real ones there.
#if __has_include("secrets.h")
#include "secrets.h"
#else
#include "secrets.example.h"
#endif

#define FIRMWARE_VERSION "brooder-esp32 1.0"

// ---- DHT22 ----
#define DHTPIN 4
#define DHTTYPE DHT22
DHT dht(DHTPIN, DHTTYPE);

// ---- MQ-135 ----
#define MQ135_PIN 34
// Voltage divider: 10k + 10k, so the GPIO sees half of the module's AO voltage.
const float DIVIDER_RATIO = 2.0;

// ---- Optional fan relay (-1 = none) ----
#define FAN_RELAY_PIN -1
#define RELAY_ON  HIGH
#define RELAY_OFF LOW

// ---- Timing ----
#define READ_EVERY_MS 2500     // DHT22 needs at least 2 s between reads
#define PG_REPORT_MS  30000    // what the AI on the PC is tuned for
#define DISCOVER_PORT 5004
#define HTTP_TIMEOUT_MS 5000

#ifndef PG_PC_HOST
#define PG_PC_HOST ""          // e.g. "192.168.1.20"; empty = find the PC on the network
#endif
#ifndef PG_PC_PORT
#define PG_PC_PORT 5004
#endif

float temperature = NAN, humidity = NAN;  // latest good DHT22 reading
unsigned long lastGoodDht = 0;
// Good DHT22 reads since the last report. The report sends their average: more accurate
// than one read, and with real decimals, so a steady room isn't mistaken for a frozen
// sensor (the AI flags a DHT22 that repeats the exact same value for 5 minutes).
float sumT = 0, sumH = 0;
int nTH = 0;
float mqVoltage = NAN;                    // MQ-135 AO, averaged
bool fanOn = false;

String pcHost = PG_PC_HOST;
int pcPort = PG_PC_PORT;
int sendFailures = 0;
unsigned long lastRead = 0, lastReport = 0, lastWifiAttempt = 0;

// ---- Sensors ----

void readSensors() {
  float t = dht.readTemperature();
  float h = dht.readHumidity();
  if (!isnan(t) && !isnan(h)) {
    temperature = t;
    humidity = h;
    lastGoodDht = millis();
    sumT += t;
    sumH += h;
    nTH++;
  }

  // analogReadMilliVolts uses the chip's calibration (plain analogRead is off by up to 0.2 V).
  uint32_t mv = 0;
  for (int i = 0; i < 16; i++) mv += analogReadMilliVolts(MQ135_PIN);
  float gpioVoltage = (mv / 16.0f) / 1000.0f;
  float v = gpioVoltage * DIVIDER_RATIO;
  mqVoltage = isnan(mqVoltage) ? v : mqVoltage * 0.7f + v * 0.3f;  // smooth the noise

  Serial.printf("T %s C  RH %s %%  |  MQ135 GPIO %.2f V  AO %.2f V  |  fan %s  |  PC %s\n",
                isnan(t) ? "--" : String(t, 1).c_str(), isnan(h) ? "--" : String(h, 1).c_str(),
                gpioVoltage, mqVoltage, fanOn ? "on" : "off",
                pcHost.length() ? pcHost.c_str() : "searching");
}

bool dhtFresh() { return lastGoodDht != 0 && millis() - lastGoodDht < 15000; }

void setFan(bool on) {
  fanOn = on;
#if FAN_RELAY_PIN >= 0
  digitalWrite(FAN_RELAY_PIN, on ? RELAY_ON : RELAY_OFF);
#endif
}

// ---- Find the PC ----

bool discoverPc() {
  WiFiUDP udp;
  if (!udp.begin(DISCOVER_PORT + 1)) return false;
  IPAddress bcast = WiFi.localIP();
  IPAddress mask = WiFi.subnetMask();
  for (int i = 0; i < 4; i++) bcast[i] = (bcast[i] & mask[i]) | (~mask[i] & 0xFF);
  for (int attempt = 0; attempt < 3; attempt++) {
    udp.beginPacket(bcast, DISCOVER_PORT);
    udp.print("PG-BROODER?");
    udp.endPacket();
    unsigned long until = millis() + 1500;
    while (millis() < until) {
      int n = udp.parsePacket();
      if (n > 0) {
        char buf[64] = {0};
        udp.read(buf, sizeof(buf) - 1);
        int port = 0;
        if (sscanf(buf, "PG-BROODER %d", &port) == 1 && port > 0) {
          pcHost = udp.remoteIP().toString();
          pcPort = port;
          udp.stop();
          Serial.printf("Found the PoultryGrid PC at %s:%d\n", pcHost.c_str(), pcPort);
          return true;
        }
      }
      delay(20);
    }
  }
  udp.stop();
  Serial.println("PoultryGrid PC not found. Is `npm start` running on it, and Python allowed through its firewall?");
  return false;
}

// ---- Send a reading ----

void report() {
  if (!pcHost.length() && !discoverPc()) return;

  JsonDocument doc;
  if (dhtFresh()) {
    float t = nTH ? sumT / nTH : temperature;
    float h = nTH ? sumH / nTH : humidity;
    sumT = sumH = 0;
    nTH = 0;
    doc["temperature"] = roundf(t * 100) / 100;
    doc["humidity"] = roundf(h * 100) / 100;
  } else {
    doc["temperature"] = nullptr;  // the AI treats a dead DHT22 as a sensor fault
    doc["humidity"] = nullptr;
  }
  if (!isnan(mqVoltage)) doc["mq_voltage"] = roundf(mqVoltage * 1000) / 1000;
#if FAN_RELAY_PIN >= 0
  doc["fan_on"] = fanOn;           // only a unit with a relay knows the fan's real state
#endif
  doc["firmware"] = FIRMWARE_VERSION;
  doc["rssi"] = WiFi.RSSI();
  String body;
  serializeJson(doc, body);

  HTTPClient http;
  http.setTimeout(HTTP_TIMEOUT_MS);
  String url = "http://" + pcHost + ":" + String(pcPort) + "/reading";
  if (!http.begin(url)) return;
  http.addHeader("content-type", "application/json");
  http.addHeader("x-device-id", PG_DEVICE_ID);
  http.addHeader("x-api-key", PG_DEVICE_API_KEY);
  int code = http.POST(body);
  if (code == 200) {
    sendFailures = 0;
    JsonDocument res;
    if (!deserializeJson(res, http.getString())) {
      const char* status = res["status"] | "?";
      float conf = res["confidence"] | 0.0f;
      Serial.printf("AI: %s (%.0f%%)", status, conf * 100);
      JsonArrayConst causes = res["causes"];
      for (JsonVariantConst c : causes) Serial.printf(" | %s", c.as<const char*>());
      Serial.println();
      if (res["fan_on"].is<bool>()) setFan(res["fan_on"].as<bool>());
    }
  } else {
    Serial.printf("Send to PC failed: %d %s\n", code,
                  code < 0 ? http.errorToString(code).c_str() : http.getString().c_str());
    // The PC may have a new address: look for it again (unless it was set by hand).
    if (++sendFailures >= 2 && String(PG_PC_HOST).length() == 0) {
      pcHost = "";
      sendFailures = 0;
    }
  }
  http.end();
}

void maintainWifi() {
  if (WiFi.status() == WL_CONNECTED) return;
  if (lastWifiAttempt != 0 && millis() - lastWifiAttempt < 15000) return;
  lastWifiAttempt = millis();
  Serial.printf("Connecting to WiFi... (last status %d)\n", WiFi.status());
  WiFi.disconnect();
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
}

void setup() {
  Serial.begin(115200);
  dht.begin();
  analogReadResolution(12);
  analogSetPinAttenuation(MQ135_PIN, ADC_11db);
#if FAN_RELAY_PIN >= 0
  pinMode(FAN_RELAY_PIN, OUTPUT);
  setFan(false);
#endif

  Serial.println("================================");
  Serial.println("  POULTRYGRID BROODER MONITOR");
  Serial.println("================================");

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  lastWifiAttempt = millis();
  for (int i = 0; i < 30 && WiFi.status() != WL_CONNECTED; i++) delay(500);
  if (WiFi.status() == WL_CONNECTED)
    Serial.printf("WiFi connected: %s\n", WiFi.localIP().toString().c_str());
  delay(2000);
}

void loop() {
  maintainWifi();
  if (millis() - lastRead >= READ_EVERY_MS || lastRead == 0) {
    lastRead = millis();
    readSensors();
  }
  if (WiFi.status() == WL_CONNECTED && (lastReport == 0 || millis() - lastReport >= PG_REPORT_MS)) {
    lastReport = millis();
    report();
  }
  delay(20);
}
