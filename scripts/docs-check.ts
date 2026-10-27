import path from "node:path/posix";

export const PUBLISHED_FOLDERS = ["admin", "user", "api"] as const;
export const ROOT_DOCUMENTS = [
  "README.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "GOVERNANCE.md",
  "CHANGELOG.md",
];
export const TARGET_MODULE = "packages/shared/src/documentation.ts";

export interface DocsTree {
  readonly files: ReadonlyMap<string, string>;
  readonly paths?: ReadonlySet<string>;
  readonly targets: Readonly<Record<string, string>>;
  readonly code: ReadonlyMap<string, string>;
}

interface Heading {
  readonly level: number;
  readonly text: string;
}

function proseLines(markdown: string): { line: number; text: string }[] {
  const lines: { line: number; text: string }[] = [];
  let fence: string | null = null;
  for (const [index, text] of markdown.split("\n").entries()) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(text)?.[1];
    if (marker && (fence === null || marker.startsWith(fence))) {
      fence = fence === null ? marker : null;
      continue;
    }
    if (fence === null) lines.push({ line: index + 1, text });
  }
  return lines;
}

export function headings(markdown: string): Heading[] {
  return proseLines(markdown).flatMap(({ text }) => {
    const match = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(text);
    return match ? [{ level: match[1]?.length ?? 0, text: match[2] ?? "" }] : [];
  });
}

export function slug(text: string): string {
  return text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

export function anchors(markdown: string): Set<string> {
  const seen = new Map<string, number>();
  const result = new Set<string>();
  for (const heading of headings(markdown)) {
    const base = slug(heading.text);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    result.add(count === 0 ? base : `${base}-${count}`);
  }
  return result;
}

export function links(markdown: string): { line: number; href: string }[] {
  return proseLines(markdown).flatMap(({ line, text }) =>
    [...text.replace(/`[^`]*`/g, "").matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)].map((match) => ({
      line,
      href: match[1] ?? "",
    })),
  );
}

function isPublished(file: string): boolean {
  return PUBLISHED_FOLDERS.some((folder) => file.startsWith(`docs/${folder}/`)) && file.endsWith(".md");
}

function exists(tree: DocsTree, file: string): boolean {
  const paths = tree.paths ?? new Set(tree.files.keys());
  return paths.has(file) || [...paths].some((name) => name.startsWith(`${file}/`));
}

function targetProblem(tree: DocsTree, file: string, anchor: string | undefined): string | null {
  if (!exists(tree, file)) return `${file} does not exist`;
  if (anchor === undefined || anchor === "") return null;
  const content = tree.files.get(file);
  if (content === undefined || !file.endsWith(".md")) return `${file} has no headings to link #${anchor}`;
  return anchors(content).has(anchor) ? null : `${file} has no heading #${anchor}`;
}

function checkTargets(tree: DocsTree): string[] {
  return Object.entries(tree.targets).flatMap(([name, target]) => {
    const [page = "", anchor] = target.split("#");
    const problem = targetProblem(tree, path.join("docs", page), anchor);
    return problem ? [`${TARGET_MODULE}: ${name} points to ${target}, but ${problem}`] : [];
  });
}

function checkLinks(tree: DocsTree): string[] {
  const documents = [...tree.files.keys()].filter(
    (file) => (file.startsWith("docs/") && file.endsWith(".md")) || ROOT_DOCUMENTS.includes(file),
  );
  return documents.flatMap((file) =>
    links(tree.files.get(file) ?? "").flatMap(({ line, href }) => {
      if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return [];
      if (href.startsWith("/")) return [`${file}:${line}: ${href} is not a relative link`];
      const [relative = "", anchor] = href.split("#");
      const target = relative === "" ? file : path.join(path.dirname(file), decodeURI(relative));
      const problem = targetProblem(tree, target.replace(/\/$/, ""), anchor);
      return problem ? [`${file}:${line}: ${href} is broken, ${problem}`] : [];
    }),
  );
}

const DOCS_PATH = /^(?:docs\/)?(?:(?:admin|user|api|development)\/[\w./-]*|[\w-]+\.md)(?:#[\w-]*)?$/;

function isApplicationCode(file: string): boolean {
  return (
    /^(apps|packages)\/[^/]+\/src\//.test(file) &&
    /\.(ts|tsx|mts|js|mjs)$/.test(file) &&
    !/\.test\.tsx?$/.test(file) &&
    file !== TARGET_MODULE
  );
}

function checkCode(tree: DocsTree): string[] {
  const pages = new Set([...tree.files.keys()].filter((file) => file.startsWith("docs/")));
  return [...tree.code.entries()]
    .filter(([file]) => isApplicationCode(file))
    .flatMap(([file, content]) =>
      content.split("\n").flatMap((text, index) =>
        [...text.matchAll(/(["'`])([^"'`\s]+)\1/g)].flatMap((match) => {
          const value = match[2] ?? "";
          const page = value.split("#")[0] ?? "";
          const intoDocs =
            value.startsWith("docs/") ||
            pages.has(page.startsWith("docs/") ? page : `docs/${page}`) ||
            (DOCS_PATH.test(value) && /docsUrl\(\s*$/.test(text.slice(0, match.index)));
          return intoDocs
            ? [`${file}:${index + 1}: ${value} points into docs/; use an entry of ${TARGET_MODULE}`]
            : [];
        }),
      ),
    );
}

function checkNavigation(tree: DocsTree): string[] {
  const source = tree.files.get("docs/navigation.json");
  if (source === undefined) return ["docs/navigation.json does not exist"];
  let sections: { title?: unknown; pages?: unknown }[];
  try {
    const parsed = JSON.parse(source) as { sections?: unknown };
    if (!Array.isArray(parsed.sections)) return ["docs/navigation.json has no list of sections"];
    sections = parsed.sections;
  } catch (error) {
    return [`docs/navigation.json is not valid JSON: ${String(error)}`];
  }
  const problems: string[] = [];
  const listed = new Set<string>();
  for (const section of sections) {
    if (typeof section.title !== "string" || !Array.isArray(section.pages)) {
      problems.push("docs/navigation.json: every section needs a title and a list of pages");
      continue;
    }
    for (const page of section.pages) {
      const file = `docs/${String(page)}`;
      if (listed.has(file)) problems.push(`docs/navigation.json lists ${page} twice`);
      listed.add(file);
      if (String(page).startsWith("development/")) {
        problems.push(`docs/navigation.json lists ${page}, but development pages are not published`);
      } else if (!tree.files.has(file)) {
        problems.push(`docs/navigation.json lists ${page}, which does not exist`);
      }
    }
  }
  for (const file of tree.files.keys()) {
    if (isPublished(file) && !listed.has(file)) {
      problems.push(`${file} is published but missing from docs/navigation.json`);
    }
  }
  return problems;
}

function checkTitles(tree: DocsTree): string[] {
  return [...tree.files.entries()]
    .filter(([file]) => isPublished(file))
    .flatMap(([file, content]) => {
      const count = headings(content).filter((heading) => heading.level === 1).length;
      return count === 1 ? [] : [`${file} has ${count} H1 headings; a published page needs exactly one`];
    });
}

const MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December";
const VENDOR_NOTE = new RegExp(`^Checked against \\S.* documentation, (?:${MONTHS}) \\d{4}\\.$`);

function checkVendorNotes(tree: DocsTree): string[] {
  return [...tree.files.entries()]
    .filter(([file]) => file.startsWith("docs/") && file.endsWith(".md"))
    .flatMap(([file, content]) => {
      const lines = content.split("\n");
      const prose = proseLines(content);
      const title = prose.find(({ text }) => /^#\s/.test(text));
      const first = title
        ? prose.find(({ line, text }) => line > title.line && text.trim() !== "")
        : undefined;
      return prose
        .filter(({ text }) => /^\W*checked against\b/i.test(text.trim()))
        .flatMap(({ line, text }) => {
          const problems: string[] = [];
          if (!VENDOR_NOTE.test(text)) {
            problems.push(
              `${file}:${line}: the vendor note must read "Checked against <vendor> documentation, <Month Year>."`,
            );
          }
          if (first?.line !== line || (lines[line] ?? "").trim() !== "") {
            problems.push(`${file}:${line}: the vendor note must be a line of its own directly below the H1`);
          }
          return problems;
        });
    });
}

export function checkDocs(tree: DocsTree): string[] {
  return [
    ...checkTargets(tree),
    ...checkLinks(tree),
    ...checkCode(tree),
    ...checkNavigation(tree),
    ...checkTitles(tree),
    ...checkVendorNotes(tree),
  ];
}
