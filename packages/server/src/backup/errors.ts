import { BackupError } from "./archive.js";
import { MissingTargetSecretError } from "./configuration.js";
import { BackupTargetError } from "./targets.js";

const REASON_LIMIT = 600;

export type BackupSettingsErrorCode =
  | "invalidTime"
  | "invalidDay"
  | "invalidCount"
  | "invalidScope"
  | "invalidPath"
  | "reservedPath"
  | "invalidEndpoint"
  | "invalidRegion"
  | "invalidBucket"
  | "invalidPrefix"
  | "invalidAccessKey"
  | "secretKeyRequired"
  | "noTarget";

export class BackupSettingsError extends Error {
  override name = "BackupSettingsError";

  constructor(
    readonly code: BackupSettingsErrorCode,
    message: string,
    readonly fields: readonly string[] = [],
  ) {
    super(message);
  }
}

export class BackupBusyError extends Error {
  override name = "BackupBusyError";

  constructor(readonly what: "backup" | "testRestore") {
    super(
      what === "backup"
        ? "A backup is already running. Wait until it has finished; the list shows it when it is done."
        : "A test restore is already running. Wait until it has finished and start the next one then.",
    );
  }
}

export class BackupNotFoundError extends Error {
  override name = "BackupNotFoundError";

  constructor(name: string) {
    super(`The backup ${name} is not in the backup target. It may have been deleted; reload the list.`);
  }
}

export function describeFailure(error: unknown): string {
  if (
    error instanceof BackupTargetError ||
    error instanceof BackupError ||
    error instanceof MissingTargetSecretError ||
    error instanceof BackupSettingsError
  ) {
    return error.message;
  }
  const code = (error as NodeJS.ErrnoException).code;
  if (code === "ENOSPC" || code === "EDQUOT")
    return "The backup target is full. Free up space or choose another target.";
  const text = error instanceof Error ? error.message : String(error);
  return `The backup failed: ${text}`.slice(0, REASON_LIMIT);
}
