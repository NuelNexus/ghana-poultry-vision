// Copy this file to config.h and fill it in.
// config.h is gitignored so your WiFi password and device key stay private.
#pragma once

// ---- WiFi ----
#define WIFI_SSID     "your-wifi-name"
#define WIFI_PASSWORD "your-wifi-password"

// ---- PoultryGrid site ----
// From the site: Devices -> Register device -> "Coop unit (ESP32)".
// The setup box shows these three values.
#define PG_API_URL        "https://your-site.example.com"
#define PG_DEVICE_ID      "COOP-1"
#define PG_DEVICE_API_KEY "paste-the-device-api-key-here"

// How often to report to the site and pick up new settings (milliseconds).
// Changes made on the site reach the coop within about this long.
#define REPORT_INTERVAL_MS 10000

// Only for testing against a server with no valid HTTPS certificate.
// Leave at 0 for a real site: 1 lets anyone on the network impersonate it.
#define PG_INSECURE_TLS 0
