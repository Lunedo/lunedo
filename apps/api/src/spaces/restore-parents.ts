import type { AccountServices, Principal, TrashEntry } from "@pagehall/server";
import { z } from "zod";

export const withParentsQuery = z
  .object({
    withParents: z
      .enum(["true", "false"])
      .optional()
      .describe(
        "`true` also restores the former parent pages from the trash when the content would otherwise lose a view restriction it inherited. It needs the right to restore each of them.",
      ),
  })
  .strict();

export const parentEntriesSchema = z
  .number()
  .int()
  .describe(
    "Number of trash entries of former parent pages restored with it, so it keeps the view restrictions it inherited.",
  );

export async function confidentialAdministrator(
  services: AccountServices,
  actor: Principal,
  spaceId: string,
): Promise<boolean> {
  const found = await services.spaces.get(spaceId);
  if (!found?.confidential) return false;
  return services.authorization.authorize(actor, "space.manage", { type: "space", id: spaceId });
}

export function restorableInSpace(services: AccountServices, actor: Principal, spaceId: string) {
  return async (entry: TrashEntry): Promise<boolean> =>
    entry.spaceId === spaceId &&
    entry.kind === "items" &&
    (await services.authorization.authorize(actor, "space.trash", { type: "space", id: spaceId })) &&
    (entry.stage === 1 || (await confidentialAdministrator(services, actor, spaceId))) &&
    (await services.trash.accessible(actor, entry.id));
}
