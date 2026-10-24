import { DiscoveryService, MetadataScanner, Reflector } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { apiControllers } from "../openapi/routes.js";
import { type AuthTestApp, createAuthTestApp, databaseBaseUrl } from "../testing/auth-app.js";
import { INTERNAL_ROUTE } from "./route-access.js";
import { registeredRoutes } from "./route-access.verifier.js";

describe.skipIf(!databaseBaseUrl)("routes of the complete API", () => {
  let test: AuthTestApp;

  beforeAll(async () => {
    test = await createAuthTestApp();
  });

  afterAll(async () => {
    await test?.close();
  });

  it("all declare their access, and the sign-in, account and setup routes are internal", () => {
    const discovery = test.app.get(DiscoveryService);
    const reflector = test.app.get(Reflector);
    const routes = registeredRoutes(discovery, test.app.get(MetadataScanner), reflector);
    expect(routes.filter((route) => route.access === undefined)).toEqual([]);
    expect(routes.map((route) => route.route)).toEqual(
      expect.arrayContaining([
        "POST /api/v1/auth/sign-in (AuthController.signIn)",
        "POST /api/v1/account/password (AccountController.changePassword)",
        "POST /api/v1/setup/steps/:step/:action (SetupController.runAction)",
      ]),
    );
    for (const wrapper of discovery.getControllers()) {
      if (
        !wrapper.metatype ||
        !["AuthController", "AccountController", "SetupController", "SetupRestoreController"].includes(
          wrapper.metatype.name,
        )
      ) {
        continue;
      }
      expect(reflector.get(INTERNAL_ROUTE, wrapper.metatype), wrapper.metatype.name).toBe(true);
    }
  });

  it("all appear in the OpenAPI generator with a route declaration", () => {
    const routes = registeredRoutes(
      test.app.get(DiscoveryService),
      test.app.get(MetadataScanner),
      test.app.get(Reflector),
    );
    const apiControllerNames = new Set(
      routes.filter((route) => route.path.startsWith("/api/")).map((route) => route.controller),
    );
    expect([...apiControllerNames].sort()).toEqual(
      apiControllers()
        .map((controller) => controller.name)
        .sort(),
    );
    expect(routes.filter((route) => route.path.startsWith("/api/") && !route.definition)).toEqual([]);
  });

  it("protect account routes with a session and setup routes with a setup session", async () => {
    const access = Object.fromEntries(
      registeredRoutes(
        test.app.get(DiscoveryService),
        test.app.get(MetadataScanner),
        test.app.get(Reflector),
      ).map((route) => [route.route.split(" (")[0], route.access?.kind]),
    );
    for (const [route, kind] of Object.entries(access)) {
      if (route.includes("/api/v1/account/")) expect(kind, route).toBe("session");
      if (route.includes("/api/v1/setup/steps") || route.endsWith("/api/v1/setup/complete")) {
        expect(kind, route).toBe("setupSession");
      }
      if (route.includes("/api/v1/setup/restore") && !route.endsWith("/api/v1/setup/restore/status")) {
        expect(kind, route).toBe("setupSession");
      }
    }
    expect(access["GET /api/v1/setup/restore/status"]).toBe("public");
    expect(access["POST /api/v1/setup/restore"]).toBe("setupSession");
    expect(access["POST /api/v1/account/password"]).toBe("session");
  });
});
