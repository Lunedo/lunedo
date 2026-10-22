import { createHash, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { exportJWK, generateKeyPair, type JWTPayload, SignJWT, UnsecuredJWT } from "jose";

export interface TokenOverrides {
  issuer?: string;
  audience?: string;
  nonce?: string;
  algorithm?: "none" | "HS256";
  expiresInSeconds?: number;
  omitNonce?: boolean;
}

interface IssuedCode {
  clientId: string;
  redirectUri: string;
  codeChallenge: string | null;
  nonce: string | null;
  claims: Record<string, unknown>;
  overrides: TokenOverrides;
}

export interface FakeOidcProvider {
  issuer: string;
  clientId: string;
  clientSecret: string;
  authorize(
    authorizationUrl: string,
    claims: Record<string, unknown>,
    overrides?: TokenOverrides,
  ): Promise<URL>;
  lastAuthorization(): URLSearchParams | null;
  tokenRequests(): URLSearchParams[];
  logoutToken(claims: JWTPayload, options?: { algorithm?: "none" }): Promise<string>;
  close(): Promise<void>;
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

export async function startFakeOidcProvider(
  options: { clientId?: string; clientSecret?: string; path?: string } = {},
): Promise<FakeOidcProvider> {
  const clientId = options.clientId ?? "lunedo-test";
  const clientSecret = options.clientSecret ?? randomBytes(16).toString("hex");
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "test-key", alg: "RS256", use: "sig" };
  const codes = new Map<string, IssuedCode>();
  const requests: URLSearchParams[] = [];
  let authorization: URLSearchParams | null = null;
  let issuer = "";

  async function idToken(code: IssuedCode): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const lifetime = code.overrides.expiresInSeconds ?? 300;
    const payload: JWTPayload = {
      ...code.claims,
      ...(code.overrides.omitNonce ? {} : { nonce: code.overrides.nonce ?? code.nonce ?? undefined }),
    };
    if (code.overrides.algorithm === "none") {
      return new UnsecuredJWT(payload)
        .setIssuer(code.overrides.issuer ?? issuer)
        .setAudience(code.overrides.audience ?? clientId)
        .setIssuedAt(now)
        .setExpirationTime(now + lifetime)
        .encode();
    }
    const jwt = new SignJWT(payload)
      .setIssuer(code.overrides.issuer ?? issuer)
      .setAudience(code.overrides.audience ?? clientId)
      .setIssuedAt(lifetime < 0 ? now + lifetime - 60 : now)
      .setExpirationTime(now + lifetime);
    if (code.overrides.algorithm === "HS256") {
      return jwt.setProtectedHeader({ alg: "HS256" }).sign(new TextEncoder().encode(clientSecret));
    }
    return jwt.setProtectedHeader({ alg: "RS256", kid: "test-key" }).sign(privateKey);
  }

  const server: Server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? "/", issuer);
      const prefix = options.path ?? "";
      if (!url.pathname.startsWith(prefix)) {
        response.writeHead(404);
        response.end();
        return;
      }
      url.pathname = url.pathname.slice(prefix.length) || "/";
      const json = (status: number, body: unknown) => {
        response.writeHead(status, { "content-type": "application/json" });
        response.end(JSON.stringify(body));
      };
      if (url.pathname === "/.well-known/openid-configuration") {
        json(200, {
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          jwks_uri: `${issuer}/jwks`,
          response_types_supported: ["code"],
          subject_types_supported: ["public"],
          id_token_signing_alg_values_supported: ["RS256"],
          code_challenge_methods_supported: ["S256"],
          token_endpoint_auth_methods_supported: ["client_secret_post", "private_key_jwt"],
          backchannel_logout_supported: true,
          backchannel_logout_session_supported: true,
        });
        return;
      }
      if (url.pathname === "/jwks") {
        json(200, { keys: [jwk] });
        return;
      }
      if (url.pathname === "/token" && request.method === "POST") {
        const body = new URLSearchParams(await readBody(request));
        requests.push(body);
        const code = codes.get(body.get("code") ?? "");
        codes.delete(body.get("code") ?? "");
        if (body.get("client_id") !== clientId || body.get("client_secret") !== clientSecret) {
          json(401, { error: "invalid_client" });
          return;
        }
        if (!code || code.redirectUri !== body.get("redirect_uri")) {
          json(400, { error: "invalid_grant" });
          return;
        }
        const verifier = body.get("code_verifier");
        const challenge = verifier ? createHash("sha256").update(verifier).digest("base64url") : null;
        if (!code.codeChallenge || challenge !== code.codeChallenge) {
          json(400, { error: "invalid_grant", error_description: "PKCE verification failed" });
          return;
        }
        json(200, {
          access_token: randomBytes(16).toString("hex"),
          token_type: "Bearer",
          expires_in: 300,
          id_token: await idToken(code),
        });
        return;
      }
      json(404, { error: "not_found" });
    })().catch((error: unknown) => {
      response.writeHead(500);
      response.end(String(error));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}${options.path ?? ""}`;

  return {
    issuer,
    clientId,
    clientSecret,
    async authorize(authorizationUrl, claims, overrides = {}) {
      const params = new URL(authorizationUrl).searchParams;
      authorization = params;
      const code = randomBytes(16).toString("hex");
      codes.set(code, {
        clientId: params.get("client_id") ?? "",
        redirectUri: params.get("redirect_uri") ?? "",
        codeChallenge: params.get("code_challenge_method") === "S256" ? params.get("code_challenge") : null,
        nonce: params.get("nonce"),
        claims,
        overrides,
      });
      const callback = new URL(params.get("redirect_uri") ?? "");
      callback.searchParams.set("code", code);
      callback.searchParams.set("state", params.get("state") ?? "");
      return callback;
    },
    lastAuthorization: () => authorization,
    tokenRequests: () => requests,
    async logoutToken(claims, logoutOptions = {}) {
      const now = Math.floor(Date.now() / 1000);
      const payload: JWTPayload = {
        events: { "http://schemas.openid.net/event/backchannel-logout": {} },
        jti: randomBytes(8).toString("hex"),
        ...claims,
      };
      if (logoutOptions.algorithm === "none") {
        return new UnsecuredJWT(payload).setIssuer(issuer).setAudience(clientId).setIssuedAt(now).encode();
      }
      return new SignJWT(payload)
        .setProtectedHeader({ alg: "RS256", kid: "test-key", typ: "logout+jwt" })
        .setIssuer(issuer)
        .setAudience(clientId)
        .setIssuedAt(now)
        .setExpirationTime(now + 120)
        .sign(privateKey);
    },
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
