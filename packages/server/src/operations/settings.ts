import { z } from "zod";
import { defineSetting } from "../settings/definition.js";

export const updateCheckSetting = defineSetting({
  key: "operations.updateCheck",
  schema: z.boolean(),
  default: true,
  levels: ["instance"],
  lockable: false,
});

export const operationsSettings = [updateCheckSetting];
