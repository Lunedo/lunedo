import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build, type Plugin } from "esbuild";

export const GENERATE_COMMAND = "pnpm docs:generate";

export interface Reference<T = unknown> {
  readonly page: string;
  readonly title: string;
  readonly sources: readonly string[];
  readonly entry: string;
  render(data: T): string;
}

export function defineReference<T>(reference: Reference<T>): Reference<T> {
  return reference;
}

export function generatedNote(sources: readonly string[]): string {
  const files = sources.map((source) => `\`${source}\``).join(", ");
  return `This page is generated from ${files} by \`${GENERATE_COMMAND}\`. Do not edit it by hand; change the code and run the command again.`;
}

export function page(reference: Pick<Reference, "title" | "sources">, body: string): string {
  return `# ${reference.title}\n\n${generatedNote(reference.sources)}\n\n${body.trim()}\n`;
}

export function cell(text: string): string {
  return text
    .replace(/\s*\n\s*/g, " ")
    .replaceAll("|", "\\|")
    .trim();
}

export function code(text: string): string {
  const fence = text.includes("`") ? "``" : "`";
  const padding = text.startsWith("`") || text.endsWith("`") ? " " : "";
  return `${fence}${padding}${text}${padding}${fence}`;
}

export function table(header: readonly string[], rows: readonly (readonly string[])[]): string {
  return [
    `| ${header.join(" | ")} |`,
    `|${header.map(() => "---").join("|")}|`,
    ...rows.map((row) => `| ${row.map(cell).join(" | ")} |`),
  ].join("\n");
}

export function staleReferences(
  expected: ReadonlyMap<string, string>,
  read: (page: string) => string | undefined,
): string[] {
  return [...expected.entries()].flatMap(([file, content]) => {
    const actual = read(file);
    if (actual === undefined) return [`${file} is missing`];
    return actual === content ? [] : [`${file} is not up to date`];
  });
}

const EXTERNAL = Symbol("external");

const workspacePackages: Plugin = {
  name: "workspace-packages",
  setup(builder) {
    builder.onResolve({ filter: /\?text$/ }, (args) => ({
      path: path.resolve(args.resolveDir, args.path.slice(0, -"?text".length)),
      namespace: "text",
    }));
    builder.onLoad({ filter: /.*/, namespace: "text" }, (args) => ({
      contents: readFileSync(args.path, "utf8"),
      loader: "text",
    }));
    builder.onResolve({ filter: /^[^./]/ }, async (args) => {
      if (args.path.startsWith("@lunedo/") || args.pluginData === EXTERNAL) return undefined;
      const resolved = await builder.resolve(args.path, {
        kind: args.kind,
        importer: args.importer,
        resolveDir: args.resolveDir,
        pluginData: EXTERNAL,
      });
      if (resolved.errors.length > 0 || resolved.path === "" || !path.isAbsolute(resolved.path)) {
        return { path: args.path, external: true };
      }
      return { path: pathToFileURL(resolved.path).href, external: true };
    });
  },
};

export async function loadEntry(root: string, name: string, entry: string): Promise<unknown> {
  const server = path.join(root, "packages", "server");
  const result = await build({
    stdin: { contents: entry, resolveDir: root, sourcefile: `${name}.ts`, loader: "ts" },
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
    target: "node24",
    conditions: ["@lunedo/source"],
    plugins: [workspacePackages],
    logLevel: "silent",
  });
  const directory = path.join(server, "node_modules", ".cache", "lunedo-docs");
  mkdirSync(directory, { recursive: true });
  const file = path.join(directory, `${name}-${process.pid}.mjs`);
  writeFileSync(file, result.outputFiles[0]?.text ?? "");
  try {
    const loaded = (await import(pathToFileURL(file).href)) as { default?: unknown };
    return loaded.default;
  } finally {
    rmSync(file, { force: true });
  }
}

export async function renderReferences(
  root: string,
  references: readonly Reference<never>[],
): Promise<Map<string, string>> {
  const pages = new Map<string, string>();
  for (const reference of references) {
    const name = path.basename(reference.page, ".md");
    const data = (await loadEntry(root, name, reference.entry)) as never;
    pages.set(path.posix.join("docs", reference.page), page(reference, reference.render(data)));
  }
  return pages;
}
