import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { coversOwnChanges, decodeBase64, SaveTracker, TYPING_PAUSE_MS } from "./save-state.js";

function encode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

describe("coversOwnChanges", () => {
  it("is true only when the stored state contains this client's latest change", () => {
    const doc = new Y.Doc();
    const text = doc.getText("t");
    text.insert(0, "a");
    const stored = Y.encodeStateVector(doc);
    expect(coversOwnChanges(doc, stored)).toBe(true);
    text.insert(1, "b");
    expect(coversOwnChanges(doc, stored)).toBe(false);
    expect(coversOwnChanges(doc, decodeBase64(encode(Y.encodeStateVector(doc))))).toBe(true);
  });

  it("ignores the changes of other clients", () => {
    const own = new Y.Doc();
    const other = new Y.Doc();
    other.getText("t").insert(0, "theirs");
    Y.applyUpdate(own, Y.encodeStateAsUpdate(other));
    expect(coversOwnChanges(own, new Uint8Array([0]))).toBe(true);
  });
});

describe("SaveTracker", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("moves from editing to saving to saved only after the server stored the change", () => {
    const doc = new Y.Doc();
    const tracker = new SaveTracker(doc);
    const states: string[] = [];
    tracker.subscribe((state) => states.push(state));
    tracker.connection(true);
    const before = Y.encodeStateVector(doc);
    doc.getText("t").insert(0, "hello");
    tracker.localChange();
    expect(tracker.state).toBe("editing");
    vi.advanceTimersByTime(TYPING_PAUSE_MS);
    expect(tracker.state).toBe("saving");
    tracker.unsyncedChanges(0);
    tracker.saved(before);
    expect(tracker.state).toBe("saving");
    tracker.saved(Y.encodeStateVector(doc));
    expect(tracker.state).toBe("saved");
    expect(tracker.hasUnsavedChanges).toBe(false);
    expect(states).toEqual(["editing", "saving", "saved"]);
  });

  it("does not count a store that happened before the server received the change", () => {
    const doc = new Y.Doc();
    const tracker = new SaveTracker(doc);
    tracker.connection(true);
    doc.getText("t").insert(0, "x");
    tracker.localChange();
    vi.advanceTimersByTime(TYPING_PAUSE_MS);
    tracker.saved(Y.encodeStateVector(doc));
    expect(tracker.state).toBe("saving");
  });

  it("shows offline and errors", () => {
    const tracker = new SaveTracker(new Y.Doc());
    expect(tracker.state).toBe("saved");
    tracker.connection(false);
    expect(tracker.state).toBe("offline");
    tracker.connection(true);
    tracker.saveFailed();
    expect(tracker.state).toBe("error");
    tracker.saved(new Uint8Array([0]));
    expect(tracker.state).toBe("saved");
  });
});
