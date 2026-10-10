import { z } from "zod";
import { defineSetting } from "../settings/definition.js";
import { atlassianHostsSetting } from "./atlassian.js";

export const maxUploadSetting = defineSetting({
  key: "imports.maxUploadMegabytes",
  schema: z.number().int().min(1).max(1_000_000),
  default: 2048,
  levels: ["instance"],
  lockable: false,
});

export const importFolderSetting = defineSetting({
  key: "imports.folderEnabled",
  schema: z.boolean(),
  default: true,
  levels: ["instance"],
  lockable: false,
});

export const importSettings = [maxUploadSetting, importFolderSetting, atlassianHostsSetting];
