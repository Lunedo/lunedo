import { type SQL, sql } from "drizzle-orm";

export function settingValue(level: string, scope: SQL | null, key: string): SQL {
  return sql`(select v.value #>> '{}' from setting_values v
    where v.level = ${level} and v.key = ${key} and v.value is not null ${scope ? sql`and v.scope_id = ${scope}` : sql``}
    limit 1)`;
}

export function organizationLanguage(organization: SQL): SQL {
  const instance = settingValue("instance", null, "locale.language");
  return sql`(case when exists (select 1 from setting_values v
      where v.level = 'instance' and v.key = 'locale.language' and v.locked)
    then coalesce(${instance}, 'en')
    else coalesce(${settingValue("organization", organization, "locale.language")}, ${instance}, 'en') end)`;
}
