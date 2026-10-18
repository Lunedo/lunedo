import type { Expected, ExpectedSpace } from "./fixtures.js";
import { documentNodes, type ImportSnapshot, type ItemSnapshot } from "./snapshot.js";

export interface MacroOutcome {
  readonly nodes?: readonly string[];
  readonly marks?: readonly string[];
  readonly report?: string;
  readonly within?: readonly string[];
  readonly kept?: boolean;
  readonly pages?: Readonly<Record<string, MacroOutcome>>;
}

function titleOf(item: ItemSnapshot): string {
  return item.path.split(" › ").at(-1) ?? "";
}

function count(items: readonly ItemSnapshot[], predicate: (item: ItemSnapshot) => boolean): number {
  return items.filter(predicate).length;
}

export function spaceCounts(snapshot: ImportSnapshot): ExpectedSpace {
  const items = snapshot.items;
  const content = items.filter((item) => item.kind === "page" || item.kind === "blogPost");
  const comments = content.flatMap((item) => item.comments);
  const topLevel = comments.filter((comment) => comment.parent === null);
  const attachments = items.flatMap((item) => item.attachments);
  const labels = items.flatMap((item) => item.labels);
  return {
    pages: count(items, (item) => item.kind === "page" && !item.archived),
    liveDocs: 0,
    archivedPages: count(items, (item) => item.archived),
    trashedPages: 0,
    blogPosts: count(items, (item) => item.kind === "blogPost"),
    folders: count(items, (item) => item.kind === "folder"),
    whiteboards: 0,
    databases: 0,
    smartLinks: count(items, (item) => item.kind === "link"),
    versions: content.reduce((sum, item) => sum + item.versions.length, 0),
    pageComments: topLevel.filter((comment) => !comment.inline).length,
    inlineComments: {
      open: topLevel.filter((comment) => comment.inline && !comment.resolved).length,
      resolved: topLevel.filter((comment) => comment.inline && comment.resolved).length,
    },
    attachments: attachments.length,
    attachmentVersions: attachments.reduce((sum, attachment) => sum + attachment.versions.length, 0),
    attachmentKiB: Math.round(
      attachments.reduce(
        (sum, attachment) => sum + attachment.versions.reduce((total, version) => total + version.size, 0),
        0,
      ) / 1024,
    ),
    labels: { distinct: new Set(labels).size, assignments: labels.length },
    viewRestrictedPages: count(items, (item) => item.restrictions.view !== undefined),
    editRestrictedPages: count(items, (item) => item.restrictions.edit !== undefined),
    templates: snapshot.templates.length,
  };
}

export function countDifferences(
  actual: ExpectedSpace,
  wanted: ExpectedSpace,
  trashedVersions = 0,
): string[] {
  const result: string[] = [];
  const pages = wanted.pages + wanted.whiteboards + wanted.databases;
  const compare = (field: string, have: unknown, want: unknown) => {
    if (JSON.stringify(have) !== JSON.stringify(want)) {
      result.push(`${field}: imported ${JSON.stringify(have)}, expected ${JSON.stringify(want)}`);
    }
  };
  compare("pages, whiteboards and databases", actual.pages, pages);
  compare("archived pages", actual.archivedPages, wanted.archivedPages);
  compare("blog posts", actual.blogPosts, wanted.blogPosts);
  compare("folders", actual.folders, wanted.folders);
  compare("smart links", actual.smartLinks, wanted.smartLinks);
  compare(
    "versions",
    actual.versions,
    wanted.versions + wanted.whiteboards + wanted.databases - trashedVersions,
  );
  compare("page comments", actual.pageComments, wanted.pageComments);
  compare("inline comments", actual.inlineComments, wanted.inlineComments);
  compare("attachments", actual.attachments, wanted.attachments);
  compare("attachment versions", actual.attachmentVersions, wanted.attachmentVersions);
  if (Math.abs(actual.attachmentKiB - wanted.attachmentKiB) > 1) {
    compare("attachment size in KiB", actual.attachmentKiB, wanted.attachmentKiB);
  }
  compare("labels", actual.labels, wanted.labels);
  compare("pages with a view restriction", actual.viewRestrictedPages, wanted.viewRestrictedPages);
  compare("pages with an edit restriction", actual.editRestrictedPages, wanted.editRestrictedPages);
  compare("templates", actual.templates, wanted.templates);
  return result;
}

export function trashDifferences(snapshot: ImportSnapshot, titles: readonly string[]): string[] {
  const reported = snapshot.problems
    .filter((problem) => problem.code === "trashedContent")
    .map((problem) => String(problem.details.title))
    .sort();
  const imported = snapshot.items.filter((item) => titles.includes(titleOf(item))).map((item) => item.path);
  return [
    ...(JSON.stringify(reported) === JSON.stringify([...titles].sort())
      ? []
      : [`pages in the trash: reported ${reported.join(", ")}, expected ${[...titles].sort().join(", ")}`]),
    ...imported.map((path) => `page in the trash imported: ${path}`),
  ];
}

export function restrictionDifferences(space: string, snapshot: ImportSnapshot, wanted: Expected): string[] {
  const result: string[] = [];
  for (const entry of wanted.restrictions.filter((restriction) => restriction.space === space)) {
    for (const kind of ["view", "edit"] as const) {
      const titles = snapshot.items
        .filter((item) => item.restrictions[kind] !== undefined)
        .map(titleOf)
        .sort();
      const want = [...entry[kind]].sort();
      if (JSON.stringify(titles) !== JSON.stringify(want)) {
        result.push(`${kind} restrictions: imported ${titles.join(", ")}, expected ${want.join(", ")}`);
      }
    }
  }
  return result;
}

export function macroDifferences(
  space: string,
  snapshot: ImportSnapshot,
  wanted: Expected,
  outcomes: Readonly<Record<string, MacroOutcome>>,
  homeTitle: string,
): string[] {
  const result: string[] = [];
  const pages = new Map<string, ItemSnapshot>();
  for (const item of snapshot.items) pages.set(item.path === "(home)" ? homeTitle : titleOf(item), item);
  for (const [macro, uses] of Object.entries(wanted.macros)) {
    for (const use of uses.filter((entry) => entry.space === space)) {
      const page = pages.get(use.title);
      const general = outcomes[macro];
      const outcome = general?.pages?.[use.title] ?? general;
      const where = `${macro} on ${use.title}`;
      if (!page || !outcome) {
        result.push(`${where}: ${page ? "no expected outcome" : "page missing"}`);
        continue;
      }
      const nodes = documentNodes(page.document);
      const unsupported = nodes.filter((node) => node.type === "unsupportedMacro");
      const reports = snapshot.problems.filter((problem) => problem.page === page.path);
      const reported = (code: string, name: string) =>
        reports.some(
          (problem) =>
            problem.code === code && (problem.details.name ?? problem.details.macro ?? name) === name,
        );
      if (outcome.nodes && !outcome.nodes.some((type) => nodes.some((node) => node.type === type))) {
        result.push(`${where}: none of ${outcome.nodes.join(", ")} in the page`);
      }
      if (
        outcome.marks &&
        !outcome.marks.some((type) => nodes.some((node) => node.marks?.some((mark) => mark.type === type)))
      ) {
        result.push(`${where}: no ${outcome.marks.join(", ")} mark in the page`);
      }
      if (outcome.report && !reported(outcome.report, macro))
        result.push(`${where}: no report entry ${outcome.report}`);
      if (outcome.within) {
        const parents = unsupported.filter((node) => outcome.within?.includes(String(node.attrs?.name)));
        if (
          !parents.some((node) => JSON.stringify(node.attrs?.data ?? {}).includes(`ac:name=\\"${macro}\\"`))
        ) {
          result.push(`${where}: not kept inside ${outcome.within.join(" or ")}`);
        }
      }
      const kept = unsupported.some((node) => node.attrs?.name === macro);
      if (outcome.kept && (!kept || !reported("unsupportedMacro", macro))) {
        result.push(`${where}: not kept as an unsupported macro with a report entry`);
      }
      if (!outcome.kept && kept) result.push(`${where}: kept as an unsupported macro`);
    }
  }
  return result;
}

export function removedRestrictionPages(snapshot: ImportSnapshot): string[] {
  const entry = snapshot.problems.find((problem) => problem.code === "removedRestrictionKept");
  return entry ? String(entry.details.pages).split(", ") : [];
}

export function withoutRemovedRestrictions(snapshot: ImportSnapshot): ImportSnapshot {
  const pages = new Set(removedRestrictionPages(snapshot));
  return {
    ...snapshot,
    problems: snapshot.problems.filter((problem) => problem.code !== "removedRestrictionKept"),
    items: snapshot.items.map((item) =>
      pages.has(titleOf(item))
        ? {
            ...item,
            restrictions: Object.fromEntries(
              Object.entries(item.restrictions).filter(([, holders]) => holders.length > 0),
            ),
          }
        : item,
    ),
  };
}
