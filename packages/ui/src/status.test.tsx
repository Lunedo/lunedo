import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UiProvider } from "./labels.js";
import { CodeBlock, ErrorState, SAVED_VISIBLE_MS, SaveStatus } from "./status.js";
import { renderUi, testLabels } from "./testing/render.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("SaveStatus", () => {
  it("announces saving and saved, then hides the confirmation", () => {
    vi.useFakeTimers();
    const { rerender } = renderUi(<SaveStatus state="saving" />);
    expect(screen.getByRole("status").textContent).toBe("Saving");
    rerender(
      <UiProvider labels={testLabels}>
        <SaveStatus state="saved" />
      </UiProvider>,
    );
    expect(screen.getByRole("status").textContent).toBe("Saved");
    act(() => {
      vi.advanceTimersByTime(SAVED_VISIBLE_MS);
    });
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("keeps the confirmation when asked to", () => {
    vi.useFakeTimers();
    renderUi(<SaveStatus state="saved" hideSavedAfter={null} />);
    act(() => {
      vi.advanceTimersByTime(SAVED_VISIBLE_MS * 4);
    });
    expect(screen.getByRole("status").textContent).toBe("Saved");
  });

  it("shows an error with a retry", async () => {
    const retry = vi.fn();
    renderUi(<SaveStatus state="error" error="The value could not be saved." onRetry={retry} />);
    expect(screen.getByRole("alert").textContent).toContain("The value could not be saved.");
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledOnce();
  });
});

describe("ErrorState", () => {
  it("says what failed, why, what to do, and offers the command, documentation and retry", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const retry = vi.fn();
    renderUi(
      <ErrorState
        title="The file store is not writable"
        cause="Lunedo runs as user 1000, which cannot write to /var/lib/lunedo/files."
        action="Give the user ownership of the directory and check again."
        command="chown -R 1000:1000 /var/lib/lunedo/files"
        documentationUrl="https://docs.example.org/files"
        onRetry={retry}
        retryLabel="Check again"
      />,
    );
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("The file store is not writable");
    expect(alert.textContent).toContain("runs as user 1000");
    expect(alert.textContent).toContain("Give the user ownership");
    expect(screen.getByRole("link", { name: "Read the documentation" }).getAttribute("href")).toBe(
      "https://docs.example.org/files",
    );

    await userEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(writeText).toHaveBeenCalledWith("chown -R 1000:1000 /var/lib/lunedo/files");
    expect(await screen.findByText("Copied")).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Check again" }));
    expect(retry).toHaveBeenCalledOnce();
  });
});

describe("CodeBlock", () => {
  it("shows the text and copies it with a named button", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderUi(<CodeBlock value='docker compose logs lunedo | grep "Setup link"' copyLabel="Copy command" />);
    expect(screen.getByText('docker compose logs lunedo | grep "Setup link"')).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Copy command" }));
    expect(writeText).toHaveBeenCalledWith('docker compose logs lunedo | grep "Setup link"');
  });
});
