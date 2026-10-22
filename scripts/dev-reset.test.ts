import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isConfirmed, resetStatements, testDatabases } from "./dev-reset.ts";

describe("testDatabases", () => {
  it("selects the databases created by tests and keeps everything else", () => {
    assert.deepEqual(
      testDatabases([
        "postgres",
        "lunedo",
        "template1",
        "lunedo_test_1790859955345_f5c37fd5",
        "lunedo_api_test_1790862646122_e72cdee4",
        "lunedo_services_test_1790871327809_816f9b54",
        "lunedo_e2e_1790871327809",
        "lunedo_template_0123456789abcdef",
        "lunedo_template_0123456789abcdef_building",
        "lunedo_template",
        "lunedo_production",
        "lunedo_test",
        "other_test_1790859955345_f5c37fd5",
      ]),
      [
        "lunedo_api_test_1790862646122_e72cdee4",
        "lunedo_e2e_1790871327809",
        "lunedo_services_test_1790871327809_816f9b54",
        "lunedo_template_0123456789abcdef",
        "lunedo_template_0123456789abcdef_building",
        "lunedo_test_1790859955345_f5c37fd5",
      ],
    );
  });
});

describe("resetStatements", () => {
  it("drops the test databases and recreates the development database", () => {
    assert.deepEqual(resetStatements(["lunedo", "postgres", "lunedo_e2e_1790871327809"]), [
      'DROP DATABASE IF EXISTS "lunedo_e2e_1790871327809" WITH (FORCE);',
      'DROP DATABASE IF EXISTS "lunedo" WITH (FORCE);',
      'CREATE DATABASE "lunedo";',
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
