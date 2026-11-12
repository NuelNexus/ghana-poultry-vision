import { useCallback, useEffect, useState } from "react";
import {
  COOP_ZONES,
  DEFAULT_COOP_CONTROLS,
  type CoopControls,
  type CoopZone,
  type CoopZoneState,
  type ZoneControls,
} from "./controls";

// A simulated coop for the Automation page's demo mode, so the controls can be
// shown with no ESP32 connected (or the site's database unreachable). It follows
// the same rules as firmware/coop_unit: the auto thermostat with its four setpoints,
// fan and lamp never on together, and the lamp cut-out when a zone overheats.
// Nothing here talks to the server.

export interface SimCoop {
  controls: CoopControls;
  zones: Record<CoopZone, CoopZoneState & { temp: number; humidity: number }>;
  water: { v: number; ok: boolean | null };
}

const SAFETY_C = 35;
const TICK_MS = 1_000;
// One simulated "day" of outside temperature, so both the fan and the lamp get a turn.
const DAY_S = 150;

function initial(): SimCoop {
  const zone = (temp: number, humidity: number) => ({
    temp,
    humidity,
    sensor_ok: true,
    fan: false,
    lamp: false,
    mode: "auto" as const,
    safety_tripped: false,
  });
  return {
    controls: structuredClone(DEFAULT_COOP_CONTROLS),
    zones: { layers: zone(20.4, 64), broilers: zone(22.6, 58) },
    water: { v: 3.1, ok: true },
  };
}

const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

function step(s: SimCoop, t: number): SimCoop {
  const zones = { ...s.zones };
  for (const z of COOP_ZONES) {
    const c = s.controls.zones[z];
    const cur = zones[z];
    const ambient = 21 + 6 * Math.sin((2 * Math.PI * t) / DAY_S + (z === "broilers" ? 0.9 : 0));
    let { fan, lamp } = cur;
    if (c.mode === "manual") {
      fan = c.fan;
      lamp = c.lamp;
    } else {
      if (cur.temp >= c.high_temp) fan = true;
      else if (cur.temp <= c.fan_off_temp) fan = false;
      if (cur.temp <= c.low_temp) lamp = true;
      else if (cur.temp >= c.lamp_off_temp) lamp = false;
      if (fan && lamp) lamp = false;
    }
    // The lamp cut-out works in both modes, like the firmware's.
    const tripped = cur.temp >= SAFETY_C || (cur.safety_tripped && cur.temp > SAFETY_C - 2);
    if (tripped) lamp = false;
    const temp =
      cur.temp +
      (ambient - cur.temp) * 0.05 +
      (lamp ? 0.45 : 0) -
      (fan ? 0.42 : 0) +
      (Math.random() - 0.5) * 0.08;
    const humidity = 62 + 8 * Math.cos((2 * Math.PI * t) / DAY_S) - (fan ? 6 : 0) - (lamp ? 4 : 0);
    zones[z] = {
      ...cur,
      mode: c.mode,
      fan,
      lamp,
      safety_tripped: tripped,
      temp: round(Math.min(45, Math.max(5, temp)), 2),
      humidity: Math.round(cur.humidity + (humidity - cur.humidity) * 0.15),
    };
  }
  // The water slowly gets dirty; the readout flips with the same hysteresis as the coop.
  const v = Math.max(1.6, s.water.v - 0.006 - Math.random() * 0.004);
  const { bad_v, good_v } = s.controls.water;
  const ok = v < bad_v ? false : v > good_v ? true : s.water.ok;
  return { ...s, zones, water: { v: round(v, 2), ok } };
}

export function useCoopSim() {
  const [sim, setSim] = useState<SimCoop>(initial);

  useEffect(() => {
    let t = 0;
    const id = window.setInterval(() => {
      if (document.hidden) return;
      t += TICK_MS / 1000;
      setSim((s) => step(s, t));
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  const setZone = useCallback((zone: CoopZone, patch: Partial<ZoneControls>) => {
    setSim((s) => {
      const next = { ...s.controls.zones[zone], ...patch };
      // Show a manual switch at once instead of on the next tick.
      const live =
        next.mode === "manual"
          ? {
              ...s.zones[zone],
              mode: next.mode,
              fan: next.fan,
              lamp: s.zones[zone].safety_tripped ? false : next.lamp,
            }
          : { ...s.zones[zone], mode: next.mode };
      return {
        ...s,
        controls: { ...s.controls, zones: { ...s.controls.zones, [zone]: next } },
        zones: { ...s.zones, [zone]: live },
      };
    });
  }, []);

  const setWater = useCallback((patch: Partial<CoopControls["water"]>) => {
    setSim((s) => ({
      ...s,
      controls: { ...s.controls, water: { ...s.controls.water, ...patch } },
    }));
  }, []);

  const changeWater = useCallback(() => {
    setSim((s) => ({ ...s, water: { v: 3.3, ok: true } }));
  }, []);

  const reset = useCallback(() => setSim(initial()), []);

  return { sim, setZone, setWater, changeWater, reset };
}
