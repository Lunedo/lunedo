import { describe, expect, it } from "vitest";
import {
  defaultEmbedServices,
  type EmbedService,
  embedFrameSources,
  embedRuleProblem,
  embedServicesValue,
  matchEmbedRule,
  narrowEmbedServices,
  resolveEmbed,
} from "./embeds.js";
import { type DocumentJson, renderHtml, renderMarkdown, renderWord, validateDocument } from "./index.js";

function embedDoc(attrs: Record<string, unknown>): DocumentJson {
  return { type: "doc", content: [{ type: "embed", attrs }] };
}

const embed = (url: string) => resolveEmbed(url, defaultEmbedServices);

describe("the default embed services", () => {
  it.each([
    [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10",
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    ],
    ["https://youtu.be/dQw4w9WgXcQ", "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"],
    ["https://www.youtube.com/shorts/abc_DEF-123", "https://www.youtube-nocookie.com/embed/abc_DEF-123"],
    ["https://vimeo.com/76979871", "https://player.vimeo.com/video/76979871?dnt=1"],
    ["https://vimeo.com/76979871/a1b2c3", "https://player.vimeo.com/video/76979871?h=a1b2c3&dnt=1"],
    [
      "https://www.loom.com/share/0281766fa2d04bb788eaf19e65135184",
      "https://www.loom.com/embed/0281766fa2d04bb788eaf19e65135184",
    ],
    [
      "https://www.figma.com/design/AbC123/Network-plan?node-id=1-2",
      `https://www.figma.com/embed?embed_host=pagehall&url=${encodeURIComponent("https://www.figma.com/design/AbC123/Network-plan?node-id=1-2")}`,
    ],
    ["https://miro.com/app/board/uXjVOabc=/", "https://miro.com/app/live-embed/uXjVOabc=/"],
    ["https://docs.google.com/document/d/1AbC/edit", "https://docs.google.com/document/d/1AbC/preview"],
    [
      "https://docs.google.com/presentation/d/1AbC/edit#slide=id.p",
      "https://docs.google.com/presentation/d/1AbC/embed",
    ],
    [
      "https://docs.google.com/spreadsheets/d/1AbC/edit?gid=0",
      "https://docs.google.com/spreadsheets/d/1AbC/preview",
    ],
    [
      "https://northwind.sharepoint.com/sites/it/_layouts/15/embed.aspx?UniqueId=1d2e&embed=%7B%7D",
      "https://northwind.sharepoint.com/sites/it/_layouts/15/embed.aspx?UniqueId=1d2e",
    ],
  ])("turns %s into an embed address", (link, src) => {
    expect(embed(link)?.src).toBe(src);
  });

  it.each([
    "http://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com.evil.example/watch?v=dQw4w9WgXcQ",
    "https://evil.example/www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com/watch",
    "https://user:secret@www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com:8443/watch?v=dQw4w9WgXcQ",
    "https://videos.example.net/w/8812",
    "https://sharepoint.com/_layouts/15/embed.aspx?UniqueId=1",
    "javascript:alert(1)",
    "not a link",
  ])("does not embed %s", (link) => {
    expect(embed(link)).toBeNull();
  });

  it("never lets a captured value leave the path segment it fills", () => {
    const service: EmbedService = {
      id: "videos",
      name: "Videos",
      rules: [
        {
          pattern: "https://videos.example.org/watch?v={video}",
          embed: "https://videos.example.org/embed/{video}",
        },
      ],
    };
    const embedOf = (link: string, rules = service.rules) => resolveEmbed(link, [{ ...service, rules }])?.src;
    expect(embedOf("https://videos.example.org/watch?v=../../admin")).toBeUndefined();
    expect(embedOf("https://videos.example.org/watch?v=..")).toBeUndefined();
    expect(embedOf("https://videos.example.org/watch?v=a%5Cb")).toBeUndefined();
    expect(embedOf("https://videos.example.org/watch?v=a%3Fb%23c")).toBe(
      "https://videos.example.org/embed/a%3Fb%23c",
    );
    const path = [
      { pattern: "https://videos.example.org/v/{video}", embed: "https://videos.example.org/embed/{video}" },
    ];
    for (const value of ["%2e%2e", "%2E", ".%2e", "a%2fb", "a%5Cb", "%00"]) {
      expect(embedOf(`https://videos.example.org/v/${value}`, path), value).toBeUndefined();
    }
    expect(embedOf("https://videos.example.org/v/a%20b", path)).toBe(
      "https://videos.example.org/embed/a%20b",
    );
    const rest = [{ pattern: "https://videos.example.org/{*}", embed: "https://videos.example.org/{*}" }];
    expect(embedOf("https://videos.example.org/a/%2e%2e/admin", rest)).toBe(
      "https://videos.example.org/admin",
    );
    expect(embedOf("https://videos.example.org/a/b%2Fc", rest)).toBeUndefined();
  });

  it("passes the validation of the setting", () => {
    expect(embedServicesValue.safeParse(defaultEmbedServices).success).toBe(true);
  });

  it("names the origins of every embed address for the frame policy", () => {
    expect(embedFrameSources(defaultEmbedServices)).toEqual([
      "https://*.sharepoint.com",
      "https://docs.google.com",
      "https://miro.com",
      "https://player.vimeo.com",
      "https://www.figma.com",
      "https://www.loom.com",
      "https://www.youtube-nocookie.com",
    ]);
  });
});

describe("referrer policies", () => {
  it("sends the origin to YouTube only and no referrer to every other default service", () => {
    const policies = new Map(
      [
        "https://youtu.be/dQw4w9WgXcQ",
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        "https://vimeo.com/76979871",
        "https://www.loom.com/share/0281766fa2d04bb788eaf19e65135184",
        "https://www.figma.com/design/abc123/Board",
        "https://miro.com/app/board/uXjVO123=/",
        "https://docs.google.com/document/d/1AbC/edit",
      ].map((link) => [link, embed(link)?.referrerPolicy]),
    );
    expect([...policies.values()]).toEqual([
      "strict-origin",
      "strict-origin",
      "no-referrer",
      "no-referrer",
      "no-referrer",
      "no-referrer",
      "no-referrer",
    ]);
    for (const service of defaultEmbedServices) {
      for (const rule of service.rules) {
        expect(rule.referrerPolicy ?? "no-referrer").toBe(
          service.id === "youtube" ? "strict-origin" : "no-referrer",
        );
      }
    }
  });

  it("uses no referrer for a rule without a policy", () => {
    const service: EmbedService = {
      id: "videos",
      name: "Videos",
      rules: [{ pattern: "https://videos.example.org/w/{id}", embed: "https://videos.example.org/e/{id}" }],
    };
    expect(resolveEmbed("https://videos.example.org/w/8", [service])?.referrerPolicy).toBe("no-referrer");
  });

  it("accepts only the policies that send at most the origin", () => {
    const rule = { pattern: "https://videos.example.org/w/{id}", embed: "https://videos.example.org/e/{id}" };
    const of = (referrerPolicy: string) =>
      embedServicesValue.safeParse([{ id: "videos", name: "Videos", rules: [{ ...rule, referrerPolicy }] }])
        .success;
    expect(of("strict-origin")).toBe(true);
    expect(of("no-referrer")).toBe(true);
    expect(of("unsafe-url")).toBe(false);
    expect(of("origin")).toBe(false);
    expect(of("strict-origin-when-cross-origin")).toBe(false);
  });
});

describe("embed rules", () => {
  it("embeds a link as it is when the embed address repeats the pattern", () => {
    expect(
      matchEmbedRule(
        { pattern: "https://{team}.tools.example.org/{*}", embed: "https://{team}.tools.example.org/{*}" },
        "https://ops.tools.example.org/boards/42/view",
      ),
    ).toBe("https://ops.tools.example.org/boards/42/view");
  });

  it("refuses a host label that is not a plain name", () => {
    const rule = {
      pattern: "https://{team}.tools.example.org/{*}",
      embed: "https://{team}.tools.example.org/{*}",
    };
    expect(matchEmbedRule(rule, "https://a.b.tools.example.org/x")).toBeNull();
    expect(matchEmbedRule(rule, "https://tools.example.org/x")).toBeNull();
  });

  it.each([
    [{ pattern: "http://example.org/{id}", embed: "https://example.org/{id}" }, "https"],
    [{ pattern: "https://example.org/{id}", embed: "http://example.org/{id}" }, "https"],
    [{ pattern: "https://{site}/{id}", embed: "https://example.org/{id}" }, "fixed domain"],
    [{ pattern: "https://{a}.org/{id}", embed: "https://example.org/{id}" }, "fixed domain"],
    [
      { pattern: "https://www.{a}.example.org/{id}", embed: "https://example.org/{id}" },
      "before the fixed domain",
    ],
    [{ pattern: "https://example.org/v{id}", embed: "https://example.org/{id}" }, "whole part"],
    [{ pattern: "https://example.org/{id}", embed: "https://example.org/{other}" }, "does not define"],
    [{ pattern: "https://example.org/{url}", embed: "https://example.org/x" }, "{url}"],
    [{ pattern: "https://example.org/{*}/{*}", embed: "https://example.org/x" }, "at most once"],
    [{ pattern: "https://example.org/x?y={*}", embed: "https://example.org/x" }, "path"],
    [
      { pattern: "https://example.org/{tenant}", embed: "https://{tenant}.example.org/" },
      "host of the pattern",
    ],
    [{ pattern: "https://example.org:8443/{id}", embed: "https://example.org/{id}" }, "https"],
  ])("refuses the rule %j", (rule, message) => {
    expect(embedRuleProblem(rule)).toContain(message);
  });

  it("refuses services that appear twice", () => {
    const [first] = defaultEmbedServices;
    expect(embedServicesValue.safeParse([first, first]).success).toBe(false);
  });
});

describe("organization narrowing", () => {
  it("keeps only services of the instance list that the organization allows", () => {
    const narrowed = narrowEmbedServices(defaultEmbedServices, ["vimeo", "unknown"]);
    expect(narrowed.map((service) => service.id)).toEqual(["vimeo"]);
    expect(resolveEmbed("https://youtu.be/dQw4w9WgXcQ", narrowed)).toBeNull();
    expect(narrowEmbedServices(defaultEmbedServices, null)).toHaveLength(defaultEmbedServices.length);
  });
});

describe("the embed block", () => {
  const context = {
    embed: embed,
    attachment: (id: string) => ({ href: `/api/v1/attachments/${id}/content` }),
  };

  it("accepts only http and https addresses", () => {
    expect(validateDocument(embedDoc({ url: "https://videos.example.net/1" })).ok).toBe(true);
    expect(validateDocument(embedDoc({ url: "mailto:a@example.org" })).ok).toBe(false);
    expect(validateDocument(embedDoc({ url: "/relative" })).ok).toBe(false);
    expect(validateDocument(embedDoc({ url: "javascript:alert(1)" })).ok).toBe(false);
  });

  it("puts the embed address of an allowed link on a frame placeholder without loading it", () => {
    const html = renderHtml(
      embedDoc({ url: "https://youtu.be/dQw4w9WgXcQ", title: "Login", height: 360 }),
      context,
    );
    expect(html).toContain('data-src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"');
    expect(html).toContain('data-height="360"');
    expect(html).toContain('data-referrer-policy="strict-origin"');
    expect(html).toContain("Embedded from YouTube");
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain(" src=");
  });

  it("shows a link with a hint for an address that is not on the allowlist", () => {
    const html = renderHtml(embedDoc({ url: "https://videos.example.net/w/8812" }), context);
    expect(html).toContain('class="ph-embed ph-embed-blocked"');
    expect(html).toContain('href="https://videos.example.net/w/8812"');
    expect(html).toContain("Not on the embed allowlist");
    expect(html).not.toContain("data-src");
  });

  it("shows title and link without a frame when no allowlist is known", () => {
    const html = renderHtml(embedDoc({ url: "https://youtu.be/dQw4w9WgXcQ", title: "Login" }));
    expect(html).toContain(">Login</a>");
    expect(html).not.toContain("data-src");
    expect(html).not.toContain("allowlist");
  });

  it("prints title and link, and the stored thumbnail only when there is one", () => {
    const withThumbnail = embedDoc({
      url: "https://youtu.be/dQw4w9WgXcQ",
      title: "Login",
      thumbnailId: "01929b1e-0000-7000-8000-000000000101",
    });
    const print = renderHtml(withThumbnail, { ...context, target: "print" });
    expect(print).toContain(
      '<img src="/api/v1/attachments/01929b1e-0000-7000-8000-000000000101/content" alt="Login">',
    );
    expect(print).toContain("https://youtu.be/dQw4w9WgXcQ");
    expect(print).not.toContain("data-src");
    const plain = renderHtml(embedDoc({ url: "https://youtu.be/dQw4w9WgXcQ" }), {
      ...context,
      target: "print",
    });
    expect(plain).not.toContain("<img");
    expect(plain).toContain("<strong>youtu.be</strong>");
  });

  it("becomes title and link in Word, with the thumbnail only when stored", () => {
    expect(renderWord(embedDoc({ url: "https://youtu.be/dQw4w9WgXcQ", title: "Login" }), context)).toEqual([
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Login", style: { bold: true } },
          { type: "text", text: " ", style: {} },
          {
            type: "text",
            text: "https://youtu.be/dQw4w9WgXcQ",
            style: { link: "https://youtu.be/dQw4w9WgXcQ" },
          },
        ],
      },
    ]);
    const blocks = renderWord(
      embedDoc({
        url: "https://youtu.be/x",
        title: "Login",
        thumbnailId: "01929b1e-0000-7000-8000-000000000101",
      }),
      context,
    );
    expect(blocks[0]).toMatchObject({ type: "image", attachmentId: "01929b1e-0000-7000-8000-000000000101" });
  });

  it("becomes a link in Markdown", () => {
    expect(renderMarkdown(embedDoc({ url: "https://youtu.be/x", title: "Login" }))).toBe(
      "[Login](https://youtu.be/x)\n",
    );
  });
});
