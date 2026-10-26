import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PreferencesProvider } from "../preferences/preferences-provider.js";
import { mockApi, renderWithProviders } from "../testing/render.js";
import { CreateSeriesDialog } from "./create-series-dialog.js";
import { TopicDialog } from "./topic-form.js";

vi.mock("../shell/shell-context.js", () => {
  const session = { account: { id: "01929b1e-8d4b-7e3f-a05c-4d3e2f1a6b7c", name: "Olivia Owner" } };
  return { useSession: () => session };
});

const SERIES = "01929b1e-0000-7000-8000-0000000000c1";

describe("required fields of the meeting dialogs", () => {
  it("say that an empty topic title is empty and move the focus to it", async () => {
    mockApi({});
    await renderWithProviders(
      <PreferencesProvider>
        <TopicDialog seriesId={SERIES} open onOpenChange={() => undefined} />
      </PreferencesProvider>,
    );
    await userEvent.click(await screen.findByRole("button", { name: "Add" }));
    expect(await screen.findByText("Enter a title for the topic.")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText("Title"));
  });

  it("say that an empty series name is empty and move the focus to it", async () => {
    mockApi({
      "GET /api/v1/spaces/01929b1e-0000-7000-8000-0000000000a1/template-gallery": () => ({ body: [] }),
    });
    await renderWithProviders(
      <PreferencesProvider>
        <CreateSeriesDialog
          space={
            {
              id: "01929b1e-0000-7000-8000-0000000000a1",
              key: "ENG",
              name: "Engineering Handbook",
              personal: false,
            } as never
          }
          open
          onOpenChange={() => undefined}
        />
      </PreferencesProvider>,
    );
    await userEvent.click(await screen.findByRole("button", { name: "Create series" }));
    expect(
      await screen.findByText(/The name is empty\. Enter a name with up to 200 characters\./),
    ).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText("Name"));
  });
});
