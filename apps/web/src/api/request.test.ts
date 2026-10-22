import { afterEach, describe, expect, it, vi } from "vitest";
import { createApiClient } from "./client.js";
import { ApiError, isApiError, request, setReauthenticationHandler, setSignedOutHandler } from "./request.js";

function problem(status: number, code: string, extra: Record<string, unknown> = {}) {
  return new Response(
    JSON.stringify({ type: `urn:lunedo:problem:${code}`, title: code, status, code, ...extra }),
    { status, headers: { "content-type": "application/problem+json" } },
  );
}

afterEach(() => {
  setReauthenticationHandler(null);
  setSignedOutHandler(null);
});

describe("the API client", () => {
  it("marks every changing request so the server accepts it", async () => {
    const fetch = vi.fn(async (_input: Request) => new Response(null, { status: 204 }));
    const client = createApiClient(fetch as unknown as typeof globalThis.fetch);
    await client.POST("/api/v1/auth/sign-out");
    await client.GET("/api/v1/auth/session");
    const [post, get] = fetch.mock.calls.map(([input]) => input);
    expect(post?.headers.get("X-Lunedo-Request")).toBe("1");
    expect(get?.headers.get("X-Lunedo-Request")).toBeNull();
  });
});

describe("request", () => {
  it("returns the data of a successful response", async () => {
    const data = await request(async () => ({
      data: { ok: true },
      response: new Response(null, { status: 200 }),
    }));
    expect(data).toEqual({ ok: true });
  });

  it("turns problem details into an error with their code and fields", async () => {
    const response = problem(400, "invalidInput", { fields: ["body.email"] });
    const failure = await request(async () => ({ error: await response.clone().json(), response })).catch(
      (error: unknown) => error,
    );
    expect(isApiError(failure, "invalidInput")).toBe(true);
    expect((failure as ApiError).fields).toEqual(["body.email"]);
  });

  it("reports unreachable servers as network errors", async () => {
    const failure = await request(async () => {
      throw new TypeError("fetch failed");
    }).catch((error: unknown) => error);
    expect(isApiError(failure, "networkError")).toBe(true);
  });

  it("asks for reauthentication and repeats the request once", async () => {
    const reauthenticate = vi.fn(async () => true);
    setReauthenticationHandler(reauthenticate);
    let calls = 0;
    const result = await request(async () => {
      calls += 1;
      if (calls === 1) {
        const response = problem(403, "reauthenticationRequired");
        return { error: await response.clone().json(), response };
      }
      return { data: "done", response: new Response(null, { status: 200 }) };
    });
    expect(result).toBe("done");
    expect(reauthenticate).toHaveBeenCalledOnce();
    expect(calls).toBe(2);
  });

  it("gives up when the reauthentication is cancelled", async () => {
    setReauthenticationHandler(async () => false);
    const response = problem(403, "reauthenticationRequired");
    const failure = await request(async () => ({ error: await response.clone().json(), response })).catch(
      (error: unknown) => error,
    );
    expect(isApiError(failure, "reauthenticationRequired")).toBe(true);
  });

  it("tells the app when the session ended, unless the caller handles it", async () => {
    const signedOut = vi.fn();
    setSignedOutHandler(signedOut);
    const ended = problem(401, "sessionEnded");
    await request(async () => ({ error: await ended.clone().json(), response: ended })).catch(
      () => undefined,
    );
    expect(signedOut).toHaveBeenCalledWith("sessionEnded");
    const again = problem(401, "notSignedIn");
    await request(async () => ({ error: await again.clone().json(), response: again }), {
      sessionHandling: false,
    }).catch(() => undefined);
    expect(signedOut).toHaveBeenCalledOnce();
  });
});
