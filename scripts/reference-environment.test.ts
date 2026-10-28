import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  defaultValue,
  type EnvironmentVariable,
  renderEnvironmentVariables,
  variableValues,
} from "./reference-environment.ts";

function variable(patch: Partial<EnvironmentVariable>): EnvironmentVariable {
  return {
    name: "EXAMPLE_PORT",
    topic: "Network",
    description: "Port of the example.",
    secret: false,
    required: false,
    format: null,
    defaultText: null,
    schema: { type: "string" },
    ...patch,
  };
}

describe("environment variable reference", () => {
  it("derives allowed values from the schema unless the code names a format", () => {
    assert.equal(variableValues(variable({ schema: { enum: ["a", "b", "c"] } })), "`a`, `b` or `c`.");
    assert.equal(
      variableValues(variable({ schema: { type: "integer", minimum: 1, maximum: 65535 } })),
      "A whole number from 1 to 65,535.",
    );
    assert.equal(
      variableValues(
        variable({ schema: { type: "integer", exclusiveMinimum: 0, maximum: Number.MAX_SAFE_INTEGER } }),
      ),
      "A whole number of at least 1.",
    );
    assert.equal(
      variableValues(variable({ schema: { type: "string", minLength: 32 } })),
      "Text of at least 32 characters.",
    );
    assert.equal(variableValues(variable({ schema: { type: "string", minLength: 1 } })), "");
    assert.equal(variableValues(variable({ format: "A URL.", schema: { enum: ["ignored"] } })), "A URL.");
  });

  it("shows required, empty, missing and described defaults", () => {
    assert.equal(defaultValue(variable({ required: true })), "required");
    assert.equal(defaultValue(variable({ schema: { default: 3000 } })), "`3000`");
    assert.equal(defaultValue(variable({ schema: { default: "" } })), "empty");
    assert.equal(defaultValue(variable({})), "none");
    assert.equal(defaultValue(variable({ defaultText: "generated", schema: { default: "x" } })), "generated");
  });

  it("groups variables by topic in the order of the code and names the file form of secrets", () => {
    const page = renderEnvironmentVariables([
      variable({
        name: "B_PORT",
        topic: "Network",
        schema: { type: "integer", minimum: 1, maximum: 9, default: 3 },
      }),
      variable({ name: "A_TOKEN", topic: "Secrets", secret: true, description: "Token | with pipe." }),
      variable({ name: "C_HOST", topic: "Network", description: "Host." }),
    ]);
    const sections = page.split("\n## ").slice(1);
    assert.deepEqual(
      sections.map((section) => section.split("\n")[0]),
      ["Network", "Secrets"],
    );
    const network = sections[0] ?? "";
    assert.ok(network.indexOf("`B_PORT`") < network.indexOf("`C_HOST`"));
    assert.match(
      page,
      /\| `B_PORT` \| `3` \| A whole number from 1 to 9\. \| {2}\| Port of the example\. \|/,
    );
    assert.match(
      page,
      /\| `A_TOKEN` \| none \| {2}\| yes, also as `A_TOKEN_FILE` \| Token \\\| with pipe\. \|/,
    );
  });
});
