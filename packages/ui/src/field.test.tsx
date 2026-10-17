import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { Checkbox, RadioGroup, Switch } from "./controls.js";
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
    expect(document.getElementById(described[0] ?? "")?.querySelector("svg")).not.toBeNull();
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

  it("keeps a switch with a reason focusable, explains it and ignores changes", async () => {
    const changes: boolean[] = [];
    renderUi(
      <Switch
        checked={false}
        onCheckedChange={(next) => changes.push(next)}
        label="Two-factor authentication"
        disabled
        disabledReason="Locked by the instance"
      />,
    );
    const toggle = screen.getByRole("switch", { name: "Two-factor authentication" });
    expect(toggle.hasAttribute("disabled")).toBe(false);
    expect(toggle.getAttribute("aria-disabled")).toBe("true");
    expect(toggle.hasAttribute("data-disabled")).toBe(true);
    const described = document.getElementById(toggle.getAttribute("aria-describedby") ?? "");
    expect(described?.textContent).toBe("Locked by the instance");
    await userEvent.tab();
    expect(document.activeElement).toBe(toggle);
    expect((await screen.findAllByText("Locked by the instance")).length).toBeGreaterThan(1);
    await userEvent.keyboard(" ");
    await userEvent.click(toggle);
    expect(changes).toEqual([]);
    expect(toggle.getAttribute("aria-checked")).toBe("false");
  });

  it("disables a switch without a reason natively and marks the off state with a visible border", () => {
    renderUi(<Switch checked={false} onCheckedChange={() => {}} label="Locked" disabled />);
    const toggle = screen.getByRole("switch", { name: "Locked" });
    expect(toggle.hasAttribute("disabled")).toBe(true);
    expect(toggle.className).toContain("border-control-border");
    expect(toggle.className).toContain("data-disabled:bg-surface-sunken");
    expect(toggle.className).toContain("data-disabled:cursor-not-allowed");
  });
});

describe("Checkbox and radio borders", () => {
  it("use the control border that keeps 3:1 contrast", () => {
    renderUi(
      <>
        <Checkbox checked={false} onCheckedChange={() => {}} label="Notify me" />
        <RadioGroup
          label="Expiry"
          value="never"
          onValueChange={() => {}}
          options={[
            { value: "never", label: "No expiry" },
            { value: "days30", label: "30 days" },
          ]}
        />
      </>,
    );
    expect(screen.getByRole("checkbox", { name: "Notify me" }).className).toContain("border-control-border");
    expect(screen.getByRole("radio", { name: "30 days" }).className).toContain("border-control-border");
  });
});

describe("Hit areas of small controls", () => {
  it("reach the minimum target size without growing the control", () => {
    renderUi(
      <>
        <Checkbox checked={false} onCheckedChange={() => {}} label="Notify me" />
        <Switch checked={false} onCheckedChange={() => {}} label="Reading-friendly font" />
        <RadioGroup
          label="Expiry"
          value="never"
          onValueChange={() => {}}
          options={[{ value: "never", label: "No expiry" }]}
        />
      </>,
    );
    for (const control of [
      screen.getByRole("checkbox", { name: "Notify me" }),
      screen.getByRole("radio", { name: "No expiry" }),
    ]) {
      expect(control.className).toContain("after:size-hit");
      expect(control.className).toContain("size-4");
    }
    const toggle = screen.getByRole("switch", { name: "Reading-friendly font" });
    expect(toggle.className).toContain("after:h-hit");
    expect(toggle.className).toContain("after:min-w-hit");
  });
});

describe("Disabled radio options", () => {
  it("cannot be chosen and keep their description visible", async () => {
    const chosen: string[] = [];
    const user = userEvent.setup();
    renderUi(
      <RadioGroup
        label="What to export"
        value="page"
        onValueChange={(value) => chosen.push(value)}
        options={[
          { value: "page", label: "This page" },
          { value: "space", label: "The whole space", description: "Only space admins", disabled: true },
        ]}
      />,
    );
    const space = screen.getByRole("radio", { name: /The whole space/ });
    expect(space.hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("Only space admins")).toBeTruthy();
    await user.click(space);
    expect(chosen).toEqual([]);
  });
});
