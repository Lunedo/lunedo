import { type SQL, sql } from "drizzle-orm";
import { accountLanguage } from "../settings/sql.js";

export function spaceDisplayName(space: SQL): SQL {
  const owner = sql`(select a.name from accounts a where a.id = ${space}.personal_of)`;
  const german = sql`${accountLanguage(sql`${space}.personal_of`)} = 'de'`;
  return sql`(case when ${space}.name <> '' or ${space}.personal_of is null then ${space}.name
    when ${owner} is null then case when ${german} then 'Persönlicher Space' else 'Personal space' end
    else (case when ${german} then 'Persönlicher Space von ' else 'Personal space of ' end) || ${owner} end)`;
}
