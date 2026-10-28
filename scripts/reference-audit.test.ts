import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type AuditSource, areaOf, renderAuditEvents } from "./reference-audit.ts";

const source: AuditSource = {
  events: [
    { name: "space.created", target: "space", actors: ["account"], level: "organization", fields: ["name"] },
    {
      name: "auth.signedIn",
      target: "account",
      actors: ["account"],
      level: "organization",
      fields: ["sessionId"],
    },
    {
      name: "auth.groupsClaimMissing",
      target: "identityProvider",
      actors: ["system"],
      level: "instance",
      fields: [],
    },
  ],
  messages: {
    audit: {
      events: {
        space: { created: "Space created" },
        auth: { signedIn: "Signed in", groupsClaimMissing: "Provider sent no groups" },
      },
    },
  },
};

describe("audit event reference", () => {
  it("groups events by the area of their name, both in alphabetical order", () => {
    const page = renderAuditEvents(source);
    assert.deepEqual(
      page.split("\n").filter((line) => line.startsWith("## ")),
      ["## auth", "## space"],
    );
    assert.ok(page.indexOf("`auth.groupsClaimMissing`") < page.indexOf("`auth.signedIn`"));
    assert.equal(areaOf("identityProvider.created"), "identityProvider");
  });

  it("shows the label, target, actors, level and fields of each event", () => {
    const page = renderAuditEvents(source);
    assert.match(
      page,
      /\| `auth\.signedIn` \| Signed in \| `account` \| `account` \| organization \| `sessionId` \|/,
    );
    assert.match(
      page,
      /\| `auth\.groupsClaimMissing` \| Provider sent no groups \| `identityProvider` \| `system` \| instance \| no further fields \|/,
    );
  });
});
