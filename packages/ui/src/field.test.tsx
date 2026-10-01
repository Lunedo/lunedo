import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { Checkbox, Switch } from "./controls.js";
import { Field, Input, PasswordInput, Textarea } from "./field.js";
import { renderUi } from "./testing/render.js";

describe("Field", () => {
  it("labels its control and links hint and error", () => {
    renderUi(
      <Field label="E-mail" hint="We never share it." error="Enter an e-mail address." required>
        <Input type="email" />
      </Field>,
    );
    const input = screen.getByLabelText("E-mail");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-required")).toBe("true");
    const described = (input.getAttribute("aria-describedby") ?? "").split(" ");
    const texts = described.map((id) => document.getElementById(id)?.textContent);
    expect(texts).toEqual(["Enter an e-mail address.", "We never share it."]);
  });

  it("leaves a control without a field untouched", () => {
    renderUi(<Input aria-label="Search" />);
    const input = screen.getByRole("textbox", { name: "Search" });
    expect(input.hasAttribute("aria-invalid")).toBe(false);
  });

  it("wires a text area", () => {
    renderUi(
      <Field label="Reason">
        <Textarea />
      </Field>,
    );
    expect(screen.getByLabelText("Reason").tagName).toBe("TEXTAREA");
  });
});

describe("PasswordInput", () => {
  it("shows and hides the password", async () => {
    renderUi(
      <Field label="Password">
        <PasswordInput />
      </Field>,
    );
    const input = screen.getByLabelText("Password");
    expect(input.getAttribute("type")).toBe("password");
    await userEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(input.getAttribute("type")).toBe("text");
    await userEvent.click(screen.getByRole("button", { name: "Hide password" }));
    expect(input.getAttribute("type")).toBe("password");
  });
});

function CheckboxProbe() {
  const [checked, setChecked] = useState(false);
  return <Checkbox checked={checked} onCheckedChange={setChecked} label="I stored both keys" />;
}

function SwitchProbe() {
  const [checked, setChecked] = useState(false);
  return <Switch checked={checked} onCheckedChange={setChecked} label="Reading-friendly font" />;
}

describe("Checkbox and Switch", () => {
  it("toggle through their label and the keyboard", async () => {
    renderUi(
      <>
        <CheckboxProbe />
        <SwitchProbe />
      </>,
    );
    const checkbox = screen.getByRole("checkbox", { name: "I stored both keys" });
    await userEvent.click(screen.getByText("I stored both keys"));
    expect(checkbox.getAttribute("aria-checked")).toBe("true");

    const toggle = screen.getByRole("switch", { name: "Reading-friendly font" });
    toggle.focus();
    await userEvent.keyboard(" ");
    expect(toggle.getAttribute("aria-checked")).toBe("true");
  });
});
