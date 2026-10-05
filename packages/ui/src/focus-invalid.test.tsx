import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Field, Input } from "./field.js";
import { focusFirstInvalid, focusFirstInvalidSoon } from "./focus-invalid.js";
import { renderUi } from "./testing/render.js";

describe("focusFirstInvalid", () => {
  it("moves focus to the first field marked invalid, in document order", async () => {
    renderUi(
      <form>
        <Field label="Name">
          <Input />
        </Field>
        <Field label="Server" error="Enter the server address.">
          <Input />
        </Field>
        <Field label="Port" error="Enter a port.">
          <Input />
        </Field>
      </form>,
    );
    expect(focusFirstInvalid()).toBe(true);
    expect(document.activeElement).toBe(screen.getByLabelText("Server"));
    (document.activeElement as HTMLElement).blur();
    focusFirstInvalidSoon();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Server")));
  });

  it("reports when nothing is invalid", () => {
    renderUi(
      <Field label="Name">
        <Input />
      </Field>,
    );
    expect(focusFirstInvalid()).toBe(false);
  });
});
