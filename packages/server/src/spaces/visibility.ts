import { type SQL, sql } from "drizzle-orm";
import type { Principal } from "../accounts/principal.js";
import type { AuthorizationService } from "../authorization/service.js";

export function notTrashed(item: SQL): SQL {
  return sql`${item}.trash_entry_id is null`;
}

export function inTree(item: SQL): SQL {
  return sql`(${item}.trash_entry_id is null and ${item}.archived_root_id is null)`;
}

export function publishedFor(
  authorization: AuthorizationService,
  viewer: Principal,
  item: SQL,
  space: SQL,
): SQL {
  return sql`(${item}.kind <> 'page' or ${item}.mode = 'live' or ${item}.published_version_id is not null
    or ${authorization.spaceFilter(viewer, space, "editor")})`;
}

export function visibleItem(
  authorization: AuthorizationService,
  viewer: Principal,
  item: SQL,
  space: SQL,
): SQL {
  return sql`(${notTrashed(item)} and ${authorization.spaceFilter(viewer, space)}
    and ${publishedFor(authorization, viewer, item, space)})`;
}
