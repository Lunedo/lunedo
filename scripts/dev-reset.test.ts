import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isConfirmed, resetStatements, testDatabases } from "./dev-reset.ts";

describe("testDatabases", () => {
  it("selects the databases created by tests and keeps everything else", () => {
    assert.deepEqual(
      testDatabases([
        "postgres",
        "pagehall",
        "template1",
        "pagehall_test_1790859955345_f5c37fd5",
        "pagehall_api_test_1790862646122_e72cdee4",
        "pagehall_services_test_1790871327809_816f9b54",
        "pagehall_e2e_1790871327809",
        "pagehall_template_0123456789abcdef",
        "pagehall_template_0123456789abcdef_building",
        "pagehall_template",
        "pagehall_production",
        "pagehall_test",
        "other_test_1790859955345_f5c37fd5",
      ]),
      [
        "pagehall_api_test_1790862646122_e72cdee4",
        "pagehall_e2e_1790871327809",
        "pagehall_services_test_1790871327809_816f9b54",
        "pagehall_template_0123456789abcdef",
        "pagehall_template_0123456789abcdef_building",
        "pagehall_test_1790859955345_f5c37fd5",
      ],
    );
  });
});

describe("resetStatements", () => {
  it("drops the test databases and recreates the development database", () => {
    assert.deepEqual(resetStatements(["pagehall", "postgres", "pagehall_e2e_1790871327809"]), [
      'DROP DATABASE IF EXISTS "pagehall_e2e_1790871327809" WITH (FORCE);',
      'DROP DATABASE IF EXISTS "pagehall" WITH (FORCE);',
      'CREATE DATABASE "pagehall";',
    ]);
  });
});

describe("isConfirmed", () => {
  it("accepts only the confirmation word", () => {
    assert.equal(isConfirmed(" Reset\n"), true);
    assert.equal(isConfirmed("y"), false);
    assert.equal(isConfirmed(""), false);
  });
});
