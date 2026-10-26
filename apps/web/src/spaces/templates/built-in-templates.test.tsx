import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { mockApi, renderWithProviders } from "../../testing/render.js";
import { BuiltInTemplates } from "./built-in-templates.js";

const ORGANIZATION = "01929b1e-0000-7000-8000-0000000000a1";

const teamMeeting = {
  id: "builtin:team-meeting",
  level: "builtIn",
  organizationId: null,
  spaceId: null,
  name: "Team meeting",
  description: "Recurring team meeting with running topics, decisions, tasks and free notes.",
  category: "meetings",
  title: "Team meeting",
  fields: [],
  document: { type: "doc", content: [{ type: "paragraph" }] },
  series: { rhythm: { frequency: "weekly", interval: 1, weekdays: ["MO"] }, durationMinutes: 45 },
  articleType: null,
  updatedAt: null,
};

describe("the built-in templates of an organization", () => {
  it("lists them without a way to change them and duplicates one", async () => {
    mockApi({
      [`GET /api/v1/organizations/${ORGANIZATION}/templates/built-in`]: () => ({ body: [teamMeeting] }),
    });
    const onDuplicate = vi.fn(async () => undefined);
    await renderWithProviders(
      <BuiltInTemplates organizationId={ORGANIZATION} canManage onDuplicate={onDuplicate} />,
    );
    expect(await screen.findByText("Team meeting")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Edit/ })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Duplicate Team meeting" }));
    await waitFor(() =>
      expect(onDuplicate).toHaveBeenCalledWith(expect.objectContaining({ id: teamMeeting.id })),
    );
    expect(
      await screen.findByText("Team meeting was duplicated. The copy is in the list above."),
    ).toBeTruthy();
  });

  it("stays hidden for people who cannot manage templates", async () => {
    const api = mockApi({});
    await renderWithProviders(
      <BuiltInTemplates
        organizationId={ORGANIZATION}
        canManage={false}
        onDuplicate={async () => undefined}
      />,
    );
    expect(screen.queryByText("Built-in templates")).toBeNull();
    expect(api.requests).toHaveLength(0);
  });
});
