import { z } from "zod";

export const statisticsSearch = z.object({
  period: z.enum(["7d", "30d", "90d", "12m"]).optional().catch(undefined),
});
