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
