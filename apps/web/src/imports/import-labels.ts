import type { BadgeVariant } from "@pagehall/ui";
import type { TFunction } from "i18next";
import { translateKey } from "../i18n/translate.js";
import type { ImportState, ImportView } from "./imports-api.js";

const STATE_BADGES: Record<string, BadgeVariant> = {
  draft: "neutral",
  analyzing: "info",
  ready: "neutral",
  running: "info",
  held: "warning",
  stopping: "warning",
  review: "warning",
  accepting: "info",
  accepted: "success",
  discarding: "warning",
  discarded: "neutral",
  stopped: "neutral",
  failed: "danger",
};

export function stateBadge(state: ImportState): BadgeVariant {
  return STATE_BADGES[state] ?? "neutral";
}

export function stateLabel(t: TFunction, state: ImportState): string {
  return translateKey(t, `imports.states.${state}`, { defaultValue: state });
}

export function sourceLabel(t: TFunction, source: ImportView["source"]): string {
  return translateKey(t, `imports.sources.${source}.label`, { defaultValue: source });
}

export function importTitle(t: TFunction, entry: Pick<ImportView, "spaceName" | "found">): string {
  return entry.spaceName ?? entry.found?.spaceName ?? t("imports.untitled");
}

export function errorText(t: TFunction, code: string): { what: string; cause: string; action: string } {
  return {
    what: translateKey(t, `imports.errors.${code}.what`, { defaultValue: t("imports.errors.unknown.what") }),
    cause: translateKey(t, `imports.errors.${code}.cause`, {
      defaultValue: t("imports.errors.unknown.cause"),
    }),
    action: translateKey(t, `imports.errors.${code}.action`, {
      defaultValue: t("imports.errors.unknown.action"),
    }),
  };
}

export function isWizardState(state: ImportState): boolean {
  return state === "draft" || state === "analyzing" || state === "ready";
}
