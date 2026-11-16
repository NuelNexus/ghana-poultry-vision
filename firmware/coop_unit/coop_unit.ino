// =====================================================
// POULTRY GRID - COOP UNIT (unit 2)
// =====================================================
// ESP32 controller for the coop: two zones (layers and broilers), each with
// a DHT sensor, a fan relay and a lamp relay, plus a water turbidity sensor
// and a 16x2 LCD.
//
// What's new compared to the stand-alone version:
//   - Connects to WiFi and reports to the PoultryGrid site every 10 s
//   - The site can switch each zone between AUTO and MANUAL, turn the fan
//     and lamp on/off in MANUAL, and change the temperature setpoints and
//     water thresholds
//   - Settings are saved in flash: with no WiFi the coop keeps running on
//     the last settings it received
//   - Safety: the lamp is forced off if a zone overheats or its sensor fails,
//     even in MANUAL; fan and lamp are never on together
//   - Feeder conveyor belt: two DC motors (one at each end) on an H-bridge
//     (L298N or similar). The site (or Ama) runs it left or right for a set
//     time; it always stops by itself. The coop asks for belt commands every
//     2 s, so a button press moves it within about 2 s.
//
// Libraries (Arduino Library Manager):
//   DHT sensor library (Adafruit), LiquidCrystal I2C, ArduinoJson (v7)
// Board: ESP32 Dev Module (arduino-esp32 core 2.x or 3.x)
//
// Setup: fill in the SETTINGS block below: your WiFi, and the three lines the
// site shows when you add the coop (Devices -> Add device -> Unit 2 · Coop).
// =====================================================

// =====================================================
// SETTINGS: fill these in before uploading
// =====================================================

// ---- WiFi ----
#define WIFI_SSID     "TECNO SPARK 20"
#define WIFI_PASSWORD "Nuelnexus12"

// ---- PoultryGrid site (paste the three lines from Devices -> Add device) ----
#define PG_API_URL        "https://ghana-poultry-vision.vercel.app"
#define PG_DEVICE_ID      "coopfinal"
#define PG_DEVICE_API_KEY "87684922f94808e93e1b94627876cc1a39a19d17ef31dcc8"

// How often to report to the site and pick up new settings (milliseconds).
// Changes made on the site reach the coop within about this long.
#define REPORT_INTERVAL_MS 10000

// Only for testing against a server with no valid HTTPS certificate.
// Leave at 0 for a real site: 1 lets anyone on the network impersonate it.
#define PG_INSECURE_TLS 0

// Don't commit this file to GitHub with your real WiFi password and device key.
// =====================================================

#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <DHT.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <ArduinoJson.h>

#include "root_ca.h"

#define FIRMWARE_VERSION "coop-2.1.0"

// =========================
// PINS (unchanged)
// =========================
#define DHT22_PIN 4          // layers zone
#define DHT11_PIN 5          // broilers zone
#define LAYERS_FAN_RELAY 25
#define LAYERS_LAMP_RELAY 26
#define BROILERS_FAN_RELAY 27
#define BROILERS_LAMP_RELAY 14
#define TURBIDITY_PIN 34     // ADC1, safe with WiFi
#define LCD_ADDRESS 0x27

// Feeder belt H-bridge (L298N: IN1/IN2/ENA = motor A, IN3/IN4/ENB = motor B).
// Both motors run together. Connect the H-bridge GND to the ESP32 GND, and power the
// motors from their own supply (not the ESP32's 3.3 V / 5 V pins).
#define BELT_A_IN1 18        // motor A (left end)  -> IN1
#define BELT_A_IN2 19        //                     -> IN2
#define BELT_A_EN  23        // ENA (or leave the L298N's ENA jumper on for full speed)
#define BELT_B_IN1 32        // motor B (right end) -> IN3
#define BELT_B_IN2 33        //                     -> IN4
#define BELT_B_EN  13        // ENB (or leave the ENB jumper on)

// Your relay board is ACTIVE HIGH (HIGH = relay ON).
// If the relays work backwards after testing, change this to false.
const bool RELAY_ACTIVE_HIGH = true;

// Feeder belt tuning.
// If one motor fights the other (the belt stalls or slips), set that motor's INVERT to true.
// If "Left" on the site moves the belt right, flip BELT_LEFT_IS_FORWARD.
const bool BELT_A_INVERT = false;
const bool BELT_B_INVERT = false;
const bool BELT_LEFT_IS_FORWARD = true;
const int BELT_SPEED = 255;               // 0-255 PWM on ENA / ENB
const int BELT_MAX_S = 120;               // longest single run (the site has the same limit)
const unsigned long BELT_POLL_MS = 2000;  // how often to ask the site for belt commands
const int BELT_FRESH_S = 30;              // ignore commands older than this (e.g. after a restart)

// =========================
// SAFETY LIMITS (not changeable from the site)
// =========================
// Lamp is forced off this far above the zone's HIGH setpoint, in any mode.
const float OVERHEAT_MARGIN = 6.0;
// ...and always above this temperature.
const float LAMP_ABSOLUTE_MAX = 40.0;
const int MAX_SENSOR_ERRORS = 3;

// =========================
// TURBIDITY (unchanged wiring)
// =========================
// Sensor A ---[10k]---+---[20k]--- GND, junction -> GPIO 34
const float TURBIDITY_DIVIDER_RATIO = 1.5;
const float TURBIDITY_MIN_VALID_VOLTAGE = 0.2;
const int TURBIDITY_SAMPLES = 20;

// =========================
// TIMING
// =========================
const unsigned long CONTROL_INTERVAL_MS = 2000;
const unsigned long DISPLAY_TIME = 10000;
const unsigned long WIFI_RETRY_MS = 15000;
const uint16_t HTTP_TIMEOUT_MS = 6000;

// =====================================================
// SETTINGS (what the site can change)
// =====================================================

struct ZoneSettings {
  bool manual;        // false = AUTO (thermostat), true = MANUAL (site decides)
  bool fanCmd;        // MANUAL: fan on/off
  bool lampCmd;       // MANUAL: lamp on/off
  float highTemp;     // AUTO: fan on above this
  float fanOffTemp;   // AUTO: fan off at or below this
  float lampOffTemp;  // AUTO: lamp off at or above this
  float lowTemp;      // AUTO: lamp on below this
};

struct Settings {
  uint32_t magic;
  int32_t version;    // controls version from the site (0 = factory defaults)
  ZoneSettings zone[2];
  float waterBadV;
  float waterGoodV;
};

// Defined here, above every function, because the Arduino builder puts its
// auto-generated function declarations just before the first function.
struct Zone {
  const char* key;      // name used by the site
  const char* lcdName;  // 7 chars max
  DHT* dht;
  int fanPin;
  int lampPin;
  float temperature;
  float humidity;
  bool fan;
  bool lamp;
  int errors;
  bool sensorOk;
  bool safetyTripped;   // lamp forced off by a safety limit
};

const uint32_t SETTINGS_MAGIC = 0x50474332;  // "PGC2"

Settings settings;
Preferences prefs;

void loadDefaults() {
  settings.magic = SETTINGS_MAGIC;
  settings.version = 0;
  for (int i = 0; i < 2; i++) {
    // Same values as the original sketch
    settings.zone[i] = {false, false, false, 24.0, 23.0, 19.0, 18.0};
  }
  settings.waterBadV = 2.5;
  settings.waterGoodV = 2.7;
}

void saveSettings() {
  prefs.putBytes("s", &settings, sizeof(settings));
}

void loadSettings() {
  Settings stored;
  if (prefs.getBytes("s", &stored, sizeof(stored)) == sizeof(stored) && stored.magic == SETTINGS_MAGIC) {
    settings = stored;
  } else {
    loadDefaults();
  }
}

// =====================================================
// ZONES
// =====================================================

DHT dhtLayers(DHT22_PIN, DHT22);
DHT dhtBroilers(DHT11_PIN, DHT11);

Zone zones[2] = {
  {"layers", "LAYERS", &dhtLayers, LAYERS_FAN_RELAY, LAYERS_LAMP_RELAY, NAN, NAN, false, false, 0, false, false},
  {"broilers", "BROILER", &dhtBroilers, BROILERS_FAN_RELAY, BROILERS_LAMP_RELAY, NAN, NAN, false, false, 0, false, false},
};

// =========================
// WATER / DISPLAY / NETWORK STATE
// =========================
float turbidityVoltage = 0.0;
bool waterGood = true;
bool turbiditySensorOK = true;

LiquidCrystal_I2C lcd(LCD_ADDRESS, 16, 2);
unsigned long previousDisplayTime = 0;
unsigned long lastControl = 0;
unsigned long lastReport = 0;
unsigned long lastWifiAttempt = 0;
int displayState = 0;

// Feeder belt
int beltDir = 0;                  // -1 left, 0 stopped, 1 right
unsigned long beltUntil = 0;      // millis() when the current run ends
int beltCmdId = -1;               // last command id seen from the site (-1 = none yet)
unsigned long lastBeltPoll = 0;
esp_timer_handle_t beltTimer = nullptr;

bool siteOnline = false;       // last report reached the site
String lastConfigError = "";   // reported back if the site sends bad settings

// =====================================================
// RELAYS
// =====================================================

void updateRelay(int relayPin, bool on) {
  digitalWrite(relayPin, (on == RELAY_ACTIVE_HIGH) ? HIGH : LOW);
}

// =====================================================
// FEEDER BELT
// =====================================================

void driveMotor(int in1, int in2, int en, int dir) {
  // dir: 1 forward, -1 backward, 0 stop (both inputs LOW = coast)
  digitalWrite(in1, dir > 0 ? HIGH : LOW);
  digitalWrite(in2, dir < 0 ? HIGH : LOW);
  analogWrite(en, dir == 0 ? 0 : BELT_SPEED);
}

void setBeltMotors(int dir) {  // dir: -1 left, 0 stop, 1 right
  int fwd = BELT_LEFT_IS_FORWARD ? -dir : dir;
  driveMotor(BELT_A_IN1, BELT_A_IN2, BELT_A_EN, BELT_A_INVERT ? -fwd : fwd);
  driveMotor(BELT_B_IN1, BELT_B_IN2, BELT_B_EN, BELT_B_INVERT ? -fwd : fwd);
}

void stopBelt() {
  if (beltTimer) esp_timer_stop(beltTimer);
  setBeltMotors(0);
  if (beltDir != 0) Serial.println("Feeder belt: stopped");
  beltDir = 0;
  beltUntil = 0;
}

// Runs on the esp_timer task, so the belt stops on time even while the loop is busy
// talking to the site.
void beltTimerDone(void*) {
  setBeltMotors(0);
}

void runBelt(int dir, int seconds) {
  seconds = constrain(seconds, 1, BELT_MAX_S);
  if (beltTimer) esp_timer_stop(beltTimer);
  if (beltDir != 0 && beltDir != dir) {
    setBeltMotors(0);  // let the motors stop before reversing
    delay(300);
  }
  beltDir = dir;
  beltUntil = millis() + seconds * 1000UL;
  setBeltMotors(dir);
  if (beltTimer) esp_timer_start_once(beltTimer, (uint64_t)seconds * 1000000ULL);
  Serial.printf("Feeder belt: %s for %d s\n", dir < 0 ? "LEFT" : "RIGHT", seconds);
}

void beltSetup() {
  const int pins[] = {BELT_A_IN1, BELT_A_IN2, BELT_A_EN, BELT_B_IN1, BELT_B_IN2, BELT_B_EN};
  for (int p : pins) {
    pinMode(p, OUTPUT);
    digitalWrite(p, LOW);
  }
  esp_timer_create_args_t args = {};
  args.callback = beltTimerDone;
  args.name = "belt";
  esp_timer_create(&args, &beltTimer);
}

// Keep beltDir in step with the timer that stopped the motors.
void beltTick() {
  if (beltDir != 0 && (long)(millis() - beltUntil) >= 0) stopBelt();
}

int beltRemaining() {
  if (beltDir == 0) return 0;
  long ms = (long)(beltUntil - millis());
  return ms > 0 ? (ms + 999) / 1000 : 0;
}

const char* beltDirName() {
  return beltDir < 0 ? "left" : beltDir > 0 ? "right" : "stop";
}

// =====================================================
// CONTROL
// =====================================================

void controlZone(Zone& z, const ZoneSettings& s) {
  z.safetyTripped = false;

  if (!z.sensorOk) {
    // No reliable temperature: never leave a lamp on blind.
    // AUTO goes to the safe state (both off); MANUAL keeps the fan if asked.
    z.lamp = false;
    z.fan = s.manual ? s.fanCmd : false;
  } else if (s.manual) {
    z.fan = s.fanCmd;
    z.lamp = s.lampCmd;
  } else {
    // AUTO thermostat with hysteresis (original logic, setpoints from site)
    float t = z.temperature;
    if (t > s.highTemp) {
      z.fan = true;
      z.lamp = false;
    } else if (t < s.lowTemp) {
      z.fan = false;
      z.lamp = true;
    }
    if (z.fan && t <= s.fanOffTemp) z.fan = false;
    if (z.lamp && t >= s.lampOffTemp) z.lamp = false;
  }

  // Overheat protection, any mode
  if (z.lamp && z.sensorOk &&
      (z.temperature > s.highTemp + OVERHEAT_MARGIN || z.temperature > LAMP_ABSOLUTE_MAX)) {
    z.lamp = false;
    z.safetyTripped = true;
  }

  // NEVER fan and lamp together (fan wins: it is the safe one)
  if (z.fan) z.lamp = false;

  updateRelay(z.fanPin, z.fan);
  updateRelay(z.lampPin, z.lamp);
}

void readZone(Zone& z) {
  float t = z.dht->readTemperature();
  float h = z.dht->readHumidity();
  if (isnan(t)) {
    z.errors++;
    Serial.printf("%s sensor ERROR: %d\n", z.lcdName, z.errors);
    if (z.errors >= MAX_SENSOR_ERRORS) z.sensorOk = false;
  } else {
    z.errors = 0;
    z.sensorOk = true;
    z.temperature = t;
    if (!isnan(h)) z.humidity = h;
  }
}

// =====================================================
// TURBIDITY
// =====================================================

float readTurbidityVoltage() {
  long totalMilliVolts = 0;
  for (int i = 0; i < TURBIDITY_SAMPLES; i++) {
    totalMilliVolts += analogReadMilliVolts(TURBIDITY_PIN);
    delay(2);
  }
  float pinVoltage = (totalMilliVolts / (float)TURBIDITY_SAMPLES) / 1000.0;
  return pinVoltage * TURBIDITY_DIVIDER_RATIO;
}

void updateWaterState(float voltage) {
  if (voltage < TURBIDITY_MIN_VALID_VOLTAGE) {
    turbiditySensorOK = false;
    return;
  }
  turbiditySensorOK = true;
  if (waterGood && voltage < settings.waterBadV) {
    waterGood = false;
  } else if (!waterGood && voltage > settings.waterGoodV) {
    waterGood = true;
  }
}

// =====================================================
// SITE LINK
// =====================================================

// Apply the "controls" object from the site. Returns false (and keeps the
// current settings) if anything in it is out of range.
bool applyControls(JsonObjectConst c) {
  int version = c["version"] | -1;
  if (version < 0 || version == settings.version) return true;  // nothing new

  Settings next = settings;
  next.version = version;

  for (int i = 0; i < 2; i++) {
    JsonObjectConst zc = c["zones"][zones[i].key];
    if (zc.isNull()) continue;
    ZoneSettings& s = next.zone[i];
    const char* mode = zc["mode"] | (s.manual ? "manual" : "auto");
    s.manual = strcmp(mode, "manual") == 0;
    s.fanCmd = zc["fan"] | s.fanCmd;
    s.lampCmd = zc["lamp"] | s.lampCmd;
    s.highTemp = zc["high_temp"] | s.highTemp;
    s.fanOffTemp = zc["fan_off_temp"] | s.fanOffTemp;
    s.lampOffTemp = zc["lamp_off_temp"] | s.lampOffTemp;
    s.lowTemp = zc["low_temp"] | s.lowTemp;

    bool ordered = s.lowTemp < s.lampOffTemp && s.lampOffTemp <= s.fanOffTemp && s.fanOffTemp < s.highTemp;
    bool inRange = s.lowTemp >= 0 && s.highTemp <= 45;
    if (!ordered || !inRange) {
      lastConfigError = String(zones[i].key) + ": setpoints must be low < lamp-off <= fan-off < high, 0-45 C";
      return false;
    }
  }

  JsonObjectConst w = c["water"];
  if (!w.isNull()) {
    next.waterBadV = w["bad_v"] | next.waterBadV;
    next.waterGoodV = w["good_v"] | next.waterGoodV;
    if (!(next.waterBadV > 0.2 && next.waterBadV < next.waterGoodV && next.waterGoodV < 5.0)) {
      lastConfigError = "water: thresholds must be 0.2 < bad < good < 5.0 V";
      return false;
    }
  }

  settings = next;
  saveSettings();
  lastConfigError = "";
  Serial.printf("New settings from site: version %d\n", settings.version);

  // Act on it now rather than at the next control tick
  for (int i = 0; i < 2; i++) controlZone(zones[i], settings.zone[i]);
  return true;
}

String buildReport() {
  JsonDocument doc;
  doc["unit"] = "coop";
  doc["firmware"] = FIRMWARE_VERSION;
  doc["config_version"] = settings.version;
  if (lastConfigError.length()) doc["config_error"] = lastConfigError;
  doc["rssi"] = WiFi.RSSI();
  doc["uptime_s"] = millis() / 1000;

  JsonObject zs = doc["zones"].to<JsonObject>();
  for (int i = 0; i < 2; i++) {
    Zone& z = zones[i];
    JsonObject o = zs[z.key].to<JsonObject>();
    if (z.sensorOk) {
      o["temp"] = round(z.temperature * 10) / 10.0;
      if (!isnan(z.humidity)) o["humidity"] = round(z.humidity);
    }
    o["sensor_ok"] = z.sensorOk;
    o["fan"] = z.fan;
    o["lamp"] = z.lamp;
    o["mode"] = settings.zone[i].manual ? "manual" : "auto";
    o["safety_tripped"] = z.safetyTripped;
  }

  JsonObject belt = doc["conveyor"].to<JsonObject>();
  belt["dir"] = beltDirName();
  belt["remaining_s"] = beltRemaining();

  JsonObject w = doc["water"].to<JsonObject>();
  w["voltage"] = round(turbidityVoltage * 100) / 100.0;
  w["sensor_ok"] = turbiditySensorOK;
  w["good"] = waterGood;

  String out;
  serializeJson(doc, out);
  return out;
}

void reportToSite() {
  String url = String(PG_API_URL) + "/api/public/devices/ingest";
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

  int code = http.POST(buildReport());
  if (code == 200) {
    siteOnline = true;
    // Only keep the part of the response we need
    JsonDocument filter;
    filter["config"]["controls"] = true;
    JsonDocument res;
    DeserializationError err = deserializeJson(res, http.getString(), DeserializationOption::Filter(filter));
    if (!err) {
      JsonObjectConst controls = res["config"]["controls"];
      if (!controls.isNull()) applyControls(controls);
    }
  } else {
    siteOnline = false;
    Serial.printf("Site report failed: HTTP %d %s\n", code, code < 0 ? http.errorToString(code).c_str() : "");
  }
  http.end();
}

// Ask the site for the latest belt command and report what the belt is doing.
// One connection is kept open between polls, so each poll is quick.
WiFiClientSecure beltSecure;
WiFiClient beltPlain;
HTTPClient beltHttp;

void pollBelt() {
  String url = String(PG_API_URL) + "/api/public/devices/conveyor";
  bool https = url.startsWith("https://");
  beltHttp.setReuse(true);
  beltHttp.setTimeout(4000);
  bool ok = https ? beltHttp.begin(beltSecure, url) : beltHttp.begin(beltPlain, url);
  if (!ok) return;
  beltHttp.addHeader("content-type", "application/json");
  beltHttp.addHeader("x-device-id", PG_DEVICE_ID);
  beltHttp.addHeader("x-api-key", PG_DEVICE_API_KEY);

  JsonDocument body;
  JsonObject st = body["state"].to<JsonObject>();
  st["dir"] = beltDirName();
  st["remaining_s"] = beltRemaining();
  st["cmd_id"] = beltCmdId < 0 ? 0 : beltCmdId;
  String out;
  serializeJson(body, out);

  int code = beltHttp.POST(out);
  if (code == 200) {
    JsonDocument res;
    if (!deserializeJson(res, beltHttp.getString())) {
      int id = res["id"] | 0;
      int age = res["age_s"] | 0;
      const char* dir = res["dir"] | "stop";
      int seconds = res["seconds"] | 10;
      // A new command runs once, and only while fresh: after a restart the coop never
      // replays an old run.
      bool isNew = id > 0 && id != beltCmdId;
      beltCmdId = id;
      if (isNew && age <= BELT_FRESH_S) {
        if (strcmp(dir, "left") == 0) runBelt(-1, seconds);
        else if (strcmp(dir, "right") == 0) runBelt(1, seconds);
        else stopBelt();
      }
    }
  } else {
    Serial.printf("Belt poll failed: HTTP %d\n", code);
  }
  beltHttp.end();
}

void maintainWifi() {
  if (WiFi.status() == WL_CONNECTED) return;
  siteOnline = false;
  if (millis() - lastWifiAttempt < WIFI_RETRY_MS && lastWifiAttempt != 0) return;
  lastWifiAttempt = millis();
  // Status: 1 = network not found, 4 = wrong password / rejected, 6 = disconnected
  Serial.printf("Connecting to WiFi... (last status %d)\n", WiFi.status());
  WiFi.disconnect();
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
}

// =====================================================
// LCD
// =====================================================

void showWelcome() {
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("WELCOME TO");
  lcd.setCursor(0, 1);
  lcd.print("POULTRY GRID");
}

void showZone(const Zone& z, const ZoneSettings& s) {
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print(z.lcdName);
  lcd.print(" ");
  if (!z.sensorOk) {
    lcd.print("ERROR");
  } else {
    lcd.print(z.temperature, 1);
    lcd.print((char)223);
    lcd.print("C");
  }
  lcd.setCursor(0, 1);
  lcd.print("F:");
  lcd.print(z.fan ? "ON " : "OFF");
  lcd.print(" L:");
  lcd.print(z.lamp ? "ON " : "OFF");
  lcd.print(z.safetyTripped ? " HOT" : (s.manual ? " MAN" : " AUT"));
}

void showWaterState() {
  lcd.clear();
  lcd.setCursor(0, 0);
  if (!turbiditySensorOK) {
    lcd.print("WATER: ERROR");
    lcd.setCursor(0, 1);
    lcd.print("CHECK SENSOR");
    return;
  }
  lcd.print("WATER: ");
  lcd.print(waterGood ? "GOOD" : "BAD");
  lcd.setCursor(0, 1);
  if (!waterGood) lcd.print("CHANGE! ");
  lcd.print("V:");
  lcd.print(turbidityVoltage, 2);
}

void showNetwork() {
  lcd.clear();
  lcd.setCursor(0, 0);
  if (WiFi.status() != WL_CONNECTED) {
    lcd.print("WIFI: OFFLINE");
    lcd.setCursor(0, 1);
    lcd.print("RUNNING LOCALLY");
    return;
  }
  lcd.print(siteOnline ? "SITE: ONLINE" : "SITE: NO REPLY");
  lcd.setCursor(0, 1);
  lcd.print("SETTINGS v");
  lcd.print(settings.version);
}

// =====================================================
// SETUP
// =====================================================

void setup() {
  Serial.begin(115200);

  prefs.begin("pgcoop", false);
  loadSettings();

  dhtLayers.begin();
  dhtBroilers.begin();

  analogReadResolution(12);
  analogSetPinAttenuation(TURBIDITY_PIN, ADC_11db);
  pinMode(TURBIDITY_PIN, INPUT);

  // Start with EVERYTHING OFF
  beltSetup();
  for (int i = 0; i < 2; i++) {
    pinMode(zones[i].fanPin, OUTPUT);
    pinMode(zones[i].lampPin, OUTPUT);
    updateRelay(zones[i].fanPin, false);
    updateRelay(zones[i].lampPin, false);
  }

  Wire.begin(21, 22);
  lcd.init();
  lcd.backlight();
  showWelcome();
  previousDisplayTime = millis();

#if PG_INSECURE_TLS
  beltSecure.setInsecure();
#else
  beltSecure.setCACert(ROOT_CA_BUNDLE);
#endif

  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  maintainWifi();

  Serial.println();
  Serial.println("==============================");
  Serial.println(" POULTRY GRID - COOP UNIT " FIRMWARE_VERSION);
  Serial.println("==============================");
  Serial.printf("Settings version %d loaded. All outputs initially OFF.\n", settings.version);
}

// =====================================================
// MAIN LOOP
// =====================================================

void loop() {
  unsigned long now = millis();

  if (now - lastControl >= CONTROL_INTERVAL_MS) {
    lastControl = now;
    for (int i = 0; i < 2; i++) {
      readZone(zones[i]);
      controlZone(zones[i], settings.zone[i]);
    }
    turbidityVoltage = readTurbidityVoltage();
    updateWaterState(turbidityVoltage);

    for (int i = 0; i < 2; i++) {
      Zone& z = zones[i];
      Serial.printf("%s: ", z.lcdName);
      if (z.sensorOk) Serial.printf("%.1f C %.0f%%", z.temperature, z.humidity);
      else Serial.print("SENSOR ERROR");
      Serial.printf(" | FAN=%s LAMP=%s | %s%s\n", z.fan ? "ON" : "OFF", z.lamp ? "ON" : "OFF",
                    settings.zone[i].manual ? "MANUAL" : "AUTO", z.safetyTripped ? " | OVERHEAT CUT-OUT" : "");
    }
    if (beltDir != 0) Serial.printf("BELT: %s, %d s left\n", beltDir < 0 ? "LEFT" : "RIGHT", beltRemaining());
    Serial.printf("WATER: %.2f V | %s\n", turbidityVoltage,
                  !turbiditySensorOK ? "SENSOR ERROR" : (waterGood ? "GOOD" : "BAD"));
  }

  beltTick();
  maintainWifi();
  if (WiFi.status() == WL_CONNECTED && now - lastBeltPoll >= BELT_POLL_MS) {
    lastBeltPoll = now;
    pollBelt();
    beltTick();
  }
  if (WiFi.status() == WL_CONNECTED && (now - lastReport >= REPORT_INTERVAL_MS || lastReport == 0)) {
    lastReport = now;
    reportToSite();
  }

  // 0 = Welcome, 1 = Layers, 2 = Broilers, 3 = Water, 4 = Network
  if (now - previousDisplayTime >= DISPLAY_TIME) {
    previousDisplayTime = now;
    displayState = (displayState + 1) % 5;
    if (displayState == 0) showWelcome();
    else if (displayState == 1) showZone(zones[0], settings.zone[0]);
    else if (displayState == 2) showZone(zones[1], settings.zone[1]);
    else if (displayState == 3) showWaterState();
    else showNetwork();
  }

  delay(20);
}
