// Medication and vaccination schedules for broilers and layers, from the
// Farmsquare charts. Day 1 is the day the chicks arrive. Shared by the browser
// (flock care card, Houses page) and the server (Ama's prompt, vaccine alerts).
//
// The charts say the schedule can differ by area, depending on which diseases
// are common there, so Ama always points farmers to their vet for changes.

export type FlockType = "broiler" | "layer";
export const FLOCK_TYPES: FlockType[] = ["broiler", "layer"];
export const FLOCK_LABEL: Record<FlockType, string> = { broiler: "Broilers", layer: "Layers" };

export type CareKind = "vaccine" | "medicine" | "vitamins" | "water" | "care";

export interface CareItem {
  /** First and last schedule day (Day 1 = arrival), inclusive. */
  from: number;
  to: number;
  task: string;
  /** How it is given, as the chart says. */
  how: string;
  kind: CareKind;
  /** Set for layer tasks the chart gives by week ("once during week 7"). */
  week?: number;
}

const ORAL = "by mouth, in drinking water";
const INJECTION = "injection into the muscle";
const INJECTION_OR_SKIN = "injection into the muscle or under the skin";

const d = (from: number, to: number, task: string, kind: CareKind, how = ORAL): CareItem => ({
  from,
  to,
  task,
  how,
  kind,
});
const wk = (week: number, task: string, kind: CareKind, how = ORAL): CareItem => ({
  from: (week - 1) * 7 + 1,
  to: week * 7,
  task,
  how,
  kind,
  week,
});

export const SCHEDULES: Record<FlockType, CareItem[]> = {
  broiler: [
    d(1, 1, "Glucose and multivitamin", "vitamins"),
    d(2, 5, "Antibiotics", "medicine"),
    d(6, 6, "Multivitamin", "vitamins"),
    d(7, 7, "Clean drinking water only", "water"),
    d(8, 8, "1st Gumboro vaccine", "vaccine"),
    d(9, 9, "Multivitamin", "vitamins"),
    d(10, 13, "Anticoccidial", "medicine"),
    d(14, 15, "Multivitamin", "vitamins"),
    d(16, 16, "1st Lasota (Newcastle) vaccine", "vaccine"),
    d(17, 19, "Multivitamin", "vitamins"),
    d(20, 21, "Clean drinking water only", "water"),
    d(22, 22, "2nd Gumboro vaccine", "vaccine"),
    d(23, 23, "Multivitamin", "vitamins"),
    d(24, 26, "2nd antibiotics", "medicine"),
    d(27, 27, "Multivitamin", "vitamins"),
    d(28, 28, "Clean drinking water only", "water"),
    d(29, 29, "2nd Lasota (Newcastle) vaccine", "vaccine"),
    d(30, 33, "Multivitamin", "vitamins"),
    d(34, 42, "Water and multivitamin", "vitamins"),
  ],
  layer: [
    d(1, 1, "Poultry glucose", "vitamins"),
    d(2, 5, "Antibiotics", "medicine"),
    d(6, 6, "Multivitamins", "vitamins"),
    d(7, 7, "1st Lasota (Newcastle) vaccine, booster dose", "vaccine"),
    d(8, 8, "Multivitamins", "vitamins"),
    d(9, 12, "Anticoccidial drug", "medicine"),
    d(13, 13, "Multivitamins", "vitamins"),
    d(14, 14, "1st Gumboro vaccine", "vaccine"),
    d(15, 15, "Multivitamins", "vitamins"),
    d(16, 19, "Antibiotics", "medicine"),
    d(20, 20, "Multivitamins", "vitamins"),
    d(21, 21, "2nd Lasota (Newcastle) vaccine", "vaccine"),
    d(23, 23, "Multivitamins", "vitamins"),
    d(24, 26, "Anticoccidial drug", "medicine"),
    d(27, 27, "Clean drinking water only", "water"),
    d(28, 28, "2nd Gumboro vaccine", "vaccine"),
    wk(5, "Anticoccidial with multivitamins", "medicine"),
    wk(6, "Clean water and multivitamins", "vitamins"),
    wk(7, "Fowl pox vaccine", "vaccine", INJECTION),
    wk(8, "Deworming", "medicine"),
    wk(9, "Infectious coryza vaccine", "vaccine", INJECTION_OR_SKIN),
    wk(10, "Debeaking", "care", "done by a trained person"),
    wk(
      14,
      "3-in-1 vaccine (Newcastle, infectious bronchitis, egg drop syndrome)",
      "vaccine",
      INJECTION_OR_SKIN,
    ),
    wk(16, "Deworming", "medicine"),
  ],
};

const DAY_MS = 86_400_000;

/** Days since 1970 for a calendar date, read as UTC (Ghana keeps GMT all year). */
const utcDay = (t: Date) =>
  Math.floor(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()) / DAY_MS);

/**
 * The flock's schedule day: Day 1 is the day the chicks were placed, the way
 * farmers count. `placedOn` is the house's "Chicks placed on" date (YYYY-MM-DD).
 */
export function flockDay(placedOn: string, now: Date = new Date()): number | null {
  const placed = new Date(`${placedOn.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(placed.getTime())) return null;
  return utcDay(now) - utcDay(placed) + 1;
}

/** Everything on the schedule for this day (normally one item, none on gap days). */
export function careOn(type: FlockType, day: number): CareItem[] {
  return SCHEDULES[type].filter((i) => day >= i.from && day <= i.to);
}

/** The next vaccine that starts after this day, and how many days away it is. */
export function nextVaccine(type: FlockType, day: number) {
  const item = SCHEDULES[type].find((i) => i.kind === "vaccine" && i.from > day);
  return item ? { item, inDays: item.from - day } : null;
}

/** Last day the schedule covers (42 for broilers, 112 for layers). */
export const scheduleEnd = (type: FlockType) => Math.max(...SCHEDULES[type].map((i) => i.to));

export interface FlockCare {
  houseId: string;
  house: string;
  flockType: FlockType | null;
  placedOn: string | null;
  /** Schedule day, Day 1 = arrival. Null when the placement date is missing. */
  day: number | null;
  today: CareItem[];
  /** A vaccine that falls on today (for week tasks: any day of that week). */
  vaccineToday: CareItem | null;
  next: { item: CareItem; inDays: number } | null;
  /** One plain-English line for the card, the alert and the "Hear it" button. */
  summary: string;
}

/** When the item is due, in words: "today", or "this week (week 7)". */
export const whenText = (i: CareItem) => (i.week ? `this week (week ${i.week})` : "today");

export function flockCare(
  h: { id: string; name: string; flock_type: string | null; batch_started_at: string | null },
  now: Date = new Date(),
): FlockCare {
  const flockType = FLOCK_TYPES.includes(h.flock_type as FlockType)
    ? (h.flock_type as FlockType)
    : null;
  const day = h.batch_started_at ? flockDay(h.batch_started_at, now) : null;
  const base = { houseId: h.id, house: h.name, flockType, placedOn: h.batch_started_at, day };
  if (!flockType || day == null || day < 1) {
    const summary = !h.batch_started_at
      ? `${h.name}: set the date the chicks were placed to get the vaccine schedule.`
      : day != null && day < 1
        ? `${h.name}: the chicks arrive in ${1 - day} day${day === 0 ? "" : "s"}.`
        : `${h.name}: choose broilers or layers to get the vaccine schedule.`;
    return { ...base, today: [], vaccineToday: null, next: null, summary };
  }
  const today = careOn(flockType, day);
  const vaccineToday = today.find((i) => i.kind === "vaccine") ?? null;
  const next = nextVaccine(flockType, day);
  const label = `${h.name}, day ${day} of ${FLOCK_LABEL[flockType].toLowerCase()}`;
  let summary: string;
  if (day > scheduleEnd(flockType)) {
    summary = `${label}: the schedule is finished. Ask your vet about boosters.`;
  } else if (vaccineToday) {
    summary = `${label}: ${vaccineToday.task} ${whenText(vaccineToday)}, ${vaccineToday.how}.`;
  } else {
    const doNow = today.length
      ? `${today.map((i) => i.task).join(" and ")} ${whenText(today[0])}`
      : "nothing on the schedule today";
    const then = next
      ? ` Next vaccine: ${next.item.task} in ${next.inDays} day${next.inDays === 1 ? "" : "s"}.`
      : "";
    summary = `${label}: ${doNow}.${then}`;
  }
  return { ...base, today, vaccineToday, next, summary };
}

/** Practical rules Ama follows when she talks about vaccines. */
export const VACCINE_TIPS = `- Water (oral) vaccines: no chlorine, sanitiser or disinfectant in that water, and no other
  medicine or vitamins mixed in. Clean, cool water; a little skimmed milk powder helps protect
  the vaccine. Take the water away for 1-2 hours first so the birds are thirsty, give it in the
  cool morning, and make sure there are enough drinkers for every bird to drink within about 2 hours.
- Keep vaccines cold (2-8 °C) and out of the sun until used. Mix just before giving. Don't use expired vials.
- Injected vaccines (fowl pox, coryza, 3-in-1) and debeaking: done by a vet or a trained person,
  with clean needles.
- Only vaccinate healthy birds. If many birds are sick, call the vet first.
- Schedules differ by area, depending on the diseases there: for changes, the farmer's vet decides.`;
