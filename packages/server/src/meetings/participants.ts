import { type SQL, sql } from "drizzle-orm";
import { spaceRoleConditionFor } from "../authorization/space-access.js";

export function seriesParticipant(series: SQL, account: SQL): SQL {
  return sql`((exists (select 1 from meeting_series_members pm
        where pm.series_id = ${series} and pm.account_id = ${account})
      or exists (select 1 from meeting_attendees pa join meetings pmt on pmt.item_id = pa.meeting_id
        where pmt.series_id = ${series} and pa.account_id = ${account}))
    and exists (select 1 from tree_items pt join spaces ps on ps.id = pt.space_id
      where pt.id = ${series} and ${spaceRoleConditionFor(account, sql`ps`, "reader")}))`;
}
