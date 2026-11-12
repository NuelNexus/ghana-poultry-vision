import { z } from "zod";

// The incubator relay board (firmware/relay_board): an ESP32 with four relays.
// Shared by the check-in endpoint, the server functions and the Automation page.

export const RELAYS = ["incubator", "fan", "light", "strip"] as const;
export type RelayName = (typeof RELAYS)[number];
export type RelayState = Record<RelayName, boolean>;

export const RELAY_INFO: Record<RelayName, { label: string; part: string; pin: number }> = {
  incubator: { label: "Incubator controller", part: "Heater and egg turner", pin: 22 },
  fan: { label: "Fan", part: "Air circulation", pin: 23 },
  light: { label: "Lamp", part: "Lamp in the incubator", pin: 21 },
  strip: { label: "Strip lights", part: "LED strip in the brooding area", pin: 19 },
};

// The board's own default at power-up: everything on.
export const DEFAULT_RELAYS: RelayState = { incubator: true, fan: true, light: true, strip: true };

export const relayStateSchema = z.object({
  incubator: z.boolean(),
  fan: z.boolean(),
  light: z.boolean(),
  strip: z.boolean(),
});

/** Fill in missing relays from the defaults (old rows, partial reports). */
export const relayState = (v: unknown): RelayState => ({
  ...DEFAULT_RELAYS,
  ...(relayStateSchema.partial().safeParse(v).data ?? {}),
});
