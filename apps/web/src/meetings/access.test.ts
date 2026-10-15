import { describe, expect, it } from "vitest";
import { peopleWithoutAccess } from "./access.js";

describe("people without access", () => {
  it("leaves out inactive people, since giving them access would not help", () => {
    expect(
      peopleWithoutAccess([
        { id: "lead", active: true, canRead: true },
        { id: "outsider", active: true, canRead: false },
        { id: "deactivated", active: false, canRead: false },
      ]).map((person) => person.id),
    ).toEqual(["outsider"]);
  });
});
