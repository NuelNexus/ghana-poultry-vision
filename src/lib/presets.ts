import type { ZoneControls } from "./controls";

// Ready-made values for the kind of birds (or eggs) a farmer keeps. Picked at
// sign-up (saved on the account as users.poultry_preset) and applied from
// Automation: a coop preset fills in a zone's thermostat, an incubator preset
// sets the temperature and humidity band the incubator's DHT22 is checked against.
// Starting points from standard brooding and incubation guides; tune them to
// your house and breed.

type Setpoints = Pick<ZoneControls, "high_temp" | "fan_off_temp" | "lamp_off_temp" | "low_temp">;

export interface CoopPreset {
  label: string;
  /** Shown under the label: what the birds need. */
  note: string;
  setpoints: Setpoints;
  /** Comfortable humidity, % RH. */
  humidity: [number, number];
}

export const COOP_PRESETS = {
  chicks_w1: {
    label: "Chicks · week 1",
    note: "Day-old to 7 days: 32-35 °C under the heat.",
    setpoints: { low_temp: 32, lamp_off_temp: 33, fan_off_temp: 34, high_temp: 35 },
    humidity: [60, 70],
  },
  chicks_w2: {
    label: "Chicks · week 2",
    note: "8-14 days: about 30 °C.",
    setpoints: { low_temp: 29, lamp_off_temp: 30, fan_off_temp: 31, high_temp: 32 },
    humidity: [60, 70],
  },
  chicks_w3: {
    label: "Chicks · weeks 3-4",
    note: "15-28 days: 26-28 °C, heat mostly off in the day.",
    setpoints: { low_temp: 25, lamp_off_temp: 26.5, fan_off_temp: 28, high_temp: 29 },
    humidity: [55, 70],
  },
  broilers: {
    label: "Broilers · grower/finisher",
    note: "From 4 weeks: 20-24 °C. Heat stress is the main risk.",
    setpoints: { low_temp: 18, lamp_off_temp: 20, fan_off_temp: 23, high_temp: 25 },
    humidity: [50, 70],
  },
  layers: {
    label: "Layers",
    note: "Laying hens: 18-24 °C. Lay drops above about 28 °C.",
    setpoints: { low_temp: 16, lamp_off_temp: 18, fan_off_temp: 24, high_temp: 26 },
    humidity: [50, 70],
  },
  cockerels: {
    label: "Cockerels",
    note: "Grown cockerels: 18-26 °C.",
    setpoints: { low_temp: 16, lamp_off_temp: 18, fan_off_temp: 25, high_temp: 27 },
    humidity: [50, 70],
  },
  guinea_keets: {
    label: "Guinea fowl keets",
    note: "First week 35 °C, then about 3 °C less each week.",
    setpoints: { low_temp: 32, lamp_off_temp: 33.5, fan_off_temp: 35, high_temp: 36 },
    humidity: [55, 70],
  },
  turkey_poults: {
    label: "Turkey poults",
    note: "First week 35-37 °C.",
    setpoints: { low_temp: 34, lamp_off_temp: 35, fan_off_temp: 36.5, high_temp: 37.5 },
    humidity: [55, 70],
  },
} as const satisfies Record<string, CoopPreset>;

export type CoopPresetId = keyof typeof COOP_PRESETS;
export const COOP_PRESET_IDS = Object.keys(COOP_PRESETS) as CoopPresetId[];

/** Temperature and humidity band for the incubator (checked against its DHT22). */
export interface IncubatorTargets {
  preset: IncubatorPresetId | "custom";
  temp_low: number;
  temp_high: number;
  rh_low: number;
  rh_high: number;
}

export const INCUBATOR_PRESETS = {
  chicken: { label: "Chicken eggs · days 1-18", temp: [37.3, 37.8], rh: [50, 55] },
  chicken_lockdown: { label: "Chicken eggs · lockdown 19-21", temp: [37.0, 37.5], rh: [65, 70] },
  guinea: { label: "Guinea fowl eggs · days 1-24", temp: [37.3, 37.8], rh: [50, 55] },
  duck: { label: "Duck eggs · days 1-25", temp: [37.3, 37.8], rh: [55, 60] },
  turkey: { label: "Turkey eggs · days 1-25", temp: [37.2, 37.7], rh: [55, 60] },
  quail: { label: "Quail eggs · days 1-14", temp: [37.4, 37.9], rh: [45, 50] },
} as const satisfies Record<
  string,
  { label: string; temp: [number, number]; rh: [number, number] }
>;

export type IncubatorPresetId = keyof typeof INCUBATOR_PRESETS;
export const INCUBATOR_PRESET_IDS = Object.keys(INCUBATOR_PRESETS) as IncubatorPresetId[];

export const incubatorTargets = (id: IncubatorPresetId): IncubatorTargets => {
  const p = INCUBATOR_PRESETS[id];
  return {
    preset: id,
    temp_low: p.temp[0],
    temp_high: p.temp[1],
    rh_low: p.rh[0],
    rh_high: p.rh[1],
  };
};

export const DEFAULT_INCUBATOR_TARGETS = incubatorTargets("chicken");

/** The bird a farmer said they keep at sign-up -> the incubator preset that suits it. */
export const incubatorPresetFor = (coop: CoopPresetId | null | undefined): IncubatorPresetId =>
  coop === "guinea_keets" ? "guinea" : coop === "turkey_poults" ? "turkey" : "chicken";

export type Reading = { temp: number | null; humidity: number | null; sensor_ok: boolean };

/** How a reading compares with the band: ok, low/high, or no reading. */
export function checkReading(r: Reading | null, t: IncubatorTargets) {
  if (!r || !r.sensor_ok || r.temp == null)
    return { status: "fault" as const, temp: null, rh: null };
  const temp = r.temp < t.temp_low ? "low" : r.temp > t.temp_high ? "high" : "ok";
  const rh =
    r.humidity == null
      ? null
      : r.humidity < t.rh_low
        ? "low"
        : r.humidity > t.rh_high
          ? "high"
          : "ok";
  // A degree out is dangerous for eggs; humidity is slower to matter.
  const far = r.temp < t.temp_low - 1 || r.temp > t.temp_high + 0.7;
  const status = far ? "crit" : temp !== "ok" || (rh && rh !== "ok") ? "warn" : "ok";
  return { status: status as "ok" | "warn" | "crit", temp, rh };
}
