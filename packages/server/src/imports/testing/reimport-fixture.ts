import type { SyntheticExport, SyntheticPage } from "./confluence-export.js";
import { ALICE, BOB } from "./fixture.js";

export const RE = {
  home: "3001",
  steady: "3002",
  sourceOnly: "3003",
  keepHere: "3004",
  takeSource: "3005",
  keepBoth: "3006",
  editing: "3007",
  trash: "3008",
  keep: "3009",
  follows: "3010",
  stays: "3011",
  restricted: "3012",
  target: "3013",
  created: "3014",
  createdChild: "3015",
} as const;

export const RE_COMMENT = { kept: "3501", gone: "3502", added: "3503", inline: "3504" } as const;

function page(id: string, title: string, body: string, extra: Partial<SyntheticPage> = {}): SyntheticPage {
  return {
    id,
    title,
    parentId: RE.home,
    position: null,
    body,
    creatorKey: ALICE.key,
    version: 1,
    ...extra,
  };
}

export function reimportBefore(): SyntheticExport {
  return {
    space: { id: "6001", key: "REI", name: "Re-import space", homePageId: RE.home },
    users: [ALICE, BOB],
    pages: [
      page(RE.home, "Re-import home", "<p>Home</p>", { parentId: null }),
      page(RE.steady, "Steady", "<p>Never changes</p>", { labels: ["stays", "dropped", "touched"] }),
      page(RE.sourceOnly, "Source only", "<p>Old text</p>"),
      page(RE.keepHere, "Keep here", "<p>Original keep here</p>"),
      page(RE.takeSource, "Take source", "<p>Original take source</p>"),
      page(RE.keepBoth, "Keep both", "<p>Original keep both</p>"),
      page(RE.editing, "Being edited", "<p>Original editing</p>"),
      page(RE.trash, "Goes to trash", "<p>Trash me</p>"),
      page(RE.keep, "Kept although deleted", "<p>Keep me</p>"),
      page(RE.target, "Move target", "<p>Target</p>"),
      page(RE.follows, "Follows the source", "<p>Follows</p>"),
      page(RE.stays, "Stays here", "<p>Stays</p>"),
      page(RE.restricted, "Restricted plans", "<p>Secret original</p>"),
    ],
    attachments: [
      { pageId: RE.steady, fileName: "notes.txt", versions: [{ id: "3801", version: 1, data: "one" }] },
    ],
    comments: [
      { id: RE_COMMENT.kept, pageId: RE.steady, creatorKey: ALICE.key, body: "<p>Stays</p>" },
      { id: RE_COMMENT.gone, pageId: RE.steady, creatorKey: BOB.key, body: "<p>Deleted at the source</p>" },
    ],
    spacePermissions: [
      { id: "3901", type: "VIEWSPACE", group: "readers" },
      { id: "3902", type: "VIEWSPACE", userKey: ALICE.key },
      { id: "3903", type: "EDITSPACE", userKey: ALICE.key },
      { id: "3904", type: "SETSPACEPERMISSIONS", userKey: ALICE.key },
    ],
    restrictions: [{ id: "3951", contentId: RE.restricted, kind: "View", userKey: ALICE.key }],
  };
}

export function reimportAfter(): SyntheticExport {
  const before = reimportBefore();
  const changed = (id: string, body: string, extra: Partial<SyntheticPage> = {}) => {
    const original = before.pages.find((entry) => entry.id === id);
    if (!original) throw new Error(`Unknown page ${id}`);
    return { ...original, body, version: 2, ...extra };
  };
  const unchanged = (id: string, extra: Partial<SyntheticPage> = {}) => {
    const original = before.pages.find((entry) => entry.id === id);
    if (!original) throw new Error(`Unknown page ${id}`);
    return { ...original, ...extra };
  };
  return {
    ...before,
    pages: [
      unchanged(RE.home),
      unchanged(RE.steady, { labels: ["stays", "fresh"] }),
      changed(RE.sourceOnly, "<p>New text from the source</p>", { title: "Source only, renamed" }),
      changed(RE.keepHere, "<p>Source keep here</p>"),
      changed(RE.takeSource, "<p>Source take source</p>"),
      changed(RE.keepBoth, "<p>Source keep both</p>"),
      changed(RE.editing, "<p>Source editing</p>"),
      unchanged(RE.target),
      unchanged(RE.follows, { parentId: RE.target }),
      unchanged(RE.stays, { parentId: RE.target }),
      changed(RE.restricted, "<p>Secret from the source</p>"),
      page(RE.created, "Created at the source", "<p>Brand new</p>", { parentId: RE.target }),
      page(RE.createdChild, "Child of the new page", "<p>Below the new page</p>", { parentId: RE.created }),
    ],
    attachments: [
      {
        pageId: RE.steady,
        fileName: "notes.txt",
        versions: [
          { id: "3801", version: 1, data: "one" },
          { id: "3802", version: 2, data: "two" },
        ],
      },
      { pageId: RE.created, fileName: "new.txt", versions: [{ id: "3811", version: 1, data: "new" }] },
    ],
    comments: [
      { id: RE_COMMENT.kept, pageId: RE.steady, creatorKey: ALICE.key, body: "<p>Stays</p>" },
      { id: RE_COMMENT.added, pageId: RE.steady, creatorKey: BOB.key, body: "<p>Added at the source</p>" },
    ],
    spacePermissions: [
      { id: "3901", type: "VIEWSPACE", group: "readers" },
      { id: "3905", type: "EDITSPACE", group: "readers" },
      { id: "3902", type: "VIEWSPACE", userKey: ALICE.key },
      { id: "3903", type: "EDITSPACE", userKey: ALICE.key },
      { id: "3904", type: "SETSPACEPERMISSIONS", userKey: ALICE.key },
    ],
    restrictions: [
      { id: "3951", contentId: RE.restricted, kind: "View", userKey: ALICE.key },
      { id: "3952", contentId: RE.restricted, kind: "View", userKey: BOB.key },
    ],
  };
}

export function foreignExport(): SyntheticExport {
  return { ...reimportBefore(), space: { id: "6999", key: "REI", name: "Other space", homePageId: RE.home } };
}
