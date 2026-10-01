import { isDeepStrictEqual } from "node:util";
import { type AuditChangeKind, auditCatalog } from "./catalog.js";
import type { AuditLabels } from "./labels.js";

export interface AuditChange {
  property: string;
  old: unknown;
  new: unknown;
}

export interface AuditPresentation {
  labelKey: string;
  changeKind: AuditChangeKind;
  actor: { type: string; id: string | null; name: string | null };
  target: { type: string; id: string | null; name: string | null };
  scope: { type: "instance" | "organization"; id: string | null; name: string | null };
  changes: AuditChange[];
  references: Record<string, string>;
}

export interface PresentableAuditEntry {
  scopeType: "instance" | "organization";
  scopeId: string;
  name: string;
  actorType: string;
  actorId: string | null;
  targetType: string;
  targetId: string | null;
  fields: unknown;
  labels: unknown;
}

const HIDDEN_FIELDS = new Set(["sessionId", "credentialId", "scopeId", "previous", "level", "action"]);

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function pairedName(key: string, prefix: string): string | null {
  if (!key.startsWith(prefix) || key.length === prefix.length) return null;
  const rest = key.slice(prefix.length);
  return rest.charAt(0) === rest.charAt(0).toUpperCase()
    ? rest.charAt(0).toLowerCase() + rest.slice(1)
    : null;
}

function settingChanges(fields: Record<string, unknown>): AuditChange[] {
  switch (fields.action) {
    case "set":
      return [{ property: "value", old: fields.previousValue ?? null, new: fields.value ?? null }];
    case "clear":
      return [{ property: "value", old: fields.previousValue ?? null, new: null }];
    case "lock":
      return [{ property: "locked", old: fields.previousLocked ?? false, new: true }];
    case "unlock":
      return [{ property: "locked", old: fields.previousLocked ?? true, new: false }];
    default:
      return [];
  }
}

function fieldChanges(fields: Record<string, unknown>): AuditChange[] {
  const previous = (fields.previous ?? {}) as Record<string, unknown>;
  const changes: AuditChange[] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (HIDDEN_FIELDS.has(key) || pairedName(key, "previous")) continue;
    const property = pairedName(key, "new") ?? key;
    const priorKey = `previous${capitalize(property)}`;
    const hasPrior = Object.hasOwn(previous, property) || Object.hasOwn(fields, priorKey);
    const old = Object.hasOwn(previous, property) ? previous[property] : (fields[priorKey] ?? null);
    if (hasPrior && isDeepStrictEqual(old, value)) continue;
    changes.push({ property, old: hasPrior ? old : null, new: value });
  }
  return changes;
}

export function presentAuditEntry(entry: PresentableAuditEntry): AuditPresentation {
  const definition = (auditCatalog as Record<string, { change?: AuditChangeKind }>)[entry.name];
  const changeKind = definition?.change ?? "fields";
  const labels = (entry.labels ?? {}) as AuditLabels;
  const fields =
    entry.fields !== null && typeof entry.fields === "object"
      ? (entry.fields as Record<string, unknown>)
      : {};
  return {
    labelKey: `audit.events.${entry.name}`,
    changeKind,
    actor: { type: entry.actorType, id: entry.actorId, name: labels.actor ?? null },
    target: { type: entry.targetType, id: entry.targetId, name: labels.target ?? null },
    scope: {
      type: entry.scopeType,
      id: entry.scopeType === "instance" ? null : entry.scopeId,
      name: labels.scope ?? null,
    },
    changes: changeKind === "setting" ? settingChanges(fields) : fieldChanges(fields),
    references: labels.references ?? {},
  };
}
