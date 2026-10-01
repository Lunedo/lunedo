import { randomBytes, randomUUID } from "node:crypto";
import { linkSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Secret } from "./secret.js";

/**
 * Returns the secret stored in `dir/name`, creating it with `generate` when it does not exist.
 * Several nodes may start at once: the file is written under a temporary name and linked into
 * place, so a reader never sees a partial file and exactly one generated value wins.
 */
export function ensureSecretFile(dir: string, name: string, generate: () => string): Secret {
  const target = path.join(dir, name);
  try {
    return new Secret(readFileSync(target, "utf8").trim());
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const temporary = path.join(dir, `.${name}.${randomUUID()}.tmp`);
  writeFileSync(temporary, `${generate()}\n`, { mode: 0o600, flag: "wx" });
  try {
    linkSync(temporary, target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  } finally {
    unlinkSync(temporary);
  }
  return new Secret(readFileSync(target, "utf8").trim());
}

export function generateKey(): string {
  return randomBytes(32).toString("base64");
}

export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}
