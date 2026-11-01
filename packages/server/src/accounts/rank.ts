import { sql } from "drizzle-orm";
import { builtInRoleAreas, coversAreas } from "../authorization/areas.js";
import type { AuthorizationService } from "../authorization/service.js";
import type { Executor, Transaction } from "../database/database.js";
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
  const actorInstanceAreas = await authorization.heldAreas(actor.id, "instance", null, tx);
  const actorIsInstanceOwner = instanceOwner === actor.id;
  const targetIsHomeOwner = target.home
    ? await authorization.isOrganizationOwner(target.id, target.home, tx)
    : false;
  const instanceAdministrator = actorInstanceAreas.accounts === "manage";
  if (instanceAdministrator && (!targetIsHomeOwner || actorIsInstanceOwner)) return;
  await checkRankInOrganizations(authorization, tx, actor, target, action);
}

export async function checkRankInOrganizations(
  authorization: AuthorizationService,
  executor: Executor,
  actor: Principal,
  target: { id: string; home: string | null },
  action: string,
): Promise<void> {
  const result = await executor.execute<{ organization_id: string }>(
    sql`select organization_id from memberships where account_id = ${target.id} order by organization_id`,
  );
  const elsewhere = result.rows.map((row) => row.organization_id).filter((id) => id !== target.home);
  if (target.home) {
    await authorization.checkRankOverAccount(actor, target.home, target.id, { executor, action });
  }
  for (const organizationId of elsewhere) {
    const areas = await authorization.heldAreas(target.id, "organization", organizationId, executor);
    if (coversAreas(builtInRoleAreas("organization", "member"), areas)) continue;
    await authorization.checkRankOverAccount(actor, organizationId, target.id, { executor, action });
  }
}
