import { describe, expect, it } from "vitest";
import { initI18n } from "../i18n/index.js";
import { itemKindLabel } from "./item-kinds.js";
import { itemHref } from "./item-paths.js";

const ID = "01929b1e-0000-7000-8000-0000000000f1";

describe("content kinds the client does not know yet", () => {
  it("get no link instead of a wrong one", () => {
    expect(itemHref({ id: ID, kind: "database", title: "Board", link: null }, "ITOPS")).toBeNull();
    const link = (kind: string) => ({
      id: ID,
      kind: "link",
      title: "Shortcut",
      link: {
        itemId: ID,
        url: null,
        accessible: true,
        target: { spaceKey: "ITOPS", kind, title: "Launch notes" },
      },
    });
    expect(itemHref(link("database") as never, "ITOPS")).toBeNull();
    expect(itemHref(link("blogPost") as never, "ITOPS")).toBe(`/spaces/ITOPS/blog/${ID}/launch-notes`);
    expect(itemHref(link("page") as never, "ITOPS")).toBe(`/spaces/ITOPS/pages/${ID}/launch-notes`);
  });

  it("lead whiteboards to their own screen, also when they were shared without the space", () => {
    expect(itemHref({ id: ID, kind: "whiteboard", title: "Team board", link: null }, "ITOPS")).toBe(
      `/spaces/ITOPS/whiteboards/${ID}/team-board`,
    );
    expect(itemHref({ id: ID, kind: "whiteboard", title: "Team board", link: null }, "")).toBe(
      `/shared/${ID}/team-board`,
    );
  });

  it("are labelled as an item", async () => {
    const i18n = await initI18n(["en"]);
    expect(itemKindLabel(i18n.t, "database")).toBe("Item");
    expect(itemKindLabel(i18n.t, "whiteboard")).toBe("Whiteboard");
    expect(itemKindLabel(i18n.t, null)).toBe("Item");
    expect(itemKindLabel(i18n.t, "blogPost")).toBe("Blog post");
  });
});
