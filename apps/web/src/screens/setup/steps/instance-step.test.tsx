import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "../../../testing/render.js";
import { InstanceStep } from "./instance-step.js";

describe("the instance step", () => {
  it("takes the address from the current URL and leaves the HTTPS check to the system check", async () => {
    await renderWithProviders(
      <InstanceStep
        completed={false}
        details={{
          url: "",
          name: "Lunedo",
          suggestedUrl: "http://wiki.example.org",
          urlFromEnvironment: false,
        }}
        back={null}
        onDone={async () => undefined}
        refresh={async () => undefined}
      />,
    );
    expect((screen.getByLabelText("Address") as HTMLInputElement).value).toBe("http://wiki.example.org");
    expect(
      screen.getByText("Taken from the current address. Used in links, e-mails and for passkeys."),
    ).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows an address from the server environment as locked text, not as a field", async () => {
    await renderWithProviders(
      <InstanceStep
        completed={false}
        details={{
          url: "https://old.example.org",
          name: "Lunedo",
          suggestedUrl: "https://wiki.example.org",
          urlFromEnvironment: true,
        }}
        back={null}
        onDone={async () => undefined}
        refresh={async () => undefined}
      />,
    );
    expect(screen.queryByLabelText("Address")).toBeNull();
    expect(screen.queryByRole("textbox", { name: /address/i })).toBeNull();
    expect(screen.getByText("https://wiki.example.org")).toBeTruthy();
    expect(screen.getByText("Locked:")).toBeTruthy();
    expect(screen.getByText(/Set by LUNEDO_INSTANCE_URL/)).toBeTruthy();
  });
});
