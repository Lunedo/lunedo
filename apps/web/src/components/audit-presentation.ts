import { isUuid } from "@pagehall/shared";
import type { TFunction } from "i18next";
import type { paths } from "../api/generated/schema.js";
import type { Formatter } from "../format/format.js";
import { translateKey } from "../i18n/translate.js";
import { settingLabelKey } from "../settings/setting-fields.js";

export function settingLabel(t: TFunction, key: string): string {
  if (key.startsWith("notifications.") && key !== "notifications.retentionDays")
    return t("audit.notificationSetting", {
      event: translateKey(t, `notifications.events.${key.slice("notifications.".length)}`),
    });
  return translateKey(t, settingLabelKey(key));
}

export type AuditItem =
  paths["/api/v1/instance/audit-events"]["get"]["responses"][200]["content"]["application/json"]["items"][number];

export type AuditChange = AuditItem["changes"][number];

export interface AuditContext {
  t: TFunction;
  format: Formatter;
  formatSetting: (key: string, value: unknown) => string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

function has(t: TFunction, key: string): boolean {
  return t(key as never, { defaultValue: "" }) !== "";
}

export function actionLabel(t: TFunction, item: AuditItem): string {
  return translateKey(t, item.labelKey);
}

export function formerUser(t: TFunction, id: string): string {
  return t("audit.formerUser", { id: id.slice(0, 8) });
}

export function actorLabel(t: TFunction, item: AuditItem): string {
  if (item.actor.name) return item.actor.name;
  if (item.actor.former && item.actor.id) return formerUser(t, item.actor.id);
  if (item.actor.type === "account") return t("audit.deletedAccount");
  return translateKey(t, `audit.actorTypes.${item.actor.type}`);
}

export function scopeLabel(t: TFunction, item: AuditItem): string {
  if (item.scope.type === "instance") return t("audit.instanceScope");
  if (item.scope.type === "account") {
    if (item.scope.name) return item.scope.name;
    return item.scope.id && item.formerAccounts.includes(item.scope.id)
      ? formerUser(t, item.scope.id)
      : t("audit.deletedAccount");
  }
  return item.scope.name ?? t("audit.deletedOrganization");
}

export function targetTypeLabel(t: TFunction, type: string): string {
  const key = `audit.targets.${type}`;
  return has(t, key) ? translateKey(t, key) : type;
}

export function targetLabel(t: TFunction, item: AuditItem): string {
  if (item.changeKind === "setting" && item.target.id) return settingLabel(t, item.target.id);
  if (item.target.name) return item.target.name;
  if (item.target.former && item.target.id) return formerUser(t, item.target.id);
  return targetTypeLabel(t, item.target.type);
}

export function propertyLabel(t: TFunction, item: AuditItem, property: string): string {
  if (item.changeKind === "setting") {
    return property === "locked" ? t("audit.properties.locked") : t("audit.properties.value");
  }
  const name = item.name.startsWith("mail.") && property === "method" ? "mailMethod" : property;
  const key = `audit.properties.${name}`;
  return has(t, key) ? translateKey(t, key) : property;
}

export function formatAuditValue(
  context: AuditContext,
  item: AuditItem,
  property: string,
  value: unknown,
): string {
  const { t, format } = context;
  if (value === null || value === undefined || value === "") return t("settings.notSet");
  if (item.changeKind === "setting") {
    if (property === "locked") return value === true ? t("audit.locked") : t("audit.unlocked");
    return context.formatSetting(item.target.id ?? "", value);
  }
  if (typeof value === "boolean") return value ? t("common.yes") : t("common.no");
  if (typeof value === "number") return format.number(value);
  if (Array.isArray(value)) {
    return value.length === 0
      ? t("audit.emptyList")
      : value.map((entry) => formatAuditValue(context, item, property, entry)).join(", ");
  }
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, entry]) => `${key}: ${formatAuditValue(context, item, key, entry)}`)
      .join(", ");
  }
  const text = String(value);
  if (isUuid(text)) {
    const id = text.toLowerCase();
    if (item.formerAccounts.includes(id)) return formerUser(t, id);
    return item.references[id] ?? item.references[text] ?? t("audit.unknownReference");
  }
  if (ISO_DATE.test(text)) return format.dateTime(text);
  const valueKey = `audit.values.${text}`;
  return has(t, valueKey) ? translateKey(t, valueKey) : text;
}

export function changeText(context: AuditContext, item: AuditItem, change: AuditChange): string {
  const next = formatAuditValue(context, item, change.property, change.new);
  const hasOld = change.old !== null && change.old !== undefined;
  const value = hasOld ? `${formatAuditValue(context, item, change.property, change.old)} → ${next}` : next;
  return item.changeKind === "setting" && change.property === "value"
    ? value
    : `${propertyLabel(context.t, item, change.property)}: ${value}`;
}

export function changeSummary(context: AuditContext, item: AuditItem, limit = 2): string {
  const shown = item.changes.slice(0, limit).map((change) => changeText(context, item, change));
  const rest = item.changes.length - shown.length;
  return rest > 0
    ? `${shown.join("; ")}; ${context.t("audit.moreChanges", { count: rest })}`
    : shown.join("; ");
}
