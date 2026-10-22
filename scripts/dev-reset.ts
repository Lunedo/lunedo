const TEST_DATABASE =
  /^lunedo_(?:(?:[a-z]+_)*(?:test|e2e)_\d+(?:_[0-9a-f]+)?|template_[0-9a-f]{16}(?:_building)?)$/;

export const DEV_DATABASE = "lunedo";
export const CONFIRMATION = "reset";

export function testDatabases(names: string[]): string[] {
  return names.filter((name) => TEST_DATABASE.test(name)).sort();
}

function identifier(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

export function resetStatements(databases: string[]): string[] {
  return [
    ...testDatabases(databases).map((name) => `DROP DATABASE IF EXISTS ${identifier(name)} WITH (FORCE);`),
    `DROP DATABASE IF EXISTS ${identifier(DEV_DATABASE)} WITH (FORCE);`,
    `CREATE DATABASE ${identifier(DEV_DATABASE)};`,
  ];
}

export function isConfirmed(answer: string): boolean {
  return answer.trim().toLowerCase() === CONFIRMATION;
}
