import { DangerZone, Section } from "@lunedo/ui";
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "../../testing/render.js";
import { SettingsPage } from "./settings-page.js";

function sections(titles: string[], danger = false) {
  return (
    <SettingsPage title="Policies">
      {titles.map((title) => (
        <Section key={title} title={title}>
          <p>Rows of {title}</p>
        </Section>
      ))}
      {danger ? (
        <DangerZone title="Danger zone">
          <p>Delete</p>
        </DangerZone>
      ) : null}
    </SettingsPage>
  );
}

describe("settings pages", () => {
  it("show what is on the page from five sections on, the danger zone included", async () => {
    await renderWithProviders(sections(["Sign-in", "Protection", "API tokens", "Sharing"], true));
    const nav = await screen.findByRole("navigation", { name: "On this page" });
    expect(Array.from(nav.querySelectorAll("a")).map((link) => link.getAttribute("href"))).toEqual([
      "#sign-in",
      "#protection",
      "#api-tokens",
      "#sharing",
      "#danger-zone",
    ]);
    expect(nav.closest("aside")?.className).toContain("hidden");
    expect(nav.closest("aside")?.className).toContain("xl:block");
    expect(document.querySelector("[data-page-width]")?.className).toContain("xl:max-w-page-wide");
  });

  it("show nothing for fewer sections", async () => {
    await renderWithProviders(sections(["Sign-in", "API tokens", "Sharing", "Files"]));
    expect(screen.queryByRole("navigation", { name: "On this page" })).toBeNull();
    expect(document.querySelector("[data-page-width]")?.className).not.toContain("xl:max-w-page-wide");
  });

  it("mark the chosen section and put it into the address", async () => {
    await renderWithProviders(sections(["Sign-in", "Protection", "API tokens", "Sharing", "Files", "Trash"]));
    const nav = await screen.findByRole("navigation", { name: "On this page" });
    const link = Array.from(nav.querySelectorAll("a")).find((entry) => entry.textContent === "Files");
    if (!link) throw new Error("No link to Files");
    fireEvent.click(link);
    expect(window.location.hash).toBe("#files");
    expect(link.getAttribute("aria-current")).toBe("location");
    expect(document.getElementById("files")?.tagName).toBe("SECTION");
  });
});

describe("wizard steps in settings", () => {
  it("never show what is on the page", async () => {
    await renderWithProviders(
      <SettingsPage title="Add a provider" steps>
        {["Type", "Address", "Credentials", "Mapping", "Test"].map((title) => (
          <Section key={title} title={title}>
            <p>{title}</p>
          </Section>
        ))}
      </SettingsPage>,
    );
    expect(await screen.findByRole("heading", { name: "Mapping" })).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "On this page" })).toBeNull();
  });
});

describe("settings pages with fewer than five sections", () => {
  it("do not list them, also with two sections", async () => {
    await renderWithProviders(
      <SettingsPage title="Security">
        <Section title="Sign-in">
          <p>Rows</p>
        </Section>
        <Section title="API tokens">
          <p>Rows</p>
        </Section>
      </SettingsPage>,
    );
    expect(await screen.findByRole("heading", { name: "API tokens" })).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "On this page" })).toBeNull();
  });
});
