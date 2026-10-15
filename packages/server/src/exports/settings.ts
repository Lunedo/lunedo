import { z } from "zod";
import { defineSetting } from "../settings/definition.js";

export const exportMaxSizeSetting = defineSetting({
  key: "exports.maxSizeMegabytes",
  schema: z.number().int().min(1).max(1_000_000),
  default: 5 * 1024,
  levels: ["instance"],
  lockable: false,
});

export const exportStorageSetting = defineSetting({
  key: "exports.storageMegabytes",
  schema: z.number().int().min(1).max(100_000_000),
  default: 50 * 1024,
  levels: ["instance"],
  lockable: false,
});

export const exportSettings = [exportMaxSizeSetting, exportStorageSetting];
