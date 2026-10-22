import { afterEach, describe, expect, it, vi } from "vitest";
import { request, setMaintenanceHandler } from "./request.js";

function response(status: number, code: string) {
  return {
    response: new Response(null, { status }),
    error: { type: `urn:lunedo:problem:${code}`, title: code, status, code },
  };
}

afterEach(() => setMaintenanceHandler(null));

describe("requests during maintenance", () => {
  it("report a refusal because of maintenance so that the banner reloads", async () => {
    const changed = vi.fn();
    setMaintenanceHandler(changed);
    await expect(request(async () => response(503, "maintenanceMode"))).rejects.toMatchObject({
      code: "maintenanceMode",
    });
    await expect(request(async () => response(503, "signInPaused"))).rejects.toMatchObject({
      code: "signInPaused",
    });
    expect(changed).toHaveBeenCalledTimes(2);
    await expect(request(async () => response(503, "busy"))).rejects.toMatchObject({ code: "busy" });
    expect(changed).toHaveBeenCalledTimes(2);
  });
});
