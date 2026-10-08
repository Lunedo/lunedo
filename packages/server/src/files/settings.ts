import { z } from "zod";
import { defineSetting, type Limit, UNLIMITED } from "../settings/definition.js";

export const MEGABYTE = 1024 * 1024;

export const maxFileSizeSetting = defineSetting({
  key: "files.maxFileSizeMegabytes",
  schema: z.number().int().min(1).max(100_000),
  default: 100,
  levels: ["instance", "organization"],
  lockable: true,
  stricterOnly: "lower",
});

const versionLimit = z.union([z.number().int().min(1).max(1_000_000), z.literal(UNLIMITED)]);

export const keepVersionsMaximumSetting = defineSetting<Limit>({
  key: "files.keepVersionsMaximum",
  schema: versionLimit,
  default: 500,
  levels: ["instance"],
  lockable: false,
});

export const keepVersionsSetting = defineSetting<Limit>({
  key: "files.keepVersions",
  schema: versionLimit,
  default: 50,
  levels: ["instance", "organization", "space"],
  lockable: true,
  maximum: keepVersionsMaximumSetting,
});

export const fileSettings = [maxFileSizeSetting, keepVersionsMaximumSetting, keepVersionsSetting];
