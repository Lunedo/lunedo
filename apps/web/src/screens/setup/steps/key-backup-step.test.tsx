import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { mockApi, renderWithProviders } from "../../../testing/render.js";
import { KeyBackupStep } from "./key-backup-step.js";

function renderStep(downloaded: boolean) {
  const onDone = vi.fn(async () => undefined);
  const result = renderWithProviders(
    <KeyBackupStep
      completed={false}
      details={{ downloaded } as never}
      back={null}
      onDone={onDone}
      refresh={async () => undefined}
    />,
  );
  return { onDone, result };
}

describe("KeyBackupStep", () => {
  it("keeps Continue usable and points to the download while the keys are not downloaded", async () => {
    mockApi({});
    const { onDone, result } = renderStep(false);
    await result;
    const next = screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement;
    expect(next.disabled).toBe(false);
    await userEvent.click(next);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Download keys" }));
    expect(screen.getByText(/Download the keys first/)).toBeTruthy();
    expect(onDone).not.toHaveBeenCalled();
  });

  it("asks to confirm that the keys are stored before it continues", async () => {
    const { requests } = mockApi({});
    const { onDone, result } = renderStep(true);
    await result;
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(document.activeElement).toBe(screen.getByRole("checkbox"));
    expect(screen.getByRole("checkbox").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText(/Confirm that you stored the keys/)).toBeTruthy();
    expect(requests).toHaveLength(0);
    expect(onDone).not.toHaveBeenCalled();
  });
});
