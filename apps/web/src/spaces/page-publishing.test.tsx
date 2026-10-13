import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "../testing/render.js";
import type { Draft } from "./content-queries.js";
import { DraftBanner, DraftStatusLine } from "./page-publishing.js";

function draft(names: string[], overrides: Partial<Draft> = {}): Draft {
  return {
    hasChanges: true,
    changes: 4,
    basedOn: 2,
    contributors: names.map((name, index) => ({ id: `0192a000-0000-7000-8000-00000000000${index}`, name })),
    ...overrides,
  } as Draft;
}

describe("the draft banner", () => {
  it("uses the verb that fits one or several people in German", async () => {
    await renderWithProviders(
      <DraftBanner draft={draft(["Olivia Owner", "Bea Berger"])} onOpen={() => undefined} />,
      "de",
    );
    expect(
      screen.getByText(
        "Olivia Owner und Bea Berger haben an einem Entwurf mit 4 unveröffentlichten Änderungen gearbeitet. Du siehst die veröffentlichte Version.",
      ),
    ).toBeTruthy();
  });

  it("keeps the singular for one person and one change in German", async () => {
    await renderWithProviders(
      <DraftBanner draft={draft(["Olivia Owner"], { changes: 1 })} onOpen={() => undefined} />,
      "de",
    );
    expect(
      screen.getByText(
        "Olivia Owner hat an einem Entwurf mit 1 unveröffentlichten Änderung gearbeitet. Du siehst die veröffentlichte Version.",
      ),
    ).toBeTruthy();
  });

  it("names several people in English", async () => {
    await renderWithProviders(
      <DraftBanner draft={draft(["Olivia Owner", "Bea Berger"])} onOpen={() => undefined} />,
    );
    expect(
      screen.getByText(
        "Olivia Owner and Bea Berger worked on a draft with 4 unpublished changes. You see the published version.",
      ),
    ).toBeTruthy();
  });
});

describe("the draft status line", () => {
  it("keeps the separator at the end of the line before it instead of at the start of the next", async () => {
    await renderWithProviders(<DraftStatusLine draft={draft(["Olivia Owner"])} />);
    const line = screen.getByRole("status");
    expect(line.textContent).toContain("since version 2 · Readers see version 2");
  });
});
