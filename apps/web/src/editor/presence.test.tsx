import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "../testing/render.js";
import { CoEditors } from "./co-editors.js";
import {
  AvatarStack,
  assignPresenceColors,
  cursorColor,
  PresencePalette,
  presenceColor,
  presenceColors,
  selectionAttributes,
} from "./presence.js";

const person = (number: number) => `01930000-0000-7000-8000-0000000000${String(number).padStart(2, "0")}`;

describe("presence color assignment", () => {
  it("gives everyone on the page a different color while the palette has enough", () => {
    const ids = [3, 9, 12, 30, 36, 45].map(person);
    expect(new Set(ids.map(presenceColor)).size).toBe(1);
    const colors = assignPresenceColors(new Map(), ids);
    expect(new Set(colors.values()).size).toBe(presenceColors.length);
  });

  it("keeps the color of the people who stay when someone joins", () => {
    const first = assignPresenceColors(new Map(), [person(3), person(4)]);
    const second = assignPresenceColors(first, [person(3), person(4), person(9), person(12)]);
    expect(second.get(person(3))).toBe(first.get(person(3)));
    expect(second.get(person(4))).toBe(first.get(person(4)));
    expect(new Set(second.values()).size).toBe(4);
  });

  it("frees the color of someone who leaves for the next person", () => {
    const first = assignPresenceColors(new Map(), [person(3), person(9)]);
    expect(first.get(person(3))).toBe("blue");
    const left = assignPresenceColors(first, [person(9)]);
    expect(left.get(person(9))).toBe(first.get(person(9)));
    expect(left.has(person(3))).toBe(false);
    expect(assignPresenceColors(left, [person(9), person(12)]).get(person(12))).toBe("blue");
  });

  it("gives the same color to selections and cursors through the palette of the page", () => {
    let present = [person(3), person(9)];
    const palette = new PresencePalette(() => present);
    const jonas = palette.colorOf(person(3));
    const aylin = palette.colorOf(person(9));
    expect(aylin).not.toBe(jonas);
    expect(selectionAttributes({ id: person(9), color: "transparent" }, palette)["data-color"]).toBe(aylin);
    present = [person(9)];
    expect(palette.colorOf(person(9))).toBe(aylin);
  });
});

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
  const jonas = { id: "0192d6f0-0000-7000-8000-000000000001", name: "Jonas Berger", color: "blue" as const };
  const aylin = { id: "0192d6f0-0000-7000-8000-000000000002", name: "Aylin Demir", color: "amber" as const };

  it("show the profile picture when there is one, initials otherwise, in the color of the person", async () => {
    await renderWithProviders(
      <CoEditors others={[jonas, aylin]} pictureOf={(id) => (id === jonas.id ? "v3" : null)} />,
    );
    const pictures = [...document.querySelectorAll("img")].map((image) => image.getAttribute("src"));
    expect(pictures).toEqual([`/api/v1/accounts/${jonas.id}/picture?v=v3`]);
    expect(screen.getByText("AD")).toBeTruthy();
    const avatars = [...document.querySelectorAll<HTMLElement>(".ld-presence-avatar")];
    expect(avatars.map((avatar) => avatar.dataset.color)).toEqual(["blue", "amber"]);
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

describe("avatars on a whiteboard", () => {
  it("show the profile picture in the cursor color of the person", async () => {
    const self = { id: "0192d6f0-0000-7000-8000-000000000009", name: "Lena Hofer", color: "green" as const };
    await renderWithProviders(
      <AvatarStack
        self={self}
        others={[]}
        colorFor={(user) => cursorColor(user.id)}
        pictureOf={() => "v5"}
      />,
    );
    expect(document.querySelector("img")?.getAttribute("src")).toBe(
      `/api/v1/accounts/${self.id}/picture?v=v5`,
    );
    const avatar = document.querySelector<HTMLElement>(".ld-presence-avatar");
    expect(avatar?.style.getPropertyValue("--presence-color")).toBe(cursorColor(self.id));
  });
});
