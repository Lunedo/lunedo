import { deflateRawSync } from "node:zlib";
import { accountAttemptLimitSetting, clientAttemptLimitSetting } from "@pagehall/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addTotp,
  completeConfiguredSetup,
  configuredSetupEnv,
  createAccount,
  firstOrganizationId,
  OWNER,
  signedInClient,
} from "../testing/accounts.js";
import { type AuthTestApp, createAuthTestApp, databaseBaseUrl, TestClient } from "../testing/auth-app.js";

const SVG_NS = 'xmlns="http://www.w3.org/2000/svg"';
const XHTML_NS = 'xmlns="http://www.w3.org/1999/xhtml"';
const octet = { "content-type": "application/octet-stream" };

function drawio(label: string): Buffer {
  return Buffer.from(
    `<mxfile host="embed.diagrams.net"><diagram id="p1" name="Page-1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>` +
      `<mxCell id="2" value="${label}" style="rounded=1;html=1;" vertex="1" parent="1"><mxGeometry x="10" y="10" width="120" height="60" as="geometry"/></mxCell>` +
      `</root></mxGraphModel></diagram></mxfile>`,
  );
}

function svg(body: string, size = 'width="200" height="100"') {
  return Buffer.from(`<svg ${SVG_NS} ${size} viewBox="0 0 200 100">${body}</svg>`);
}

describe.skipIf(!databaseBaseUrl)("diagram blocks through the API", () => {
  let test: AuthTestApp;
  let owner: TestClient;
  let organizationId: string;
  let counter = 0;

  beforeAll(async () => {
    test = await createAuthTestApp(configuredSetupEnv);
    await completeConfiguredSetup(test);
    await test.runtime.settings.set(clientAttemptLimitSetting, {}, "instance", 10_000);
    await test.runtime.settings.set(accountAttemptLimitSetting, {}, "instance", 1000);
    owner = new TestClient(test.app);
    await owner.post("/api/v1/auth/sign-in", OWNER);
    await addTotp(owner);
    organizationId = await firstOrganizationId(test);
  });

  afterAll(async () => {
    await test?.close();
  });

  async function person() {
    counter += 1;
    const email = `diagrams${counter}@pagehall.test`;
    const password = "a long enough passphrase";
    const { id } = await createAccount(test, email, password);
    return { id, client: await signedInClient(test, email, password) };
  }

  async function page(grants: unknown[] = []) {
    counter += 1;
    const created = await owner.post(`/api/v1/organizations/${organizationId}/spaces`, {
      name: `Diagrams ${counter}`,
      key: `D${counter}G`,
      visibility: "private",
      grants,
    });
    expect(created.statusCode, created.body).toBe(201);
    const item = await owner.post(`/api/v1/spaces/${created.json().id}/items`, {
      kind: "page",
      title: "Standort Graz",
      parentId: null,
      mode: "publish",
    });
    return { spaceId: created.json().id as string, pageId: item.json().id as string };
  }

  async function publish(pageId: string, content: unknown[]) {
    const stored = await owner.put(`/api/v1/pages/${pageId}/content`, { document: { type: "doc", content } });
    expect(stored.statusCode, stored.body).toBe(200);
    const published = await owner.post(`/api/v1/pages/${pageId}/publish`, {});
    expect(published.statusCode, published.body).toBe(200);
  }

  const blockId = "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5ab0";

  it("store a draw.io file and its image so that page versions keep the diagram they had", async () => {
    const { pageId } = await page();
    const versions: Record<string, unknown>[] = [];
    for (const label of ["Core switch", "Firewall"]) {
      const source = await owner.put(
        `/api/v1/pages/${pageId}/diagrams/${blockId}/drawio`,
        drawio(label),
        octet,
      );
      expect(source.statusCode, source.body).toBe(200);
      expect(source.json().text).toBe(label);
      const image = await owner.put(
        `/api/v1/pages/${pageId}/diagrams/${blockId}/image?type=drawio`,
        svg(
          `<g><rect width="120" height="60"/><switch><foreignObject requiredFeatures="http://www.w3.org/TR/SVG11/feature#Extensibility" width="100%" height="100%"><div ${XHTML_NS} style="display: flex;"><div><b>${label}</b></div></div></foreignObject><text x="60" y="35">${label}</text></switch></g>`,
        ),
        octet,
      );
      expect(image.statusCode, image.body).toBe(200);
      const attrs = {
        id: blockId,
        sourceFormat: "drawio",
        ...source.json(),
        ...image.json(),
        text: source.json().text,
      };
      versions.push(attrs);
      await publish(pageId, [{ type: "drawio", attrs }]);
    }
    expect(versions[1]).toMatchObject({
      sourceId: versions[0]?.sourceId,
      sourceVersion: 2,
      previewVersion: 2,
    });

    const first = await owner.get(`/api/v1/pages/${pageId}/versions/1`);
    expect(first.statusCode, first.body).toBe(200);
    const old = first.json().document.content[0].attrs;
    expect(old).toMatchObject({ sourceVersion: 1, previewVersion: 1 });
    const oldSource = await owner.get(`/api/v1/attachments/${old.sourceId}/content?version=1`);
    expect(oldSource.body).toContain('value="Core switch"');
    const oldImage = await owner.get(`/api/v1/attachments/${old.previewId}/content?version=1`);
    expect(oldImage.body).toContain("<b>Core switch</b>");
    expect(oldImage.headers["content-security-policy"]).toContain("sandbox");

    const printed = await owner.get(`/api/v1/pages/${pageId}/export?format=print`);
    expect(printed.statusCode, printed.body).toBe(200);
    expect(printed.body).toContain(`/api/v1/attachments/${versions[1]?.previewId}/content`);
    const word = await owner.get(`/api/v1/pages/${pageId}/export?format=docx`);
    expect(word.statusCode).toBe(200);
    expect(word.rawPayload.toString("latin1")).toMatch(/word\/media\/[^/]+\.svg/);
    const markdown = await owner.get(`/api/v1/pages/${pageId}/export?format=markdown`);
    expect(markdown.body).toContain(`![draw.io diagram]`);
  });

  it("find pages by the text inside their diagrams", async () => {
    const { pageId } = await page();
    const word = `switchname${Date.now()}x`;
    const source = await owner.put(`/api/v1/pages/${pageId}/diagrams/${blockId}/drawio`, drawio(word), octet);
    const image = await owner.put(
      `/api/v1/pages/${pageId}/diagrams/${blockId}/image?type=mermaid`,
      svg(`<g><text>Mermaid ${word}y</text></g>`),
      octet,
    );
    expect(image.json().text).toBe(`Mermaid ${word}y`);
    await publish(pageId, [
      { type: "drawio", attrs: { id: blockId, ...source.json() } },
      {
        type: "mermaid",
        attrs: { id: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5ab1", source: "flowchart LR\n  A", ...image.json() },
      },
    ]);
    await test.runtime.services.search.indexer.drain();
    for (const query of [word, `${word}y`]) {
      const found = await owner.get(
        `/api/v1/organizations/${organizationId}/search?q=${encodeURIComponent(query)}`,
      );
      expect(found.statusCode, found.body).toBe(200);
      expect(found.json().results.map((result: { id: string }) => result.id)).toEqual([pageId]);
    }
  });

  it("neutralize crafted draw.io files and images", async () => {
    const { pageId } = await page();
    const crafted = Buffer.from(
      `<mxfile><diagram name="x"><mxGraphModel><root><mxCell id="0"/>` +
        `<UserObject id="2" label="Click" link="javascript:alert(1)" onclick="alert(2)"><mxCell vertex="1" parent="0" style="image=data:text/html,x"/></UserObject>` +
        `<mxCell id="3" value="&lt;img src=x onerror=alert(3)&gt;Safe" vertex="1" parent="0"/>` +
        `</root></mxGraphModel></diagram></mxfile>`,
    );
    const stored = await owner.put(`/api/v1/pages/${pageId}/diagrams/${blockId}/drawio`, crafted, octet);
    expect(stored.statusCode, stored.body).toBe(200);
    expect(stored.json().text).toContain("Safe");
    const content = await owner.get(`/api/v1/attachments/${stored.json().sourceId}/content`);
    expect(content.body).not.toMatch(/javascript|onclick|data:text/);
    expect(content.body).toContain('label="Click"');

    const compressed = deflateRawSync(
      Buffer.from(
        encodeURIComponent('<mxGraphModel><root><mxCell id="0" value="Packed"/></root></mxGraphModel>'),
      ),
    ).toString("base64");
    const packed = await owner.put(
      `/api/v1/pages/${pageId}/diagrams/${blockId}/drawio`,
      Buffer.from(`<mxfile><diagram name="p">${compressed}</diagram></mxfile>`),
      octet,
    );
    expect(packed.json().text).toBe("Packed");

    for (const body of [
      "<html/>",
      '<!DOCTYPE mxfile [<!ENTITY a "x">]><mxfile/>',
      "<mxfile><script>alert(1)</script></mxfile>",
      "<mxfile><diagram>not compressed data</diagram></mxfile>",
    ]) {
      const refused = await owner.put(
        `/api/v1/pages/${pageId}/diagrams/${blockId}/drawio`,
        Buffer.from(body),
        octet,
      );
      expect(refused.statusCode, body).toBe(400);
      expect(refused.json().type).toContain("invalidDiagram");
    }

    const image = await owner.put(
      `/api/v1/pages/${pageId}/diagrams/${blockId}/image?type=plantuml`,
      svg(
        `<script>alert(1)</script><a href="https://evil.example"><text>Linked</text></a><image href="https://evil.example/x.png"/>` +
          `<foreignObject><div ${XHTML_NS}><img src="https://evil.example/y.png"/><script>alert(2)</script><span onclick="alert(3)" style="background:url(https://evil.example/z)">Label</span></div></foreignObject>`,
      ),
      octet,
    );
    expect(image.statusCode, image.body).toBe(200);
    const served = await owner.get(`/api/v1/attachments/${image.json().previewId}/content`);
    expect(served.body).not.toMatch(/alert|evil\.example|<a |onclick|<img|<script/);
    expect(served.body).toContain("Linked");
    expect(image.json().text).toBe("Linked\nLabel");
  });

  it("limit the size of diagram files and images", async () => {
    const { pageId } = await page();
    const huge = await owner.put(
      `/api/v1/pages/${pageId}/diagrams/${blockId}/image?type=mermaid`,
      svg(`<text>${"x".repeat(2 * 1024 * 1024)}</text>`),
      octet,
    );
    expect(huge.statusCode).toBe(413);
    const wide = await owner.put(
      `/api/v1/pages/${pageId}/diagrams/${blockId}/image?type=plantuml`,
      svg("<rect/>", 'width="40000" height="10"'),
      octet,
    );
    expect(wide.statusCode).toBe(400);
    expect(wide.json().type).toContain("invalidDrawingImage");
    const file = await owner.put(
      `/api/v1/pages/${pageId}/diagrams/${blockId}/drawio`,
      Buffer.from(`<mxfile>${" ".repeat(10 * 1024 * 1024)}</mxfile>`),
      octet,
    );
    expect(file.statusCode).toBe(413);
    const unknown = await owner.put(
      `/api/v1/pages/${pageId}/diagrams/${blockId}/image?type=visio`,
      svg(""),
      octet,
    );
    expect(unknown.statusCode).toBe(400);
  });

  it("let only editors store diagrams and keep their files from people without access", async () => {
    const reader = await person();
    const outsider = await person();
    const { pageId } = await page([{ principalKind: "account", principalId: reader.id, role: "reader" }]);
    const source = await owner.put(
      `/api/v1/pages/${pageId}/diagrams/${blockId}/drawio`,
      drawio("Secret"),
      octet,
    );
    const image = await owner.put(
      `/api/v1/pages/${pageId}/diagrams/${blockId}/image?type=drawio`,
      svg("<text>Secret</text>"),
      octet,
    );
    await publish(pageId, [{ type: "drawio", attrs: { id: blockId, ...source.json(), ...image.json() } }]);
    for (const path of ["drawio", "image?type=drawio"]) {
      const denied = await reader.client.put(
        `/api/v1/pages/${pageId}/diagrams/${blockId}/${path}`,
        path === "drawio" ? drawio("x") : svg(""),
        octet,
      );
      expect(denied.statusCode).toBe(403);
    }
    for (const id of [source.json().sourceId, image.json().previewId]) {
      expect((await reader.client.get(`/api/v1/attachments/${id}/content`)).statusCode).toBe(200);
      const hidden = await outsider.client.get(`/api/v1/attachments/${id}/content`);
      expect(hidden.statusCode).toBe(404);
      expect(hidden.body).not.toContain("Secret");
    }
  });
});
