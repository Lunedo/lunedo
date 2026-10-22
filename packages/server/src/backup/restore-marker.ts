import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { StartupError } from "../runtime/startup-error.js";

/** Exists in the file store from the start of a restore until the instance is consistent again. */
export const RESTORE_MARKER = ".lunedo-restore-incomplete";
/** Files of a restore are extracted here and moved into the file store after the database restore. */
export const RESTORE_STAGING = ".lunedo-restore-staging";

export const RESTORED_MARKER = "restored";

/** Entries of the file store that belong to a restore, not to the stored files. */
export const RESTORE_ENTRIES: ReadonlySet<string> = new Set([RESTORE_MARKER, RESTORE_STAGING]);

const markerSchema = z.object({ input: z.string(), startedAt: z.string() });

export class IncompleteRestoreError extends StartupError {
  override name = "IncompleteRestoreError";
}

export async function writeRestoreMarker(filesDir: string, input: string): Promise<void> {
  const marker = { input, startedAt: new Date().toISOString() };
  await writeFile(path.join(filesDir, RESTORE_MARKER), `${JSON.stringify(marker)}\n`, { mode: 0o600 });
}

export async function removeRestoreMarker(filesDir: string): Promise<void> {
  await rm(path.join(filesDir, RESTORE_MARKER), { force: true });
}

async function readRestoreMarker(filesDir: string): Promise<string | undefined> {
  try {
    return await readFile(path.join(filesDir, RESTORE_MARKER), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function writeRestoredMarker(workDir: string): Promise<void> {
  await mkdir(workDir, { recursive: true, mode: 0o700 });
  await writeFile(path.join(workDir, RESTORED_MARKER), `${new Date().toISOString()}\n`, { mode: 0o600 });
}

export async function hasRestoredMarker(workDir: string): Promise<boolean> {
  try {
    await stat(path.join(workDir, RESTORED_MARKER));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export async function removeRestoredMarker(workDir: string): Promise<void> {
  await rm(path.join(workDir, RESTORED_MARKER), { force: true });
}

export async function hasRestoreMarker(filesDir: string): Promise<boolean> {
  return (await readRestoreMarker(filesDir)) !== undefined;
}

/** Refuses to continue while a restore has not completed. */
export async function checkRestoreComplete(filesDir: string): Promise<void> {
  const marker = await readRestoreMarker(filesDir);
  if (marker === undefined) return;
  let parsed: z.infer<typeof markerSchema> | undefined;
  try {
    parsed = markerSchema.parse(JSON.parse(marker));
  } catch {
    parsed = undefined;
  }
  const what = parsed
    ? `The restore of the backup ${parsed.input}, started at ${parsed.startedAt},`
    : "A restore of a backup";
  const input = parsed?.input ?? "<backup file>";
  throw new IncompleteRestoreError(
    `${what} did not complete, so the database and the file store may not match. Run the restore again with: lunedo backup restore --input ${input} --force. Lunedo does not start until a restore completes and removes ${path.join(filesDir, RESTORE_MARKER)}.`,
  );
}
