import { Button, Field, Input } from "@pagehall/ui";
import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { renderWithProviders } from "../testing/render.js";
import { submitWith, useSchemaForm } from "./use-schema-form.js";

const schema = z.object({ email: z.email() });

function EmailForm() {
  const form = useSchemaForm(schema, { defaultValues: { email: "" } });
  const submit = form.handleSubmit(async () => undefined);
  return (
    <form noValidate onSubmit={submitWith(submit)}>
      <Field label="E-mail" error={form.formState.errors.email?.message}>
        <Input {...form.register("email")} />
      </Field>
      <Button type="submit">Send</Button>
    </form>
  );
}

describe("schema forms", () => {
  it("translates shown validation messages when the language changes", async () => {
    const { i18n } = await renderWithProviders(<EmailForm />);
    await userEvent.type(screen.getByLabelText("E-mail"), "not an address");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("Enter a valid e-mail address.")).toBeTruthy();
    await act(() => i18n.changeLanguage("de"));
    expect(await screen.findByText("Gib eine gültige E-Mail-Adresse ein.")).toBeTruthy();
    expect(screen.queryByText("Enter a valid e-mail address.")).toBeNull();
  });
});
