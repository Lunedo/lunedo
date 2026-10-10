export class ImportError extends Error {
  override name = "ImportError";

  constructor(
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export class ImportFormatError extends ImportError {
  override name = "ImportFormatError";
}

export class ImportStoppedError extends Error {
  override name = "ImportStoppedError";

  constructor() {
    super("The import was stopped.");
  }
}

export class ImportHeldError extends Error {
  override name = "ImportHeldError";

  constructor() {
    super("The importing administrator can no longer import into this organization.");
  }
}

export class ImportYieldError extends Error {
  override name = "ImportYieldError";

  constructor() {
    super("The import continues in a new run.");
  }
}
