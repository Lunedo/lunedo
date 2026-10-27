import type { AuthorizationService } from "../authorization/service.js";
import type { Transaction } from "../database/database.js";
import type { Principal } from "./principal.js";
import { instance } from "./schema.js";

export async function checkRankOverAccount(
  authorization: AuthorizationService,
  tx: Transaction,
  actor: Principal,
  target: { id: string; home: string | null },
  action: string,
): Promise<void> {
  if (actor.type !== "account") return;
  await authorization.checkOwnersOverAccount(actor, target.id, { executor: tx, action });
  const [row] = await tx.select({ owner: instance.ownerAccountId }).from(instance);
  const instanceOwner = row?.owner ?? null;
  const targetInstanceAreas = await authorization.heldAreas(target.id, "instance", null, tx);
  const targetIsInstanceOwner = instanceOwner === target.id;
  if (targetIsInstanceOwner || Object.keys(targetInstanceAreas).length > 0) {
    await authorization.checkRank(
      actor,
      {
        scope: "instance",
        organizationId: null,
        areas: targetInstanceAreas,
        owner: targetIsInstanceOwner,
        action,
      },
      { executor: tx },
    );
  }
  if (!target.home) return;
  const actorInstanceAreas = await authorization.heldAreas(actor.id, "instance", null, tx);
  const actorIsInstanceOwner = instanceOwner === actor.id;
  const targetIsHomeOwner = await authorization.isOrganizationOwner(target.id, target.home, tx);
  const instanceAdministrator = actorInstanceAreas.accounts === "manage";
  if (instanceAdministrator && (!targetIsHomeOwner || actorIsInstanceOwner)) return;
  await authorization.checkRankOverAccount(actor, target.home, target.id, { executor: tx, action });
}
