import { afterEach, describe, expect, it } from "vitest";
import { type RunningFake, serveFake } from "../testing/fakes/http.js";
import {
  isPublicAddress,
  OutboundError,
  type OutboundPolicy,
  outboundPolicy,
  type Resolver,
  sendOutbound,
} from "./guarded-request.js";

const running: RunningFake[] = [];

afterEach(async () => {
  await Promise.all(running.splice(0).map((fake) => fake.close()));
});

async function fake(handler: Parameters<typeof serveFake>[0]): Promise<{ url: string; port: string }> {
  const server = await serveFake(handler);
  running.push(server);
  return { url: server.url, port: new URL(server.url).port };
}

function resolver(table: Record<string, string[]>): Resolver {
  return async (hostname) =>
    (table[hostname] ?? []).map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
}

async function failure(policy: OutboundPolicy, url: string): Promise<string> {
  try {
    await sendOutbound(policy, { url, method: "POST", headers: {}, body: "{}" });
  } catch (error) {
    if (error instanceof OutboundError) return error.reason;
    throw error;
  }
  return "sent";
}

describe("isPublicAddress", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.20.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "255.255.255.255",
    "::1",
    "::",
    "fe80::1",
    "fc00::1",
    "fd12:3456::1",
    "ff02::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "::ffff:169.254.169.254",
    "64:ff9b::a00:1",
    "2002:7f00:1::",
    "2001:db8::1",
  ])("treats %s as not public", (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each(["93.184.216.34", "1.1.1.1", "2606:4700:4700::1111", "::ffff:93.184.216.34"])(
    "treats %s as public",
    (address) => {
      expect(isPublicAddress(address)).toBe(true);
    },
  );
});

describe("sendOutbound", () => {
  it("refuses loopback, private and link-local targets by name and by address", async () => {
    let reached = 0;
    const target = await fake(() => {
      reached += 1;
      return { status: 200 };
    });
    const policy = outboundPolicy(
      [],
      resolver({
        "hooks.example.com": ["127.0.0.1"],
        "mixed.example.com": ["93.184.216.34", "10.0.0.1"],
        "metadata.example.com": ["169.254.169.254"],
      }),
    );
    expect(await failure(policy, target.url)).toBe("blockedAddress");
    expect(await failure(policy, `http://hooks.example.com:${target.port}/`)).toBe("blockedAddress");
    expect(await failure(policy, `https://mixed.example.com/`)).toBe("blockedAddress");
    expect(await failure(policy, `https://metadata.example.com/`)).toBe("blockedAddress");
    expect(await failure(policy, `http://[::1]:${target.port}/`)).toBe("blockedAddress");
    expect(await failure(policy, `http://[::ffff:127.0.0.1]:${target.port}/`)).toBe("blockedAddress");
    expect(await failure(policy, `http://2130706433:${target.port}/`)).toBe("blockedAddress");
    expect(reached).toBe(0);
  });

  it("reaches networks the instance allows explicitly", async () => {
    const received: string[] = [];
    const target = await fake((request) => {
      received.push(`${request.method} ${request.url.pathname} ${request.body}`);
      return { status: 200, body: { ok: true } };
    });
    const policy = outboundPolicy(["127.0.0.0/8"], resolver({ "chat.internal": ["127.0.0.1"] }));
    const response = await sendOutbound(policy, {
      url: `http://chat.internal:${target.port}/hook`,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"a":1}',
    });
    expect(response.status).toBe(200);
    expect(received).toEqual(['POST /hook {"a":1}']);
  });

  it("checks the address at connection time, so a changed DNS answer is refused", async () => {
    const target = await fake(() => ({ status: 200 }));
    const answers = [["127.0.0.2"], ["127.0.0.1"]];
    const policy = outboundPolicy(["127.0.0.2/32"], async () =>
      (answers.shift() ?? []).map((address) => ({ address, family: 4 })),
    );
    const first = await failure(policy, `http://rebind.example.com:${target.port}/`);
    expect(first).not.toBe("blockedAddress");
    expect(await failure(policy, `http://rebind.example.com:${target.port}/`)).toBe("blockedAddress");
  });

  it("checks every redirect and keeps the token on the same origin only", async () => {
    const seen: { path: string; authorization: string | undefined }[] = [];
    const inside = await fake((request) => {
      seen.push({ path: request.url.pathname, authorization: request.headers.authorization });
      return { status: 200 };
    });
    const hop = await fake((request) => {
      seen.push({ path: request.url.pathname, authorization: request.headers.authorization });
      if (request.url.pathname === "/same") return { status: 307, headers: { location: "/final" } };
      if (request.url.pathname === "/final") return { status: 200 };
      if (request.url.pathname === "/private") {
        return { status: 308, headers: { location: `http://10.0.0.5:${inside.port}/` } };
      }
      if (request.url.pathname === "/loop") return { status: 307, headers: { location: "/loop" } };
      return { status: 307, headers: { location: `http://other.internal:${inside.port}/other` } };
    });
    const policy = outboundPolicy(
      ["127.0.0.0/8"],
      resolver({ "hook.internal": ["127.0.0.1"], "other.internal": ["127.0.0.1"] }),
    );
    const send = (path: string) =>
      sendOutbound(policy, {
        url: `http://hook.internal:${hop.port}${path}`,
        method: "POST",
        headers: { authorization: "Bearer secret" },
        body: "{}",
      });

    expect((await send("/same")).status).toBe(200);
    expect(seen.splice(0)).toEqual([
      { path: "/same", authorization: "Bearer secret" },
      { path: "/final", authorization: "Bearer secret" },
    ]);

    expect((await send("/elsewhere")).status).toBe(200);
    expect(seen.splice(0)).toEqual([
      { path: "/elsewhere", authorization: "Bearer secret" },
      { path: "/other", authorization: undefined },
    ]);

    await expect(send("/private")).rejects.toMatchObject({ reason: "blockedAddress" });
    expect(seen.splice(0).map((entry) => entry.path)).toEqual(["/private"]);

    await expect(send("/loop")).rejects.toMatchObject({ reason: "tooManyRedirects" });
  });

  it("needs HTTPS for public addresses and refuses other schemes and credentials", async () => {
    const policy = outboundPolicy([], resolver({ "hooks.example.com": ["93.184.216.34"] }));
    expect(await failure(policy, "http://hooks.example.com/")).toBe("insecureAddress");
    expect(await failure(policy, "ftp://hooks.example.com/")).toBe("invalidAddress");
    expect(await failure(policy, "https://user:pass@hooks.example.com/")).toBe("invalidAddress");
    expect(await failure(policy, "not a url")).toBe("invalidAddress");
    expect(await failure(policy, "https://unknown.example.com/")).toBe("unresolvable");
  });

  it("gives up after the time limit", async () => {
    const slow = await fake(() => new Promise((resolve) => setTimeout(() => resolve({ status: 200 }), 2000)));
    const policy = outboundPolicy(["127.0.0.0/8"]);
    await expect(
      sendOutbound(policy, { url: slow.url, method: "POST", headers: {}, body: "{}", timeoutMs: 200 }),
    ).rejects.toMatchObject({ reason: "timeout" });
  });
});
