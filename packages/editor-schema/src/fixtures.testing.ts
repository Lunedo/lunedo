import { readdirSync, readFileSync } from "node:fs";
import type { DocumentJson } from "./json.js";

const root = new URL("./fixtures/", import.meta.url);

export function fixtureVersions(): number[] {
  return readdirSync(root)
    .map((name) => /^v(\d+)$/.exec(name)?.[1])
    .filter((version): version is string => version !== undefined)
    .map(Number)
    .sort((left, right) => left - right);
}

export function loadFixtures(version: number): { name: string; document: DocumentJson }[] {
  const directory = new URL(`v${version}/`, root);
  return readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => ({
      name,
      document: JSON.parse(readFileSync(new URL(name, directory), "utf8")) as DocumentJson,
    }));
}
