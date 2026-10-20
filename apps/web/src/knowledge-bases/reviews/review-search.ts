import { z } from "zod";

export const reviewSearch = z.object({
  filter: z.enum(["all", "due", "soon", "unowned"]).optional().catch(undefined),
  mine: z.boolean().optional().catch(undefined),
});
