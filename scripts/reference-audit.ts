import { code, defineReference, table } from "./docs-reference.ts";
import { message } from "./reference-settings.ts";

export interface AuditEventEntry {
  readonly name: string;
  readonly target: string;
  readonly actors: readonly string[];
  readonly level: string;
  readonly fields: readonly string[];
}

export interface AuditSource {
  readonly events: readonly AuditEventEntry[];
  readonly messages: unknown;
}

const CATALOG = "packages/server/src/audit/catalog.ts";
const MESSAGES = "apps/web/src/i18n/locales/en.json";

export function areaOf(name: string): string {
  return name.split(".")[0] ?? name;
}

export function eventLabel(source: AuditSource, name: string): string {
  return message(source.messages, `audit.events.${name}`) ?? "";
}

function recorded(event: AuditEventEntry): string {
  return event.fields.length === 0 ? "no further fields" : event.fields.map(code).join(", ");
}

export function renderAuditEvents(source: AuditSource): string {
  const events = [...source.events].sort((a, b) => a.name.localeCompare(b.name));
  const areas = [...new Set(events.map((event) => areaOf(event.name)))];
  const sections = areas.map((area) => {
    const rows = events
      .filter((event) => areaOf(event.name) === area)
      .map((event) => [
        code(event.name),
        eventLabel(source, event.name),
        code(event.target),
        event.actors.map(code).join(", "),
        event.level,
        recorded(event),
      ]);
    return `## ${area}\n\n${table(["Event", "What it records", "Target", "Actor", "Level", "Fields"], rows)}`;
  });
  return [
    "Every event the [audit log](audit-log.md) records, grouped by the area at the start of its name. **What it records** is the name the audit log shows for the event. **Target** is the kind of object the event is about, **Actor** the kinds of actors that cause it. **Level** is the level the catalog assigns the event to, instance or organization. **Fields** are the details stored with the event besides who acted, the target, the time, the request and the client.",
    ...sections,
  ].join("\n\n");
}

export const auditEvents = defineReference<AuditSource>({
  page: "admin/audit-events.md",
  title: "Audit events",
  sources: [CATALOG, MESSAGES],
  entry: `
import { auditCatalog } from "./${CATALOG}";
import messages from "./${MESSAGES}";

export default {
  events: Object.entries(auditCatalog).map(([name, event]) => ({
    name,
    target: event.target,
    actors: event.actor,
    level: event.visibility,
    fields: Object.keys(event.fields.shape),
  })),
  messages,
};
`,
  render: renderAuditEvents,
});
