import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "../testing/render.js";
import { AvatarStack, cursorColor } from "./presence.js";

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
