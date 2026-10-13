export const MIGRATIONS_QUERY =
  "SELECT CASE WHEN to_regclass('drizzle.__drizzle_migrations') IS NULL THEN '' ELSE (SELECT coalesce(string_agg(created_at::text, ',' ORDER BY created_at), '') FROM drizzle.__drizzle_migrations) END;";

export function appliedMigrations(output: string): number[] {
  return output
    .trim()
    .split(",")
    .filter((value) => value !== "")
    .map(Number)
    .filter((value) => Number.isFinite(value));
}

export function journalMigrations(journal: string): number[] {
  const parsed = JSON.parse(journal) as { entries: { when: number }[] };
  return parsed.entries.map((entry) => entry.when);
}

export function unknownMigrations(applied: number[], known: number[]): number[] {
  const shipped = new Set(known);
  return applied.filter((when) => !shipped.has(when));
}

export function unknownMigrationsMessage(count: number): string {
  return [
    `The development database holds ${count} ${count === 1 ? "migration" : "migrations"} that this branch does not have, probably from another branch.`,
    "The app would stop while migrating. Reset the development database with:",
    "",
    "  pnpm dev:reset",
    "",
    "It deletes only the development database and its secrets, never anything else. Then start again with pnpm dev.",
  ].join("\n");
}
