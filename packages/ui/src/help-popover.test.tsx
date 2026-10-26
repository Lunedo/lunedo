import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Field } from "./field.js";
import { SettingRow } from "./layout.js";
import { renderUi } from "./testing/render.js";

const explanation = "Older versions are deleted after this many days, unless someone kept them.";

describe("the help next to a setting", () => {
  it("opens on click and closes with Escape and a click outside", async () => {
    renderUi(
      <>
        <SettingRow
          label="Retention"
          description="How long old versions stay."
          help={explanation}
          control={<button type="button">Change</button>}
        />
        <p>Outside</p>
      </>,
    );
    expect(screen.queryByText(explanation)).toBeNull();
    const button = screen.getByRole("button", { name: "More about: Retention" });
    await userEvent.click(button);
    expect(await screen.findByText(explanation)).toBeTruthy();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByText(explanation)).toBeNull());
    await userEvent.click(button);
    expect(await screen.findByText(explanation)).toBeTruthy();
    await userEvent.click(screen.getByText("Outside"));
    await waitFor(() => expect(screen.queryByText(explanation)).toBeNull());
  });

  it("opens from the keyboard next to the label of a field", async () => {
    renderUi(
      <Field label="Address" hint="Where people reach you." help={explanation}>
        <input />
      </Field>,
    );
    await userEvent.tab();
    expect(document.activeElement?.getAttribute("aria-label")).toBe("More about: Address");
    await userEvent.keyboard("{Enter}");
    expect(await screen.findByText(explanation)).toBeTruthy();
  });
});
