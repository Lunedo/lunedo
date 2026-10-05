import { instanceUrlSetting } from "@pagehall/server";
import type { ApiContext } from "../context.js";

export async function instanceUrlOf(
  context: Pick<ApiContext, "settings" | "configuredInstanceUrl">,
): Promise<string> {
  const stored = context.settings ? await context.settings.get(instanceUrlSetting, {}) : "";
  return (stored || context.configuredInstanceUrl || "").replace(/\/+$/, "");
}
