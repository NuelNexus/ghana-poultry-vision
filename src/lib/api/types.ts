// Row shapes returned by the server functions (src/lib/api/farm.functions.ts).
// numeric/bigint columns arrive as numbers and timestamps as ISO strings
// (see src/lib/db.server.ts). Missing values are null, never a fake 0.

/**
 * One set of freshness thresholds for the whole app (server and UI).
 * age < live -> "live" (and device `online`), age < delayed -> "delayed",
 * older -> "stale". Used by ui-kit `freshness()` and listDevices.
 */
export const FRESHNESS_MS = { live: 90_000, delayed: 5 * 60_000 } as const;

export type AiStatus = "healthy" | "warning" | "critical";
/** The fan is switched by a relay on the Pi, so it is only ever on or off. */
export type FanLevel = "on" | "off";

export interface AiCause {
  id: string;
  label: string;
  prob: number;
  advice?: string;
}

export interface Farm {
  id: string;
  name: string;
}

export interface House {
  id: string;
  farm_id: string;
  farm_name: string | null;
  name: string;
  capacity: number | null;
  bird_count: number | null;
  batch_name: string | null;
  batch_started_at: string | null;
  created_at: string;
}

export interface Reading {
  id: number;
  device_id: string;
  house_id: string | null;
  /** DHT22, °C. */
  temperature: number | null;
  /** DHT22, % RH. */
  humidity: number | null;
  /** MQ-135: % rise over the clean-air baseline voltage (ammonia/gas). Coarse (4 or 16) in DO mode. */
  gas_index: number | null;
  /**
   * LDR: relative light level, 0 (dark) to 50 (bright). Not lux. Without an
   * ADS1115 the Pi only knows bright (30) or dark (3) from the module's DO pin.
   */
  light: number | null;
  /** Whether the fan relay was closed (fan running) at this reading. */
  fan_on: boolean | null;
  bird_age_days: number | null;
  ai_status: AiStatus | null;
  ai_confidence: number | null;
  ai_probabilities: Record<AiStatus, number> | null;
  ai_causes: AiCause[] | null;
  /** Same as fan_on, as "on" / "off". */
  fan_level: FanLevel | null;
  growth_phase: string | null;
  target_temp: number | null;
  model_version: string | null;
  /** The reading as the Pi sent it; `sensors` is the agent's health check (agent v4+). */
  payload?: { sensors?: SensorHealth } | null;
  created_at: string;
}

/** Per sensor, from the Pi: "ok", "missing", "implausible", "stuck" or "not_wired". */
export type SensorState = "ok" | "missing" | "implausible" | "stuck" | "not_wired";
export type SensorHealth = Partial<
  Record<"temperature" | "humidity" | "gas_index" | "light", SensorState>
>;

export interface Device {
  id: string;
  device_id: string;
  api_key: string;
  type: string;
  farm_id: string | null;
  house_id: string | null;
  house_name: string | null;
  location: string | null;
  firmware_version: string | null;
  fan_override: FanLevel | null;
  last_seen: string | null;
  online: boolean | null;
  created_at: string;
}

export interface Alert {
  id: string;
  farm_id: string | null;
  house_id: string | null;
  device_id: string | null;
  severity: "info" | "warning" | "critical";
  type: string;
  message: string;
  resolved: boolean | null;
  created_at: string;
}

export interface Hatchery {
  id: string;
  farm_id: string;
  farm_name: string | null;
  name: string;
  egg_count: number | null;
  started_at: string | null;
  expected_hatch_at: string | null;
  /** Incubator temperature setting the farmer entered (°C). Not a measurement. */
  temperature: number | null;
  /** Incubator humidity setting the farmer entered (% RH). Not a measurement. */
  humidity: number | null;
  /** Chicks counted by hand after the hatch. */
  hatched_count: number | null;
  created_at: string;
}

export interface Camera {
  id: string;
  name: string;
  /** MJPEG stream, e.g. http://192.168.1.40:81/stream (ESP32-CAM CameraWebServer). */
  stream_url: string | null;
  house_id: string | null;
  house_name: string | null;
  created_at: string;
}

/** Latest edge-AI reading for one device, with where it is. */
export interface AiSnapshot extends Reading {
  device_code: string;
  house_name: string | null;
  last_seen: string | null;
}

/** getDashboard().stats. null = no data for that module yet (never a fake 0). */
export interface DashboardStats {
  totalBirds: number;
  activeFarms: number;
  /** Mean of the last 20 readings from any device, °C. */
  temperature: number | null;
  /** Mean of the last 20 readings from any device, % RH. */
  humidity: number | null;
  activeAlerts: number;
  /** All open alerts with severity "critical", not only the recent 5. */
  openCritical: number;
  /** null when no eggs have been set. */
  hatchRate: number | null;
  /** Newest sensor reading from any device (ISO), or null. */
  lastReadingAt: string | null;
}

/** getAiMonitor() result. */
export interface AiMonitor {
  /** Latest AI reading per device, most recently reporting first. */
  latest: AiSnapshot[];
  selected: string | null;
  /** Oldest first. Always spans the whole requested range. */
  history: Reading[];
  /** 0 = raw readings. Otherwise each point is the last reading in a bucket of this many seconds. */
  bucketSeconds: number;
}
