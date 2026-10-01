import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Controller, Get, Res } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { ApiDocumentationRoute, InternalRoute, PublicRoute } from "../access/route-access.js";
import { ApiRoute } from "../http/api-route.js";
import { generateOpenApi, serializeOpenApi } from "../openapi/document.js";

const TAG = "Documentation";

export const DOCS_CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

const PAGE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Pagehall API</title>
  </head>
  <body>
    <div id="api-reference"></div>
    <script src="/api/docs/scalar.js"></script>
    <script src="/api/docs/init.js"></script>
  </body>
</html>
`;

const INIT = `Scalar.createApiReference("#api-reference", ${JSON.stringify({
  url: "/api/docs/openapi.json",
  withDefaultFonts: false,
  telemetry: false,
  persistAuth: false,
  showDeveloperTools: "never",
  showToolbar: "never",
  agent: { disabled: true },
  mcp: { disabled: true },
})});
`;

function scalarPath(): string {
  const bundled = fileURLToPath(new URL("./scalar.js", import.meta.url));
  if (existsSync(bundled)) return bundled;
  const entry = fileURLToPath(import.meta.resolve("@scalar/api-reference"));
  return join(dirname(entry), "browser", "standalone.js");
}

let scalar: Buffer | undefined;
let description: string | undefined;

function send(reply: FastifyReply, contentType: string, body: string | Buffer) {
  return reply
    .header("content-type", contentType)
    .header("x-content-type-options", "nosniff")
    .header("content-security-policy", DOCS_CONTENT_SECURITY_POLICY)
    .header("cache-control", "no-cache")
    .send(body);
}

@Controller("api/docs")
@InternalRoute()
export class DocsController {
  @Get()
  @ApiDocumentationRoute()
  @ApiRoute({
    summary: "API reference",
    tags: [TAG],
    raw: { contentTypes: ["text/html"], description: "The API reference page.", example: "<!doctype html>" },
  })
  page(@Res() reply: FastifyReply) {
    return send(reply, "text/html; charset=utf-8", PAGE);
  }

  @Get("openapi.json")
  @ApiDocumentationRoute()
  @ApiRoute({
    summary: "OpenAPI description",
    tags: [TAG],
    raw: { contentTypes: ["application/json"], description: "The OpenAPI description.", example: "{}" },
  })
  openApi(@Res() reply: FastifyReply) {
    description ??= serializeOpenApi(generateOpenApi());
    return send(reply, "application/json; charset=utf-8", description);
  }

  @Get("init.js")
  @PublicRoute()
  @ApiRoute({
    summary: "API reference start script",
    tags: [TAG],
    raw: { contentTypes: ["text/javascript"], description: "Starts the reference.", example: "" },
  })
  init(@Res() reply: FastifyReply) {
    return send(reply, "text/javascript; charset=utf-8", INIT);
  }

  @Get("scalar.js")
  @PublicRoute()
  @ApiRoute({
    summary: "API reference renderer",
    tags: [TAG],
    raw: { contentTypes: ["text/javascript"], description: "The Scalar renderer.", example: "" },
  })
  renderer(@Res() reply: FastifyReply) {
    scalar ??= readFileSync(scalarPath());
    return send(reply, "text/javascript; charset=utf-8", scalar);
  }
}
