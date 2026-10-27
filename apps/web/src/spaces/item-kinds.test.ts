import { describe, expect, it } from "vitest";
import { initI18n } from "../i18n/index.js";
import { itemKindLabel } from "./item-kinds.js";
import { itemHref } from "./item-paths.js";

const ID = "01929b1e-0000-7000-8000-0000000000f1";

describe("content kinds the client does not know yet", () => {
  it("get no link instead of a wrong one", () => {
    expect(
      itemHref({ id: ID, number: 4711, kind: "database", title: "Board", link: null }, "ITOPS"),
    ).toBeNull();
    const link = (kind: string) => ({
      id: ID,
      number: 4712,
      kind: "link",
      title: "Shortcut",
      link: {
        itemId: ID,
        url: null,
        accessible: true,
        target: { spaceKey: "ITOPS", kind, number: 4711, title: "Launch notes" },
      },
    });
    expect(itemHref(link("database") as never, "ITOPS")).toBeNull();
    expect(itemHref(link("blogPost") as never, "ITOPS")).toBe("/spaces/ITOPS/blog/4711/launch-notes");
    expect(itemHref(link("page") as never, "ITOPS")).toBe("/spaces/ITOPS/pages/4711/launch-notes");
  });

  it("lead whiteboards to their own screen, also when they were shared without the space", () => {
    expect(
      itemHref({ id: ID, number: 4711, kind: "whiteboard", title: "Team board", link: null }, "ITOPS"),
    ).toBe("/spaces/ITOPS/whiteboards/4711/team-board");
    expect(itemHref({ id: ID, number: 4711, kind: "whiteboard", title: "Team board", link: null }, "")).toBe(
      "/shared/4711/team-board",
    );
  });

  it("give every addressable kind its own address and leave out an empty slug", () => {
    const at = (kind: string, title = "Über uns") =>
      itemHref({ id: ID, number: 1040, kind, title, link: null }, "Ü KEY");
    expect(at("page")).toBe("/spaces/%C3%9C%20KEY/pages/1040/ueber-uns");
    expect(at("folder")).toBe("/spaces/%C3%9C%20KEY/folders/1040/ueber-uns");
    expect(at("blogPost")).toBe("/spaces/%C3%9C%20KEY/blog/1040/ueber-uns");
    expect(at("meetingSeries")).toBe("/spaces/%C3%9C%20KEY/meetings/1040/ueber-uns");
    expect(at("meetingTopic")).toBe("/spaces/%C3%9C%20KEY/topics/1040/ueber-uns");
    expect(at("page", "%&?")).toBe("/spaces/%C3%9C%20KEY/pages/1040");
    expect(itemHref({ id: ID, number: 1040, kind: "folder", title: "x", link: null }, "")).toBeNull();
  });

  it("are labelled as an item", async () => {
    const i18n = await initI18n(["en"]);
    expect(itemKindLabel(i18n.t, "database")).toBe("Item");
    expect(itemKindLabel(i18n.t, "whiteboard")).toBe("Whiteboard");
    expect(itemKindLabel(i18n.t, null)).toBe("Item");
    expect(itemKindLabel(i18n.t, "blogPost")).toBe("Blog post");
  });
});
