import { z } from "zod";

// The coop's feeder conveyor belt (firmware/coop_unit): two motors, one at each end, on an
// H-bridge. It runs left or right for a set number of seconds, then stops by itself.
// Shared by the Automation page, the coop's poll endpoint and Ama's commands.

export const CONVEYOR_DIRS = ["left", "right", "stop"] as const;
export type ConveyorDir = (typeof CONVEYOR_DIRS)[number];

/** Longest single run; the firmware has the same limit. */
export const CONVEYOR_MAX_S = 120;
export const CONVEYOR_DEFAULT_S = 10;
export const CONVEYOR_RUN_OPTIONS = [5, 10, 20, 30, 60] as const;

export const conveyorCommandSchema = z.object({
  dir: z.enum(CONVEYOR_DIRS),
  seconds: z.number().int().min(1).max(CONVEYOR_MAX_S),
});
export type ConveyorCommand = z.infer<typeof conveyorCommandSchema> & { id: number };

/** What the coop reports: the way the belt is moving now and how long it has left. */
export interface ConveyorState {
  dir: ConveyorDir;
  remaining_s: number;
  cmd_id: number;
}

export function describeConveyor(dir: ConveyorDir, seconds: number) {
  return dir === "stop" ? "Feeder belt: stop" : `Feeder belt: ${dir} for ${seconds} s`;
}
