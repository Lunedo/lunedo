import { fireEvent, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../testing/render.js";
import { activeHeading, anchorOf, entryForLegacyAnchor, OnThisPage } from "./on-this-page.js";

function page(count: number) {
  const sections = Array.from({ length: count }, (_, index) => ({
    id: `section-${index + 1}`,
    title: `Section ${index + 1}`,
    Heading: index % 3 === 0 ? ("h1" as const) : index % 3 === 1 ? ("h2" as const) : ("h3" as const),
  }));
  return (
    <div className="ld-read-view">
      {sections.map(({ id, title, Heading }) => (
        <section key={id}>
          <Heading id={id}>{title}</Heading>
          <p>Text</p>
        </section>
      ))}
      <h4 id="deep">Too deep</h4>
    </div>
  );
}

async function render(count: number) {
  const content = createRef<HTMLElement>();
  await renderWithProviders(
    <div>
      <article ref={content}>{page(count)}</article>
      <OnThisPage content={content} />
    </div>,
  );
}

describe("On this page", () => {
  it("follows an anchor written with the earlier slug rule to the heading and updates the address", async () => {
    const titles = ["Geräte", "Straße", "Geräte"];
    const scroll = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scroll;
    window.history.replaceState(null, "", "/#gerate-2");
    const content = createRef<HTMLElement>();
    const ids = titles.map((title, index) =>
      titles.indexOf(title) === index ? anchorOf(title) : `${anchorOf(title)}-2`,
    );
    await renderWithProviders(
      <div>
        <article ref={content}>
          <div className="ld-read-view">
            {titles.map((title, index) => (
              <h2 key={ids[index]} id={ids[index]}>
                {title}
              </h2>
            ))}
          </div>
        </article>
        <OnThisPage content={content} />
      </div>,
    );
    await vi.waitFor(() => expect(scroll).toHaveBeenCalled());
    expect(ids.slice(0, 3)).toEqual(["geraete", "strasse", "geraete-2"]);
    expect(window.location.hash).toBe("#geraete-2");
    expect(scroll).toHaveBeenCalled();
    Element.prototype.scrollIntoView = original;
    window.history.replaceState(null, "", "/");
  });

  it("maps earlier anchors only to headings that produced them", () => {
    const entries = [
      { id: "geraete", title: "Geräte" },
      { id: "strasse", title: "Straße" },
    ];
    expect(entryForLegacyAnchor(entries, "gerate")?.id).toBe("geraete");
    expect(entryForLegacyAnchor(entries, "straße")?.id).toBe("strasse");
    expect(entryForLegacyAnchor(entries, "unknown")).toBeNull();
  });

  it("lists headings 1 to 3 once a page has six or more", async () => {
    await render(6);
    const nav = screen.getByRole("navigation", { name: "On this page" });
    expect(Array.from(nav.querySelectorAll("a")).map((link) => link.textContent)).toEqual([
      "Section 1",
      "Section 2",
      "Section 3",
      "Section 4",
      "Section 5",
      "Section 6",
    ]);
    expect(nav.closest("aside")?.className).toContain("xl:block");
  });

  it("lists only headings 1 and 2 when there are more than 20", async () => {
    await render(21);
    const nav = screen.getByRole("navigation", { name: "On this page" });
    const titles = Array.from(nav.querySelectorAll("a")).map((link) => link.textContent);
    expect(titles).toHaveLength(14);
    expect(titles).not.toContain("Section 3");
    expect(titles.slice(0, 3)).toEqual(["Section 1", "Section 2", "Section 4"]);
  });

  it("keeps all three levels up to 20 headings", async () => {
    await render(20);
    const nav = screen.getByRole("navigation", { name: "On this page" });
    expect(nav.querySelectorAll("a")).toHaveLength(20);
  });

  it("stays away on pages with fewer headings", async () => {
    await render(5);
    expect(screen.queryByRole("navigation", { name: "On this page" })).toBeNull();
  });

  it("scrolls to a section and puts it into the address", async () => {
    await render(6);
    const target = document.getElementById("section-4") as HTMLElement;
    const scroll = vi.fn();
    target.scrollIntoView = scroll;
    fireEvent.click(screen.getByRole("link", { name: "Section 4" }));
    expect(scroll).toHaveBeenCalledWith(expect.objectContaining({ block: "start" }));
    expect(window.location.hash).toBe("#section-4");
    expect(screen.getByRole("link", { name: "Section 4" }).getAttribute("aria-current")).toBe("location");
    expect(screen.getByRole("link", { name: "Section 4" }).className).toContain("min-h-row");
  });

  it("marks the last section that has scrolled past the top", () => {
    const tops = [
      { id: "a", top: -400 },
      { id: "b", top: 40 },
      { id: "c", top: 600 },
    ];
    expect(activeHeading(tops)).toBe("b");
    expect(activeHeading([{ id: "a", top: 300 }])).toBe("a");
  });
});
