import { z } from "zod";
import { defineSetting } from "../settings/definition.js";

export const MEGABYTE = 1024 * 1024;

export const maxFileSizeSetting = defineSetting({
  key: "files.maxFileSizeMegabytes",
  schema: z.number().int().min(1).max(100_000),
  default: 100,
  levels: ["instance", "organization"],
  lockable: true,
  stricterOnly: "lower",
});

export const keepVersionsSetting = defineSetting<number | null>({
  key: "files.keepVersions",
  schema: z.number().int().min(1).max(1000).nullable(),
  default: null,
  levels: ["instance", "organization", "space"],
  lockable: true,
});

export const fileSettings = [maxFileSizeSetting, keepVersionsSetting];
