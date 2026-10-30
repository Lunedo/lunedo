import type { FastifyRequest } from "fastify";
import { describe, expect, it } from "vitest";
import { requestInfo } from "./setup.controller.js";

function request(options: { forwardedFor?: string; ip: string; remoteAddress: string }): FastifyRequest {
  return {
    protocol: "http",
    host: "lunedo.test",
    headers: options.forwardedFor === undefined ? {} : { "x-forwarded-for": options.forwardedFor },
    ip: options.ip,
    socket: { remoteAddress: options.remoteAddress },
  } as unknown as FastifyRequest;
}

describe("the request information of the setup", () => {
  it("flags a forwarded client address that was ignored because the sender is not a trusted proxy", () => {
    const info = requestInfo(
      request({ forwardedFor: "203.0.113.9", ip: "172.30.0.10", remoteAddress: "172.30.0.10" }),
    );
    expect(info.forwardedFromUntrusted).toBe(true);
  });

  it("does not flag a forwarded client address from a trusted proxy", () => {
    const info = requestInfo(
      request({ forwardedFor: "203.0.113.9", ip: "203.0.113.9", remoteAddress: "172.30.0.10" }),
    );
    expect(info.forwardedFromUntrusted).toBe(false);
  });

  it("does not flag a request without a forwarded client address", () => {
    const info = requestInfo(request({ ip: "172.30.0.10", remoteAddress: "172.30.0.10" }));
    expect(info.forwardedFromUntrusted).toBe(false);
  });
});
