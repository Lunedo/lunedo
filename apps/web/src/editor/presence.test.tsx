import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "../testing/render.js";
import { CoEditors } from "./co-editors.js";
import { AvatarStack, cursorColor, presenceColor, selectionAttributes } from "./presence.js";

describe("remote selections", () => {
  it("take the color of the person, also when the caret extension blanks the color name", () => {
    const id = "0192d6f0-0000-7000-8000-000000000001";
    expect(selectionAttributes({ id, name: "Jonas Berger", color: "transparent" })).toEqual({
      class: "ld-remote-selection",
      "data-color": presenceColor(id),
    });
    expect(selectionAttributes({ name: "Unknown", color: "transparent" })["data-color"]).toBe("petrol");
  });
});

describe("co-editors", () => {
  const jonas = { id: "0192d6f0-0000-7000-8000-000000000001", name: "Jonas Berger", color: "red" as const };
  const aylin = { id: "0192d6f0-0000-7000-8000-000000000002", name: "Aylin Demir", color: "red" as const };

  it("show the profile picture when there is one, initials otherwise, in the color of the person", async () => {
    await renderWithProviders(
      <CoEditors others={[jonas, aylin]} pictureOf={(id) => (id === jonas.id ? "v3" : null)} />,
    );
    const pictures = [...document.querySelectorAll("img")].map((image) => image.getAttribute("src"));
    expect(pictures).toEqual([`/api/v1/accounts/${jonas.id}/picture?v=v3`]);
    expect(screen.getByText("AD")).toBeTruthy();
    const avatars = [...document.querySelectorAll<HTMLElement>(".ld-presence-avatar")];
    expect(avatars.map((avatar) => avatar.dataset.color)).toEqual([
      presenceColor(jonas.id),
      presenceColor(aylin.id),
    ]);
  });
});

describe("presence colors", () => {
  it("match the cursor color the whiteboard canvas picks for an account", () => {
    expect(cursorColor("abc")).toBe("hsl(60, 100%, 83%)");
    expect(cursorColor("abc")).toBe(cursorColor("abc"));
  });

  it("show avatars in the given color with readable text", async () => {
    await renderWithProviders(
      <AvatarStack
        self={{ id: "abc", name: "Olivia Owner", color: "petrol" }}
        others={[]}
        colorFor={(user) => cursorColor(user.id)}
      />,
    );
    const avatar = screen.getByText("Olivia Owner").parentElement as HTMLElement;
    expect(avatar.style.getPropertyValue("--presence-color")).toBe("hsl(60, 100%, 83%)");
    expect(avatar.dataset.theme).toBe("light");
    expect(avatar.hasAttribute("data-color")).toBe(false);
  });
});
