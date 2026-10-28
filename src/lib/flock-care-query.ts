import { getFlockCare } from "@/lib/api/farm.functions";

/** Today's vaccination schedule step per house (FlockCareCard, Ama's starter questions). */
export const flockCareQuery = {
  queryKey: ["flock-care"],
  queryFn: () => getFlockCare(),
  refetchInterval: 5 * 60_000,
};
