import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export const E2E_PORT = Number(process.env.LUNEDO_E2E_PORT ?? 4310);
export const BASE_URL = `http://localhost:${E2E_PORT}`;
export const DATABASE_BASE_URL =
  process.env.LUNEDO_E2E_DATABASE_URL ?? "postgres://lunedo:lunedo@localhost:5432/lunedo";
export const MAILPIT_URL = process.env.LUNEDO_E2E_MAILPIT_URL ?? "http://localhost:8025";
export const SMTP_HOST = process.env.LUNEDO_E2E_SMTP_HOST ?? "localhost";
export const SMTP_PORT = Number(process.env.LUNEDO_E2E_SMTP_PORT ?? 1025);

export const STATE_DIR = process.env.LUNEDO_E2E_STATE_DIR ?? path.join(tmpdir(), "lunedo-e2e-state");

export interface E2EState {
  setupCode?: string;
  databaseUrl?: string;
  ownerSecret?: string;
  totpSteps?: Record<string, number>;
}

export const OWNER = {
  name: "Olivia Owner",
  email: "owner@lunedo.test",
  password: "a long owner passphrase 2026",
};

export const ORGANIZATION_NAME = "Platform Team";

const stateFile = () => path.join(STATE_DIR, "state.json");

export function readState(): E2EState {
  try {
    return JSON.parse(readFileSync(stateFile(), "utf8")) as E2EState;
  } catch {
    return {};
  }
}

export function writeState(patch: Partial<E2EState>): E2EState {
  mkdirSync(STATE_DIR, { recursive: true });
  const next = { ...readState(), ...patch };
  writeFileSync(stateFile(), JSON.stringify(next, null, 2));
  return next;
}

export const OWNER_STORAGE = path.join(STATE_DIR, "owner.json");
export const SETUP_STORAGE = path.join(STATE_DIR, "setup.json");
