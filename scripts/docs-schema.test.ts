import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { allowedValues } from "./docs-schema.ts";

describe("allowedValues", () => {
  it("describes numbers, booleans, choices and text", () => {
    assert.equal(
      allowedValues({ type: "integer", minimum: 1, maximum: 36500 }),
      "A whole number from 1 to 36,500.",
    );
    assert.equal(
      allowedValues({ type: "integer", exclusiveMinimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
      "A whole number of at least 1.",
    );
    assert.equal(allowedValues({ type: "boolean" }), "`true` or `false`.");
    assert.equal(allowedValues({ type: "string", enum: ["a", "b", "c"] }), "`a`, `b` or `c`.");
    assert.equal(allowedValues({ type: "string", maxLength: 60 }), "Text of at most 60 characters.");
    assert.equal(allowedValues({ type: "string", minLength: 32 }), "Text of at least 32 characters.");
    assert.equal(allowedValues({ type: "string", format: "uuid" }), "An ID.");
  });

  it("joins alternatives and describes lists", () => {
    assert.equal(
      allowedValues({ anyOf: [{ type: "integer", minimum: 1, maximum: 10 }, { type: "null" }] }),
      "A whole number from 1 to 10 or none.",
    );
    assert.equal(
      allowedValues({ anyOf: [{ type: "integer", minimum: 1, maximum: 10 }, { const: "unlimited" }] }),
      "A whole number from 1 to 10 or `unlimited`.",
    );
    assert.equal(
      allowedValues({ anyOf: [{ const: "" }, { type: "string", format: "uuid" }] }),
      "Empty or an ID.",
    );
    assert.equal(
      allowedValues({ type: "array", maxItems: 20, items: { type: "string", format: "email" } }),
      "A list of up to 20 entries, each an e-mail address.",
    );
    assert.equal(allowedValues({ type: "object" }), "A structured value.");
  });

  it("leaves out what the schema cannot express", () => {
    assert.equal(allowedValues({ type: "string" }), "");
    assert.equal(allowedValues({}), "");
    assert.equal(allowedValues({ anyOf: [{ type: "string" }, { type: "null" }] }), "");
  });
});
