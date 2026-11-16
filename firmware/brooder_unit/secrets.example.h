// Copy this file to secrets.h (same folder) and fill it in. secrets.h is not committed.

// ---- WiFi (the same network as the PC running `npm start`) ----
#define WIFI_SSID     "your-wifi-name"
#define WIFI_PASSWORD "your-wifi-password"

// ---- This unit on the PoultryGrid site (Devices -> Register device -> Unit 1) ----
// The PC forwards readings to the site with these, so the site checks the key.
#define PG_DEVICE_ID      "PI-HOUSE-A"
#define PG_DEVICE_API_KEY "paste-the-device-api-key-here"

// ---- Optional: the PC's address. Leave out to find it on the network by itself. ----
// #define PG_PC_HOST "192.168.1.20"
// #define PG_PC_PORT 5004
