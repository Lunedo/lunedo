import { describe, expect, it } from "vitest";
import { Mailpit, testMailpitSmtpPort } from "./mailpit.js";

describe("testMailpitSmtpPort", () => {
  it("reads the published port", () => {
    expect(testMailpitSmtpPort({ PAGEHALL_TEST_MAILPIT_SMTP_PORT: " 40125 " })).toBe(40125);
  });

  it("falls back to the default port outside CI", () => {
    expect(testMailpitSmtpPort({})).toBe(1025);
  });

  it("requires the port in CI", () => {
    expect(() => testMailpitSmtpPort({ CI: "true" })).toThrow(/must be set in CI/);
  });

  it("rejects values that are not ports", () => {
    expect(() => testMailpitSmtpPort({ PAGEHALL_TEST_MAILPIT_SMTP_PORT: "mail" })).toThrow(/port number/);
    expect(() => testMailpitSmtpPort({ PAGEHALL_TEST_MAILPIT_SMTP_PORT: "70000" })).toThrow(/port number/);
  });
});

describe("Mailpit", () => {
  it("takes the SMTP port from the constructor", () => {
    expect(new Mailpit("http://localhost:8025", 41025).smtpPort).toBe(41025);
  });
});
