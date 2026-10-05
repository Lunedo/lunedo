import { randomUUID } from "node:crypto";
import { importPKCS8, SignJWT } from "jose";

export interface GraphClientCredential {
  id: string;
  kind: string;
  secret: string;
  keyId: string | null;
}

export type GraphTokenResult =
  | { ok: true; token: string; expiresIn: number }
  | { ok: false; status: number; error: string | null; description: string | null };

export async function requestGraphToken(input: {
  request: (url: string, init: RequestInit) => Promise<Response>;
  authority: string;
  tenantId: string;
  clientId: string;
  graphUrl: string;
  credential: GraphClientCredential;
}): Promise<GraphTokenResult> {
  const endpoint = `${input.authority}/${input.tenantId}/oauth2/v2.0/token`;
  const form = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: input.clientId,
    scope: `${input.graphUrl}/.default`,
  });
  if (input.credential.kind === "clientSecret") {
    form.set("client_secret", input.credential.secret);
  } else {
    const key = await importPKCS8(input.credential.secret, "RS256");
    const assertion = await new SignJWT({})
      .setProtectedHeader({
        alg: "RS256",
        ...(input.credential.keyId ? { x5t: input.credential.keyId } : {}),
      })
      .setIssuer(input.clientId)
      .setSubject(input.clientId)
      .setAudience(endpoint)
      .setJti(randomUUID())
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(key);
    form.set("client_assertion_type", "urn:ietf:params:oauth:client-assertion-type:jwt-bearer");
    form.set("client_assertion", assertion);
  }
  const response = await input.request(endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form,
  });
  const body = (await response.json().catch(() => ({}))) as {
    access_token?: unknown;
    expires_in?: unknown;
    error?: unknown;
    error_description?: unknown;
  };
  if (response.ok && typeof body.access_token === "string" && body.access_token) {
    return {
      ok: true,
      token: body.access_token,
      expiresIn: typeof body.expires_in === "number" ? body.expires_in : 3600,
    };
  }
  return {
    ok: false,
    status: response.status,
    error: typeof body.error === "string" ? body.error : null,
    description: typeof body.error_description === "string" ? body.error_description : null,
  };
}
