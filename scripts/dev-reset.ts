const TEST_DATABASE = /^pagehall_(?:[a-z]+_)*(?:test|e2e)_\d+(?:_[0-9a-f]+)?$/;

export const DEV_DATABASE = "pagehall";
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
