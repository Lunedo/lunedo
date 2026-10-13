import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { mockApi, renderWithProviders } from "../testing/render.js";
import { hasActiveFilters, reportFilters, TaskReport } from "./task-report.js";

const SERIES = "01929b1e-0000-7000-8000-0000000000c1";

describe("the task report", () => {
  it("tells apart a report nobody has filtered from one that filters everything out", () => {
    expect(hasActiveFilters(reportFilters({ seriesId: SERIES }))).toBe(false);
    expect(hasActiveFilters(reportFilters({ seriesId: SERIES, status: "done" }))).toBe(true);
    expect(hasActiveFilters(reportFilters({ due: "overdue" }))).toBe(true);
    expect(hasActiveFilters(reportFilters({ assignedToViewer: true }))).toBe(true);
    expect(hasActiveFilters(reportFilters({ labels: ["security"] }))).toBe(true);
  });

  it("does not talk about filters when a new series has no tasks yet", async () => {
    mockApi({
      "GET /api/v1/tasks": () => ({ body: { items: [], nextCursor: null, counts: { open: 0, done: 0 } } }),
    });
    await renderWithProviders(
      <TaskReport filters={reportFilters({ seriesId: SERIES })} currentSpaceId={null} />,
    );
    expect(await screen.findByText("No open tasks")).toBeTruthy();
    expect(
      screen.getByText("Tasks written in the meetings of this series appear here until they are done."),
    ).toBeTruthy();
    expect(screen.queryByText(/filters/)).toBeNull();
  });

  it("asks to change the filters when filtering leaves nothing", async () => {
    mockApi({
      "GET /api/v1/tasks": () => ({ body: { items: [], nextCursor: null, counts: { open: 0, done: 0 } } }),
    });
    await renderWithProviders(
      <TaskReport filters={reportFilters({ seriesId: SERIES, status: "done" })} currentSpaceId={null} />,
    );
    expect(await screen.findByText("No tasks match")).toBeTruthy();
    expect(screen.getByText("Change the filters to see more tasks.")).toBeTruthy();
  });
});
