// Row shapes returned by the server functions (src/lib/api/farm.functions.ts).
// numeric/bigint columns arrive as numbers and timestamps as ISO strings
// (see src/lib/db.server.ts).

export type AiStatus = "healthy" | "warning" | "critical";
export type FanLevel = "low" | "medium" | "high";

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
  temperature: number | null;
  humidity: number | null;
  air_quality: number | null;
  gas_index: number | null;
  water_level: number | null;
  feed_level: number | null;
  light: number | null;
  fan_rpm: number | null;
  fan_duty: number | null;
  bird_age_days: number | null;
  ai_status: AiStatus | null;
  ai_confidence: number | null;
  ai_probabilities: Record<AiStatus, number> | null;
  ai_causes: AiCause[] | null;
  fan_level: FanLevel | null;
  growth_phase: string | null;
  target_temp: number | null;
  model_version: string | null;
  created_at: string;
}

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
  temperature: number | null;
  humidity: number | null;
  hatched_count: number | null;
  created_at: string;
}

export interface Camera {
  id: string;
  name: string;
  stream_url: string | null;
  status: string | null;
  created_at: string;
}

export interface EnergyRecord {
  id: number;
  solar_w: number | null;
  battery_pct: number | null;
  consumption_w: number | null;
  created_at: string;
}

export interface BiogasRecord {
  id: number;
  gas_m3: number | null;
  waste_kg: number | null;
  fertilizer_kg: number | null;
  efficiency_pct: number | null;
  created_at: string;
}

/** Latest edge-AI reading for one device, with where it is. */
export interface AiSnapshot extends Reading {
  device_code: string;
  house_name: string | null;
  last_seen: string | null;
}
