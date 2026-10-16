import type { HocuspocusProvider } from "@hocuspocus/provider";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { PageContextValue } from "../context.js";
import { useOtherEditors } from "./drawing-view.js";

class FakeProvider {
  readonly states = new Map<number, Record<string, unknown>>();
  readonly listeners = new Set<() => void>();
  readonly awareness = { clientID: 1, getStates: () => this.states };
  on(_event: string, listener: () => void) {
    this.listeners.add(listener);
  }
  off(_event: string, listener: () => void) {
    this.listeners.delete(listener);
  }
  set(clientId: number, state: Record<string, unknown>) {
    this.states.set(clientId, state);
    for (const listener of this.listeners) listener();
  }
}

const SELF = { id: "self", name: "Anna Weber", color: "petrol" as const };

function wrapper(provider: FakeProvider) {
  return ({ children }: { children: ReactNode }) => (
    <PageContextValue
      value={{
        pageId: "page",
        spaceId: "space",
        spaceKey: "IT",
        provider: provider as unknown as HocuspocusProvider,
        self: SELF,
      }}
    >
      {children}
    </PageContextValue>
  );
}

describe("people editing a drawing", () => {
  it("are listed for the drawing they edit, never for others or for oneself", () => {
    const provider = new FakeProvider();
    const { result } = renderHook(() => useOtherEditors("block-1"), { wrapper: wrapper(provider) });
    expect(result.current).toEqual([]);
    act(() => provider.set(2, { user: { id: "lukas", name: "Lukas Hofer" }, drawing: "block-1" }));
    act(() => provider.set(3, { user: { id: "julia", name: "Julia Koller" }, drawing: "block-2" }));
    act(() => provider.set(4, { user: { id: "self", name: "Anna Weber" }, drawing: "block-1" }));
    expect(result.current).toEqual(["Lukas Hofer"]);
    act(() => provider.set(2, { user: { id: "lukas", name: "Lukas Hofer" }, drawing: null }));
    expect(result.current).toEqual([]);
  });
});
