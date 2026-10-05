import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "../../../testing/render.js";
import { InstanceStep } from "./instance-step.js";

describe("the instance step", () => {
  it("warns about an address without HTTPS unless it is a loopback address", async () => {
    await renderWithProviders(
      <InstanceStep
        details={{
          url: "",
          name: "Pagehall",
          suggestedUrl: "http://localhost:5173",
          urlFromEnvironment: false,
        }}
        back={null}
        onDone={async () => undefined}
        refresh={async () => undefined}
      />,
    );
    expect(screen.queryByText("The address does not use HTTPS")).toBeNull();
    const address = screen.getByLabelText("Address");
    await userEvent.clear(address);
    await userEvent.type(address, "http://wiki.example.org");
    expect(await screen.findByText("The address does not use HTTPS")).toBeTruthy();
    await userEvent.clear(address);
    await userEvent.type(address, "https://wiki.example.org");
    expect(screen.queryByText("The address does not use HTTPS")).toBeNull();
  });

  it("shows an address from the server environment as read-only", async () => {
    await renderWithProviders(
      <InstanceStep
        details={{
          url: "https://old.example.org",
          name: "Pagehall",
          suggestedUrl: "https://wiki.example.org",
          urlFromEnvironment: true,
        }}
        back={null}
        onDone={async () => undefined}
        refresh={async () => undefined}
      />,
    );
    const address = screen.getByLabelText("Address") as HTMLInputElement;
    expect(address.value).toBe("https://wiki.example.org");
    expect(address.readOnly).toBe(true);
    expect(screen.getByText(/Set by PAGEHALL_INSTANCE_URL/)).toBeTruthy();
  });
});
