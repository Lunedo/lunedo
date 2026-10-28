import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from "y-protocols/awareness";
import * as Y from "yjs";
import { renderWithProviders } from "../testing/render.js";
import { CoEditors } from "./co-editors.js";
import {
  AvatarStack,
  claimPresenceColor,
  cursorColor,
  presenceColor,
  publishedColor,
  selectionAttributes,
} from "./presence.js";

const person = (number: number) => `01930000-0000-7000-8000-0000000000${String(number).padStart(2, "0")}`;

function network() {
  const peers: Awareness[] = [];
  const links = new Set<Awareness>();
  const send = (from: Awareness, clients: number[]) => {
    if (!links.has(from)) return;
    const update = encodeAwarenessUpdate(from, clients);
    for (const peer of links) if (peer !== from) applyAwarenessUpdate(peer, update, "remote");
  };
  return {
    join(clientId: number, id: string, linked = true) {
      const doc = new Y.Doc();
      doc.clientID = clientId;
      const awareness = new Awareness(doc);
      awareness.on(
        "update",
        (
          { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
          origin: unknown,
        ) => {
          if (origin !== "remote") send(awareness, [...added, ...updated, ...removed]);
        },
      );
      awareness.setLocalStateField("user", { id, name: id, color: presenceColor(id) });
      peers.push(awareness);
      if (linked) this.link(awareness);
      claimPresenceColor(awareness, { id, name: id });
      return awareness;
    },
    link(awareness: Awareness) {
      links.add(awareness);
      for (const peer of links) {
        if (peer === awareness) continue;
        applyAwarenessUpdate(awareness, encodeAwarenessUpdate(peer, [...peer.getStates().keys()]), "remote");
        applyAwarenessUpdate(peer, encodeAwarenessUpdate(awareness, [awareness.clientID]), "remote");
      }
    },
    close() {
      for (const peer of peers) peer.destroy();
    },
  };
}

function ownColor(awareness: Awareness) {
  return publishedColor(awareness.getLocalState()?.user);
}

function colorsSeenBy(awareness: Awareness) {
  const seen = new Map<number, string>();
  awareness.getStates().forEach((state, clientId) => {
    if (clientId !== awareness.clientID) seen.set(clientId, publishedColor(state.user));
  });
  return seen;
}

function expectSameColorsEverywhere(peers: Awareness[]) {
  for (const viewer of peers) {
    for (const other of peers) {
      if (other !== viewer) expect(colorsSeenBy(viewer).get(other.clientID)).toBe(ownColor(other));
    }
  }
  expect(new Set(peers.map(ownColor)).size).toBe(peers.length);
}

describe("presence colors across clients", () => {
  it("are the same for two people looking at each other, and differ", () => {
    const net = network();
    const lena = net.join(20, person(3));
    const jonas = net.join(10, person(9));
    expect(presenceColor(person(3))).toBe(presenceColor(person(9)));
    expect(ownColor(lena)).toBe("blue");
    expect(ownColor(jonas)).not.toBe("blue");
    expectSameColorsEverywhere([lena, jonas]);
    net.close();
  });

  it("are the same for three people looking at each other, and differ", () => {
    const net = network();
    const peers = [net.join(30, person(3)), net.join(20, person(9)), net.join(10, person(12))];
    expectSameColorsEverywhere(peers);
    net.close();
  });

  it("stay distinct when two people join at the same moment with the same color: the lower client keeps it", () => {
    const net = network();
    const first = net.join(1, person(3), false);
    const second = net.join(2, person(9), false);
    expect(ownColor(first)).toBe("blue");
    expect(ownColor(second)).toBe("blue");
    net.link(first);
    net.link(second);
    expect(ownColor(first)).toBe("blue");
    expect(ownColor(second)).not.toBe("blue");
    expectSameColorsEverywhere([first, second]);
    net.close();
  });

  it("keep the color of the people who stay when someone leaves and someone joins", () => {
    const net = network();
    const lena = net.join(30, person(3));
    const jonas = net.join(20, person(9));
    const kept = ownColor(jonas);
    lena.setLocalState(null);
    expect(ownColor(jonas)).toBe(kept);
    const aylin = net.join(40, person(12));
    expect(ownColor(jonas)).toBe(kept);
    expectSameColorsEverywhere([jonas, aylin]);
    net.close();
  });
});

describe("remote selections", () => {
  it("take the color the person published, also when the caret extension blanks the color name", () => {
    const id = "0192d6f0-0000-7000-8000-000000000001";
    expect(
      selectionAttributes({ id, name: "Jonas Berger", color: "transparent", presence: "amber" }),
    ).toEqual({
      class: "ld-remote-selection",
      "data-color": "amber",
    });
    expect(selectionAttributes({ id, name: "Jonas Berger", color: "transparent" })["data-color"]).toBe(
      presenceColor(id),
    );
    expect(selectionAttributes({ name: "Unknown", color: "transparent" })["data-color"]).toBe("petrol");
  });
});

describe("co-editors", () => {
  const jonas = { id: "0192d6f0-0000-7000-8000-000000000001", name: "Jonas Berger", color: "blue" as const };
  const aylin = { id: "0192d6f0-0000-7000-8000-000000000002", name: "Aylin Demir", color: "amber" as const };

  it("show the profile picture when there is one, initials otherwise, in the color of the person", async () => {
    await renderWithProviders(
      <CoEditors others={[jonas, aylin]} pictureOf={(id) => (id === jonas.id ? "v3" : null)} />,
    );
    const pictures = [...document.querySelectorAll("img")].map((image) => image.getAttribute("src"));
    expect(pictures).toEqual([`/api/v1/accounts/${jonas.id}/picture?v=v3`]);
    expect(screen.getByText("AD")).toBeTruthy();
    const avatars = [...document.querySelectorAll<HTMLElement>(".ld-presence-avatar")];
    expect(avatars.map((avatar) => avatar.dataset.color)).toEqual(["blue", "amber"]);
  });
});

describe("presence colors", () => {
  it("match the cursor color the whiteboard canvas picks for an account", () => {
    expect(cursorColor("abc")).toBe("hsl(60, 100%, 83%)");
    expect(cursorColor("abc")).toBe(cursorColor("abc"));
  });

  it("show avatars in the given color with readable text", async () => {
    await renderWithProviders(
      <AvatarStack
        self={{ id: "abc", name: "Olivia Owner", color: "petrol" }}
        others={[]}
        colorFor={(user) => cursorColor(user.id)}
      />,
    );
    const avatar = screen.getByText("Olivia Owner").parentElement as HTMLElement;
    expect(avatar.style.getPropertyValue("--presence-color")).toBe("hsl(60, 100%, 83%)");
    expect(avatar.dataset.theme).toBe("light");
    expect(avatar.hasAttribute("data-color")).toBe(false);
  });
});

describe("avatars on a whiteboard", () => {
  it("show the profile picture in the cursor color of the person", async () => {
    const self = { id: "0192d6f0-0000-7000-8000-000000000009", name: "Lena Hofer", color: "green" as const };
    await renderWithProviders(
      <AvatarStack
        self={self}
        others={[]}
        colorFor={(user) => cursorColor(user.id)}
        pictureOf={() => "v5"}
      />,
    );
    expect(document.querySelector("img")?.getAttribute("src")).toBe(
      `/api/v1/accounts/${self.id}/picture?v=v5`,
    );
    const avatar = document.querySelector<HTMLElement>(".ld-presence-avatar");
    expect(avatar?.style.getPropertyValue("--presence-color")).toBe(cursorColor(self.id));
  });
});
