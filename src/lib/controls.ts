import { z } from "zod";

// Remote settings for the coop unit (firmware/coop_unit). Shared by the
// server functions, the ingest endpoint and the Controls page so all three
// agree on defaults and limits. The firmware validates the same rules.

export const COOP_ZONES = ["layers", "broilers"] as const;
export type CoopZone = (typeof COOP_ZONES)[number];

const zoneSchema = z
  .object({
    mode: z.enum(["auto", "manual"]),
    fan: z.boolean(),
    lamp: z.boolean(),
    high_temp: z.number().min(0).max(45),
    fan_off_temp: z.number().min(0).max(45),
    lamp_off_temp: z.number().min(0).max(45),
    low_temp: z.number().min(0).max(45),
  })
  .refine(
    (s) =>
      s.low_temp < s.lamp_off_temp &&
      s.lamp_off_temp <= s.fan_off_temp &&
      s.fan_off_temp < s.high_temp,
    { message: "Setpoints must go: lamp on below < lamp off at ≤ fan off at < fan on above" },
  )
  .refine((s) => !(s.fan && s.lamp), { message: "Fan and lamp can't both be on" });

export const coopControlsSchema = z.object({
  zones: z.object({ layers: zoneSchema, broilers: zoneSchema }),
  water: z
    .object({ bad_v: z.number().min(0.2).max(5), good_v: z.number().min(0.2).max(5) })
    .refine((w) => w.bad_v < w.good_v, {
      message: "Water 'dirty below' must be lower than 'clean above'",
    }),
});

export type CoopControls = z.infer<typeof coopControlsSchema>;
export type ZoneControls = CoopControls["zones"]["layers"];

// Same values as the original stand-alone sketch.
export const DEFAULT_COOP_CONTROLS: CoopControls = {
  zones: {
    layers: {
      mode: "auto",
      fan: false,
      lamp: false,
      high_temp: 24,
      fan_off_temp: 23,
      lamp_off_temp: 19,
      low_temp: 18,
    },
    broilers: {
      mode: "auto",
      fan: false,
      lamp: false,
      high_temp: 24,
      fan_off_temp: 23,
      lamp_off_temp: 19,
      low_temp: 18,
    },
  },
  water: { bad_v: 2.5, good_v: 2.7 },
};

/** What the coop reports for each zone with every check-in. */
export interface CoopZoneState {
  temp?: number;
  humidity?: number;
  sensor_ok: boolean;
  fan: boolean;
  lamp: boolean;
  mode: "auto" | "manual";
  safety_tripped?: boolean;
}
