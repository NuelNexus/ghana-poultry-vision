// Marketplace constants shared by the server functions and the pages.

export const CATEGORIES = {
  eggs: "Eggs",
  broilers: "Broilers",
  layers: "Layers (hens)",
  cockerels: "Cockerels",
  chicks: "Day-old chicks",
  guinea_fowl: "Guinea fowl",
  turkey: "Turkey",
  manure: "Manure / fertilizer",
  feed: "Feed",
  equipment: "Equipment",
  other: "Other",
} as const;
export type Category = keyof typeof CATEGORIES;

export const UNITS = {
  crate: "crate",
  tray: "tray",
  dozen: "dozen",
  bird: "bird",
  kg: "kg",
  bag: "bag",
  piece: "piece",
  lot: "lot",
} as const;
export type SaleUnit = keyof typeof UNITS;

export const REGIONS = [
  "Ahafo",
  "Ashanti",
  "Bono",
  "Bono East",
  "Central",
  "Eastern",
  "Greater Accra",
  "North East",
  "Northern",
  "Oti",
  "Savannah",
  "Upper East",
  "Upper West",
  "Volta",
  "Western",
  "Western North",
] as const;

export const MAX_IMAGES = 4;
export const MAX_IMAGE_BYTES = 800_000;

/** "024 123 4567" -> "233241234567" for WhatsApp links. */
export function whatsappNumber(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("233")) return digits;
  if (digits.startsWith("0")) return "233" + digits.slice(1);
  return digits;
}

export function formatCedis(n: number) {
  return `GH₵ ${n.toLocaleString("en-GH", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
}
