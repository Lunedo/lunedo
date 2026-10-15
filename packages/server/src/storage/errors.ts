export type StorageRefusal = "upload" | "largeWrite";

export const UPLOAD_REFUSED = "Storage is almost full. Your instance administrator has been informed.";
export const LARGE_WRITE_REFUSED =
  "Storage is almost full, so new exports and imports are paused. Your instance administrator has been informed.";

export class StorageFullError extends Error {
  override name = "StorageFullError";

  constructor(
    readonly refusal: StorageRefusal,
    message: string = refusal === "upload" ? UPLOAD_REFUSED : LARGE_WRITE_REFUSED,
  ) {
    super(message);
  }
}

export type StorageSettingsErrorCode =
  | "invalidThresholds"
  | "invalidS3Limit"
  | "invalidContacts"
  | "invalidTeamsWebhook";

export class StorageSettingsError extends Error {
  override name = "StorageSettingsError";

  constructor(
    readonly code: StorageSettingsErrorCode,
    message: string,
    readonly fields: readonly string[] = [],
  ) {
    super(message);
  }
}
