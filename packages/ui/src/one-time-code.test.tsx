import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { Field } from "./field.js";
import { OneTimeCodeInput } from "./one-time-code.js";
import { renderUi } from "./testing/render.js";

function Probe() {
  const [code, setCode] = useState("");
  return (
    <>
      <Field label="Code from your authenticator app">
        <OneTimeCodeInput value={code} onValueChange={setCode} />
      </Field>
      <output>{code}</output>
    </>
  );
}

function boxes(): string[] {
  const group = document.querySelector("[data-one-time-code] [aria-hidden=true]");
  return [...(group?.children ?? [])].map((box) => box.textContent ?? "");
}

describe("OneTimeCodeInput", () => {
  it("is one labelled numeric field for one-time codes, shown as six boxes", () => {
    renderUi(<Probe />);
    const input = screen.getByLabelText("Code from your authenticator app");
    expect(input.getAttribute("inputmode")).toBe("numeric");
    expect(input.getAttribute("autocomplete")).toBe("one-time-code");
    expect(boxes()).toEqual(["", "", "", "", "", ""]);
  });

  it("fills every box from a pasted code and drops spaces and dashes", async () => {
    renderUi(<Probe />);
    const input = screen.getByLabelText("Code from your authenticator app");
    await userEvent.click(input);
    await userEvent.paste("123-456 7");
    expect(screen.getByRole("status").textContent).toBe("123456");
    expect(boxes()).toEqual(["1", "2", "3", "4", "5", "6"]);
  });

  it("moves back one box on backspace and ignores letters", async () => {
    renderUi(<Probe />);
    const input = screen.getByLabelText("Code from your authenticator app");
    await userEvent.type(input, "12a3");
    expect(boxes().slice(0, 4)).toEqual(["1", "2", "3", ""]);
    await userEvent.keyboard("{Backspace}");
    expect(boxes().slice(0, 3)).toEqual(["1", "2", ""]);
  });

  it("starts a new code when a digit is typed into a full field", async () => {
    renderUi(<Probe />);
    const input = screen.getByLabelText("Code from your authenticator app");
    await userEvent.type(input, "000000");
    await userEvent.type(input, "12", { skipClick: true });
    expect(screen.getByRole("status").textContent).toBe("12");
    expect(boxes().slice(0, 3)).toEqual(["1", "2", ""]);
  });

  it("selects a full code on focus so that typing replaces it", async () => {
    renderUi(<Probe />);
    const input = screen.getByLabelText<HTMLInputElement>("Code from your authenticator app");
    await userEvent.type(input, "000000");
    input.blur();
    await userEvent.click(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 6]);
    await userEvent.keyboard("987654");
    expect(screen.getByRole("status").textContent).toBe("987654");
  });
});
