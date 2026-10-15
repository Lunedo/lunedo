import { describe, expect, it, vi } from "vitest";

vi.mock("nodemailer", () => ({
  createTransport: () => ({
    sendMail: () => Promise.reject(Object.assign(new Error("Connection timeout"), { code: "ETIMEDOUT" })),
    close: () => undefined,
  }),
}));

describe("SMTP connect limit", () => {
  it("reports a connection that is never accepted as a connect timeout", async () => {
    const { SmtpTimeoutError, SmtpTransport } = await import("./transport.js");
    const error = await new SmtpTransport({
      host: "192.0.2.1",
      port: 25,
      security: "none",
      username: null,
      password: null,
      from: "wiki@example.org",
    })
      .send({ to: "to@example.org", subject: "Test", text: "Test", html: "<p>Test</p>" })
      .catch((e) => e);
    expect(error).toBeInstanceOf(SmtpTimeoutError);
    expect(error.code).toBe("SMTP_CONNECT_TIMEOUT");
  });
});
