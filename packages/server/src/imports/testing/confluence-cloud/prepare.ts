import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { gzipSync, inflateRawSync } from "node:zlib";

export interface Actor {
  readonly role: string;
  readonly accountId: string;
  readonly displayName: string;
  readonly email: string;
}

export interface Anonymizer {
  text(value: string): string;
  readonly residues: readonly string[];
}

export interface BundleEntry {
  readonly name: string;
  readonly text?: string;
  readonly base64?: string;
}

export interface RecordedEntry {
  readonly key: string;
  readonly status: number;
  readonly contentType: string | null;
  readonly link: string | null;
  readonly body?: unknown;
  readonly base64?: string;
}

type Query = Record<string, string | string[]>;

interface RecordedRequest {
  readonly actor: string;
  readonly method: string;
  readonly path: string;
  readonly query: Query;
  readonly body?: unknown;
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const ACCOUNT_ID = new RegExp(String.raw`\b(\d{6})(?::|_|%3A)(${UUID})\b`, "gi");
const CLOUD_ID = new RegExp(
  String.raw`(?:cloud-id">|ari:cloud:[a-z]+:|tenantId&quot;:&quot;|"cloudId":\s*")(${UUID})`,
  "gi",
);
const ANY_UUID = new RegExp(UUID, "gi");
const COMPACT_ACCOUNT_ID = /~(\d{6})([0-9a-f]{32})\b/g;
const LEGACY_ACCOUNT_ID = /\b[0-9a-f]{24}\b/g;
const ENCODED_ARI = /("base64EncodedAri"\s*:\s*")([A-Za-z0-9+/]+={0,2})"/g;
const BASE64 = /[A-Za-z0-9+/]{24,}={0,2}/g;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const TEST_SITE_FOLDER = "confluence-cloud";
export const TEST_DATA_FOLDER = ["_", "Testdata"].join("");
const REPLACEMENT_WORDS = ["test user", "example.org", "example-team"];
const FAKE_DOMAIN = "example.org";
const FAKE_SITE = "example.atlassian.net";
const AVATAR =
  /(?:https?:\/\/[^\s"'<>]*)?\/(?:wiki\/)?aa-avatar\/[^\s"'<>&]*|https?:\/\/[a-z0-9.-]*(?:avatar|gravatar)[a-z0-9.-]*\/[^\s"'<>]*/gi;
const FAKE_AVATAR = "/wiki/images/icons/profilepics/default.svg";
const ATLASSIAN_SITE = /\b[a-z0-9-]+\.atlassian\.net\b/gi;
const MEDIA =
  /\b(?:api\.media\.atlassian\.com|media-cdn\.atlassian\.com)\b|aa-avatar|gravatar\.com|avatar-management/i;
const NAME_FIELD =
  /"(?:displayName|publicName|fullName|authorFullName)"\s*:\s*"([^"]*)"|name="(?:displayName|fullName|firstName|lastName|authorFullName)"><!\[CDATA\[([^\]]*)/g;

const SECRETS: readonly { readonly name: string; readonly pattern: RegExp }[] = [
  { name: "Atlassian API token", pattern: /ATATT[A-Za-z0-9_\-=]{20,}/ },
  { name: "bearer token", pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{20,}/ },
  { name: "basic credentials", pattern: /\bBasic\s+[A-Za-z0-9+/]{20,}={0,2}/ },
  { name: "JSON web token", pattern: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\./ },
  { name: "AWS access key", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "private key", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: "GitHub token", pattern: /\bgh[pousr]_[A-Za-z0-9]{36}\b/ },
  { name: "Slack token", pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}/ },
  { name: "token parameter", pattern: /[?&](?:token|access_token|api_key|apikey)=[A-Za-z0-9._-]{16,}/i },
];

function fakeUuid(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function fakeLegacy(index: number): string {
  return `000000000000${String(index).padStart(12, "0")}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function createAnonymizer(input: {
  actors: readonly Actor[];
  site: string;
  accountIds: Iterable<string>;
  legacyIds: Iterable<string>;
  cloudIds: Iterable<string>;
  emails?: Iterable<string>;
}): Anonymizer {
  const uuids = new Map<string, string>();
  input.actors.forEach((actor, index) => {
    const uuid = actor.accountId.split(":")[1];
    if (uuid) uuids.set(uuid.toLowerCase(), fakeUuid(index + 1));
  });
  let next = input.actors.length + 1;
  for (const uuid of [...input.accountIds].sort()) if (!uuids.has(uuid)) uuids.set(uuid, fakeUuid(next++));
  const legacy = new Map<string, string>();
  for (const id of [...input.legacyIds].sort()) legacy.set(id, fakeLegacy(next++));
  let cloudIndex = 1;
  for (const uuid of [...input.cloudIds].sort()) {
    if (!uuids.has(uuid)) uuids.set(uuid, fakeUuid(900_000 + cloudIndex++));
  }
  const compact = new Map([...uuids].map(([real, fake]) => [real.replace(/-/g, ""), fake.replace(/-/g, "")]));
  const names = input.actors.map((actor, index) => [actor.displayName, `Test User ${index + 1}`] as const);
  const emails = new Map(
    input.actors.map((actor, index) => [actor.email.toLowerCase(), `user${index + 1}@${FAKE_DOMAIN}`]),
  );
  let other = 1;
  for (const email of [...(input.emails ?? [])].map((value) => value.toLowerCase()).sort()) {
    if (!emails.has(email) && !email.endsWith(`@${FAKE_DOMAIN}`))
      emails.set(email, `app${other++}@${FAKE_DOMAIN}`);
  }
  const host = new URL(input.site).hostname.split(".")[0] ?? "";
  const residues = new Set<string>();
  for (const actor of input.actors) {
    const [local = "", domain = ""] = actor.email.toLowerCase().split("@");
    residues.add(actor.displayName.toLowerCase());
    for (const part of [
      ...actor.displayName.split(/[\s._-]+/),
      ...local.split(/[.\s_-]+/),
      domain.split(".")[0] ?? "",
    ]) {
      const value = part.toLowerCase();
      if (value.length >= 4 && !REPLACEMENT_WORDS.some((word) => word.includes(value))) residues.add(value);
    }
  }
  if (host) residues.add(host.toLowerCase());
  for (const uuid of uuids.keys()) residues.add(uuid);
  for (const id of legacy.keys()) residues.add(id);
  const namePattern = new RegExp(
    names
      .map(([name]) => name)
      .sort((left, right) => right.length - left.length)
      .map(escapeRegExp)
      .join("|"),
    "gi",
  );
  const replacements = new Map(names.map(([name, fake]) => [name.toLowerCase(), fake]));
  const hostPattern = new RegExp(`\\b${escapeRegExp(host)}(?=(\\w?))`, "g");
  return {
    residues: [...residues],
    text(value) {
      let result = value
        .replace(ENCODED_ARI, (_match, lead: string, encoded: string) => {
          const decoded = Buffer.from(encoded, "base64").toString("utf8");
          return `${lead}${Buffer.from(this.text(decoded), "utf8").toString("base64")}"`;
        })
        .replace(ANY_UUID, (match) => uuids.get(match.toLowerCase()) ?? match)
        .replace(COMPACT_ACCOUNT_ID, (match, prefix: string, hex: string) => {
          const fake = compact.get(hex);
          return fake ? `~${prefix}${fake}` : match;
        })
        .replace(LEGACY_ACCOUNT_ID, (match) => legacy.get(match) ?? match)
        .replace(EMAIL, (match) => emails.get(match.toLowerCase()) ?? match)
        .replace(AVATAR, FAKE_AVATAR);
      if (names.length > 0) {
        result = result.replace(namePattern, (match) => {
          const fake = replacements.get(match.toLowerCase()) ?? match;
          return match === match.toLowerCase() ? fake.toLowerCase() : fake;
        });
      }
      if (host)
        result = result.replace(hostPattern, (_match, next: string) => (next ? "example-" : "example"));
      return result;
    },
  };
}

export function collectIds(texts: Iterable<string>): {
  accountIds: Set<string>;
  legacyIds: Set<string>;
  cloudIds: Set<string>;
  emails: Set<string>;
} {
  const accountIds = new Set<string>();
  const legacyIds = new Set<string>();
  const cloudIds = new Set<string>();
  const emails = new Set<string>();
  for (const text of texts) {
    for (const match of text.matchAll(EMAIL)) emails.add(match[0]);
    for (const match of text.matchAll(ACCOUNT_ID)) accountIds.add((match[2] ?? "").toLowerCase());
    for (const match of text.matchAll(LEGACY_ACCOUNT_ID)) legacyIds.add(match[0]);
    for (const match of text.matchAll(CLOUD_ID)) cloudIds.add((match[1] ?? "").toLowerCase());
  }
  return { accountIds, legacyIds, cloudIds, emails };
}

export function findProblems(
  name: string,
  content: string,
  anonymizer: Anonymizer,
  names?: ReadonlySet<string>,
): string[] {
  const problems: string[] = [];
  const lower = content.toLowerCase();
  const decoded = [...content.matchAll(BASE64)]
    .map((match) => Buffer.from(match[0], "base64").toString("latin1"))
    .filter((text) => /^[\x20-\x7e]+$/.test(text))
    .join("\n")
    .toLowerCase();
  for (const residue of anonymizer.residues) {
    const needle = residue.toLowerCase();
    if (lower.includes(needle)) problems.push(`${name}: personal data left (${residue.length} characters)`);
    if (decoded.includes(needle)) {
      problems.push(`${name}: personal data left in Base64 (${residue.length} characters)`);
    }
  }
  for (const match of content.matchAll(EMAIL)) {
    const domain = match[0].split("@")[1]?.toLowerCase() ?? "";
    if (domain !== FAKE_DOMAIN) problems.push(`${name}: e-mail address left at domain ${domain}`);
  }
  for (const match of content.matchAll(ATLASSIAN_SITE)) {
    if (match[0].toLowerCase() !== FAKE_SITE) problems.push(`${name}: Atlassian site ${match[0]} left`);
  }
  if (MEDIA.test(content.replaceAll(FAKE_AVATAR, ""))) problems.push(`${name}: avatar or media address left`);
  for (const match of content.matchAll(NAME_FIELD)) {
    const value = (match[1] ?? match[2] ?? "").trim();
    if (value && !/^(?:Test User \d+|System)$/.test(value) && !(names?.has(value) ?? false)) {
      problems.push(`${name}: person name left in a name field (${value.length} characters)`);
    }
  }
  for (const secret of SECRETS) {
    if (secret.pattern.test(content)) problems.push(`${name}: looks like a ${secret.name}`);
  }
  return problems;
}

export function canonicalQuery(query: Query): string {
  const parts: string[] = [];
  for (const name of Object.keys(query).sort()) {
    const value = query[name] ?? [];
    for (const item of Array.isArray(value) ? [...value].sort() : [value]) {
      parts.push(`${encodeURIComponent(name)}=${encodeURIComponent(item)}`);
    }
  }
  return parts.join("&");
}

export function requestKey(request: RecordedRequest): string {
  const body = request.body === undefined ? "" : ` ${JSON.stringify(request.body)}`;
  return `${request.actor} ${request.method} ${request.path}?${canonicalQuery(request.query)}${body}`;
}

export function readZip(data: Buffer): { name: string; data: Buffer }[] {
  let end = data.length - 22;
  while (end >= 0 && data.readUInt32LE(end) !== 0x06054b50) end -= 1;
  if (end < 0) throw new Error("Not a ZIP archive");
  const count = data.readUInt16LE(end + 10);
  let offset = data.readUInt32LE(end + 16);
  const entries: { name: string; data: Buffer }[] = [];
  for (let index = 0; index < count; index += 1) {
    if (data.readUInt32LE(offset) !== 0x02014b50) throw new Error("Broken central directory");
    const method = data.readUInt16LE(offset + 10);
    const compressedSize = data.readUInt32LE(offset + 20);
    const nameLength = data.readUInt16LE(offset + 28);
    const extraLength = data.readUInt16LE(offset + 30);
    const commentLength = data.readUInt16LE(offset + 32);
    const local = data.readUInt32LE(offset + 42);
    const name = data.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    if (name.startsWith("/") || name.split(/[\\/]/).includes("..") || /^[A-Za-z]:/.test(name)) {
      throw new Error(`The archive contains the unsafe entry ${name}.`);
    }
    const start = local + 30 + data.readUInt16LE(local + 26) + data.readUInt16LE(local + 28);
    const raw = data.subarray(start, start + compressedSize);
    entries.push({ name, data: method === 8 ? inflateRawSync(raw) : Buffer.from(raw) });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function asText(data: Buffer): string | null {
  if (data.includes(0)) return null;
  const text = data.toString("utf8");
  return Buffer.from(text, "utf8").equals(data) ? text : null;
}

export function bundle(lines: readonly object[]): Buffer {
  return gzipSync(Buffer.from(`${lines.map((line) => JSON.stringify(line)).join("\n")}\n`, "utf8"), {
    level: 9,
  });
}

const COUNT_ROWS: readonly (readonly [RegExp, string])[] = [
  [/^Seiten aktuell/, "pages"],
  [/^davon Live-Docs/, "liveDocs"],
  [/^Seiten archiviert/, "archivedPages"],
  [/^Seiten im Papierkorb/, "trashedPages"],
  [/^Blogposts/, "blogPosts"],
  [/^Ordner/, "folders"],
  [/^Whiteboards/, "whiteboards"],
  [/^Datenbanken/, "databases"],
  [/^Smart Links/, "smartLinks"],
  [/^Versionen/, "versions"],
  [/^Seitenkommentare/, "pageComments"],
  [/^Inline-Kommentare/, "inlineComments"],
  [/^Anhänge \(Dateien\)/, "attachments"],
  [/^Anhang-Versionen/, "attachmentVersions"],
  [/^Anhänge Größe/, "attachmentKiB"],
  [/^Stichwörter/, "labels"],
  [/^Seiten mit Leseeinschränkung/, "viewRestrictedPages"],
  [/^Seiten mit Bearbeitungseinschränkung/, "editRestrictedPages"],
  [/^Bereichsvorlagen/, "templates"],
];

function cells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function pageRefs(text: string): { space: string; title: string }[] {
  return text
    .split("; ")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => {
      const index = part.indexOf(" › ");
      if (index < 0) throw new Error(`Unexpected page reference in expected.md: ${part}`);
      return { space: part.slice(0, index), title: part.slice(index + 3) };
    });
}

function section(markdown: string, heading: string): string[] {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => line.replace(/^#+\s*/, "") === heading && line.startsWith("#"));
  if (start < 0) throw new Error(`expected.md has no section ${heading}`);
  const level = (/^#+/.exec(lines[start] ?? "")?.[0] ?? "#").length;
  const result: string[] = [];
  for (const line of lines.slice(start + 1)) {
    const match = /^(#+)\s/.exec(line);
    if (match && (match[1] ?? "").length <= level) break;
    result.push(line);
  }
  return result;
}

export function parseExpected(markdown: string): Record<string, unknown> {
  const accounts = section(markdown, "Konten")
    .filter((line) => line.startsWith("|") && !line.includes("---") && !line.includes("Anzeigename"))
    .map((line) => {
      const [role, displayName, accountId, email] = cells(line);
      return { role, displayName, accountId: (accountId ?? "").replace(/`/g, ""), email };
    });
  const countLines = section(markdown, "Zählwerte je Bereich").filter((line) => line.startsWith("|"));
  const header = cells(countLines[0] ?? "").slice(1);
  const spaces: Record<string, Record<string, unknown>> = {};
  for (const key of header) spaces[key] = {};
  for (const line of countLines.slice(2)) {
    const [label = "", ...values] = cells(line);
    const row = COUNT_ROWS.find(([pattern]) => pattern.test(label));
    if (!row) throw new Error(`Unknown row in expected.md: ${label}`);
    values.forEach((value, index) => {
      const space = spaces[header[index] ?? ""];
      if (!space) return;
      if (row[1] === "inlineComments") {
        const [open, resolved] = value.split("/").map((part) => Number(part.trim()));
        space[row[1]] = { open, resolved };
      } else if (row[1] === "labels") {
        const [distinct, assignments] = value.split("/").map((part) => Number(part.trim()));
        space[row[1]] = { distinct, assignments };
      } else space[row[1]] = Number(value);
    });
  }
  const restrictions = section(markdown, "Beschränkungen")
    .map((line) => /^- \*\*(\w+)\*\* Lesen: (.*) · Bearbeiten: (.*)$/.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => ({
      space: match[1],
      view: (match[2] ?? "").split(", ").map((title) => title.trim()),
      edit: (match[3] ?? "").split(", ").map((title) => title.trim()),
    }));
  const macros: Record<string, { space: string; title: string }[]> = {};
  for (const line of section(markdown, "Makros und die Seiten, die sie verwenden")) {
    const match = /^\| `([^`]+)` \| (.*) \|$/.exec(line.trim());
    if (match) macros[match[1] ?? ""] = pageRefs(match[2] ?? "");
  }
  const thirdParty = section(markdown, "Drittanbieter (draw.io, Gliffy)")
    .map((line) => /^- (\w+) › (.*) \(([^)]*)\): vorhanden \(([^)]*)\)$/.exec(line.trim()))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => {
      const title = (match[2] ?? "").trim();
      return { space: match[1], title, macros: (match[4] ?? "").split(", ").map((name) => `app:${name}`) };
    });
  const checks = section(markdown, "Sonderfälle (Checkliste)")
    .map((line) => /^- \[[ x]\] (.*)$/.exec(line.trim())?.[1])
    .filter((line): line is string => line !== undefined);
  return { accounts, spaces, restrictions, macros, thirdParty, checks };
}

function readActors(index: { actors: Record<string, Omit<Actor, "role">> }): Actor[] {
  return Object.entries(index.actors).map(([role, actor]) => ({ role, ...actor }));
}

export function projectFolder(): string {
  const common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
    cwd: import.meta.dirname,
    encoding: "utf8",
  }).trim();
  return path.dirname(path.dirname(common));
}

function resolved(folder: string): string | null {
  try {
    return realpathSync.native(folder);
  } catch {
    return null;
  }
}

export function testSiteFolder(source: string, project: string): (relative: string) => Buffer {
  const root = resolved(source);
  if (!root) throw new Error(`The folder ${source} does not exist.`);
  const expected = resolved(path.join(project, TEST_DATA_FOLDER, TEST_SITE_FOLDER));
  if (root !== expected) {
    throw new Error(
      `Fixtures are made only from the folder ${TEST_DATA_FOLDER}/${TEST_SITE_FOLDER} next to the repository, not from ${root}.`,
    );
  }
  return (relative) => {
    const file = realpathSync.native(path.join(root, relative));
    if (!file.startsWith(`${root}${path.sep}`))
      throw new Error(`${relative} lies outside the test site folder.`);
    return readFileSync(file);
  };
}

function checkArchive(
  name: string,
  entries: readonly { name: string; data: Buffer }[],
  keys: ReadonlySet<string>,
) {
  const descriptor =
    entries
      .find((entry) => entry.name.replace(/^\.\//, "") === "exportDescriptor.properties")
      ?.data.toString("utf8") ?? "";
  const spaceKey = /^spaceKey=(.*)$/m.exec(descriptor)?.[1]?.trim();
  const entities =
    entries.find((entry) => entry.name.replace(/^\.\//, "") === "entities.xml")?.data.toString("utf8") ?? "";
  const known = spaceKey
    ? keys.has(spaceKey)
    : keys.size > 0 &&
      [...keys].every((key) => entities.includes(`<property name="key"><![CDATA[${key}]]></property>`));
  if (!/^source=cloud$/m.test(descriptor) || !known)
    throw new Error(`${name} is not an export of the test site.`);
}

function appNames(texts: Iterable<string>): Set<string> {
  const names = new Set<string>();
  const walk = (value: unknown) => {
    if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      if (record.accountType === "app") {
        for (const field of ["displayName", "publicName"]) {
          if (typeof record[field] === "string") names.add(record[field] as string);
        }
      }
      Object.values(record).forEach(walk);
    }
  };
  for (const text of texts) walk(JSON.parse(text));
  return names;
}

export function prepare(
  source: string,
  target: string,
  project = projectFolder(),
): { files: { name: string; bytes: number }[] } {
  const read = testSiteFolder(source, project);
  const index = JSON.parse(read("api-recording/index.json").toString("utf8")) as {
    site: string;
    actors: Record<string, Omit<Actor, "role">>;
    spaces?: { key: string }[];
    entries: { key: string; file: string }[];
  };
  const keys = new Set((index.spaces ?? []).map((space) => space.key));
  const requests = new Map(
    index.entries.map((entry) => [entry.file, read(path.join("api-recording", entry.file)).toString("utf8")]),
  );
  const exports = readdirSync(path.join(realpathSync(source), "xml"))
    .filter((name) => name.endsWith(".zip"))
    .sort()
    .map((name) => {
      const entries = readZip(read(path.join("xml", name)));
      checkArchive(name, entries, keys);
      return { name, entries };
    });
  const expectedMarkdown = read("expected.md").toString("utf8");
  const texts = function* () {
    yield* requests.values();
    for (const archive of exports) {
      for (const entry of archive.entries) {
        const text = asText(entry.data);
        if (text !== null) yield text;
      }
    }
    yield expectedMarkdown;
  };
  const anonymizer = createAnonymizer({
    actors: readActors(index),
    site: index.site,
    ...collectIds(texts()),
  });
  const cleanRequests = new Map([...requests].map(([file, text]) => [file, anonymizer.text(text)]));
  const names = appNames(cleanRequests.values());
  const problems: string[] = [];
  const written: { name: string; bytes: number }[] = [];
  mkdirSync(target, { recursive: true });
  const write = (name: string, data: Buffer | string) => {
    writeFileSync(path.join(target, name), data);
    written.push({ name, bytes: Buffer.byteLength(data) });
  };

  for (const archive of exports) {
    const lines: BundleEntry[] = archive.entries.map((entry) => {
      const text = asText(entry.data);
      if (text !== null) {
        const clean = anonymizer.text(text);
        problems.push(...findProblems(`${archive.name}/${entry.name}`, clean, anonymizer, names));
        return { name: entry.name, text: clean };
      }
      problems.push(
        ...findProblems(`${archive.name}/${entry.name}`, entry.data.toString("latin1"), anonymizer, names),
      );
      return { name: entry.name, base64: entry.data.toString("base64") };
    });
    write(archive.name.replace(/\.zip$/, ".jsonl.gz"), bundle(lines));
  }

  const entries: RecordedEntry[] = [];
  const seen = new Set<string>();
  for (const entry of index.entries) {
    const clean = cleanRequests.get(entry.file) ?? "";
    problems.push(...findProblems(`api-recording/${entry.file}`, clean, anonymizer, names));
    const recorded = JSON.parse(clean) as {
      request: RecordedRequest;
      response: {
        status: number;
        contentType?: string;
        link?: string;
        body?: unknown;
        bodyFile?: string;
      };
    };
    const key = requestKey(recorded.request);
    if (key !== anonymizer.text(entry.key)) problems.push(`api-recording/${entry.file}: key changed`);
    if (seen.has(key)) continue;
    seen.add(key);
    const response = recorded.response;
    const base = {
      key,
      status: response.status,
      contentType: response.contentType ?? null,
      link: response.link ?? null,
    };
    if (response.bodyFile) {
      const data = read(path.join("api-recording", response.bodyFile));
      const text = asText(data);
      const isText = text !== null && /^(text\/|application\/(json|xml))/.test(response.contentType ?? "");
      const content = isText ? Buffer.from(anonymizer.text(text), "utf8") : data;
      problems.push(
        ...findProblems(`api-recording/${response.bodyFile}`, content.toString("latin1"), anonymizer, names),
      );
      entries.push({ ...base, base64: content.toString("base64") });
    } else entries.push({ ...base, ...(response.body === undefined ? {} : { body: response.body }) });
  }
  write("api-recording.jsonl.gz", bundle(entries));

  const expectedText = anonymizer.text(expectedMarkdown);
  problems.push(...findProblems("expected.md", expectedText, anonymizer, names));
  const expected = parseExpected(expectedText);
  const expectedJson = `${JSON.stringify({ site: anonymizer.text(index.site), ...expected }, null, 2)}\n`;
  problems.push(...findProblems("expected.json", expectedJson, anonymizer, names));
  if (problems.length > 0) {
    throw new Error(`The fixtures were not written completely:\n${[...new Set(problems)].join("\n")}`);
  }
  write("expected.json", expectedJson);
  return { files: written };
}

if (import.meta.main) {
  const [source, target = path.join(import.meta.dirname, "fixtures")] = process.argv.slice(2);
  if (!source) {
    process.stderr.write(
      "Usage: node prepare.ts <folder with api-recording, xml and expected.md> [target folder]\n",
    );
    process.exit(2);
  }
  try {
    const { files } = prepare(source, target);
    for (const file of files) process.stdout.write(`${file.name}\t${file.bytes} bytes\n`);
    process.stdout.write(`total\t${files.reduce((sum, file) => sum + file.bytes, 0)} bytes\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
