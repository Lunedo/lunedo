import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { STATE_DIR } from "./environment.js";
import type { Person } from "./people.js";

export const PEOPLE = {
  lena: "Lena Hofer",
  jonas: "Jonas Berger",
  aylin: "Aylin Demir",
  mateo: "Mateo Rossi",
  sophie: "Sophie Wagner",
} as const;

export type PersonKey = keyof typeof PEOPLE;

export interface PlacedPage {
  id: string;
  number: number;
  path: string;
}

export interface ScreenWorld {
  organizationId: string;
  people: Record<PersonKey, Person>;
  it: { id: string; key: string; overviewPath: string };
  rich: PlacedPage;
  whiteboard: PlacedPage;
  templateName: string;
  seriesPath: string;
  general: { key: string; homePath: string };
  empty: { key: string };
  personal: { key: string; salary: PlacedPage };
  knowledgeBase: {
    id: string;
    key: string;
    portal: string;
    categoryAddress: string;
    article: PlacedPage & { address: string };
    englishAddress: string;
  };
}

const worldFile = () => path.join(STATE_DIR, "screens-world.json");

export function personState(key: PersonKey): string {
  return path.join(STATE_DIR, `screens-${key}.json`);
}

export function writeWorld(world: ScreenWorld): void {
  writeFileSync(worldFile(), JSON.stringify(world, null, 2));
}

export function readWorld(): ScreenWorld {
  return JSON.parse(readFileSync(worldFile(), "utf8")) as ScreenWorld;
}
