import { Readable } from "node:stream";
import { buffer } from "node:stream/consumers";
import yauzl from "yauzl";
import { accountPrincipal } from "../accounts/principal.js";
import type { TestServices } from "../testing/services.js";
import { spaceFixtures } from "../testing/spaces.js";
import type { ExportArchive, ExportFile } from "./exports.js";

export function text(value: string, marks?: unknown[]) {
  return marks ? { type: "text", text: value, marks } : { type: "text", text: value };
}

export function paragraph(...content: unknown[]) {
  return content.length > 0 ? { type: "paragraph", content } : { type: "paragraph" };
}

export function doc(...content: unknown[]) {
  return { type: "doc", content };
}

export async function bytesOf(file: ExportFile | ExportArchive): Promise<Buffer> {
  if ("read" in file) return buffer(await file.read());
  return Buffer.isBuffer(file.body) ? file.body : buffer(file.body as Readable);
}
export async function unzip(data: Buffer): Promise<Map<string, Buffer>> {
  const zip = await new Promise<yauzl.ZipFile>((resolve, reject) =>
    yauzl.fromBuffer(data, { lazyEntries: true }, (error, opened) =>
      error ? reject(error) : resolve(opened),
    ),
  );
  const files = new Map<string, Buffer>();
  await new Promise<void>((resolve, reject) => {
    zip.on("error", reject);
    zip.on("end", resolve);
    zip.on("entry", (entry: yauzl.Entry) => {
      zip.openReadStream(entry, (error, stream) => {
        if (error) {
          reject(error);
          return;
        }
        buffer(stream).then((content) => {
          files.set(entry.fileName, content);
          zip.readEntry();
        }, reject);
      });
    });
    zip.readEntry();
  });
  return files;
}

export function exportFixtures(get: () => TestServices) {
  const { organization, member, space } = spaceFixtures(get);

  async function setup() {
    const test = get();
    const org = await organization();
    const adminId = await member(org.id, "member", "Space admin");
    const readerId = await member(org.id, "member", "Rita Reader");
    const stewardId = await member(org.id, "member", "Sam Steward");
    const insiderId = await member(org.id, "member", "Ines Insider");
    const editorId = await member(org.id, "member", "Eddi Editor");
    const created = await space(org.id, adminId, {
      name: "Handbook",
      grants: [
        { principalKind: "account", principalId: readerId, role: "reader" },
        { principalKind: "account", principalId: stewardId, role: "admin" },
        { principalKind: "account", principalId: insiderId, role: "admin" },
        { principalKind: "account", principalId: editorId, role: "editor" },
      ],
    });
    const other = await space(org.id, adminId, {
      name: "Elsewhere",
      grants: [
        { principalKind: "account", principalId: readerId, role: "reader" },
        { principalKind: "account", principalId: stewardId, role: "reader" },
      ],
    });
    const admin = accountPrincipal(adminId);
    const editor = accountPrincipal(editorId);
    const create = (
      spaceId: string,
      title: string,
      parentId: string | null,
      mode: "live" | "publish" = "live",
    ) => test.services.tree.create(admin, spaceId, { kind: "page", title, mode, placement: { parentId } });
    const welcome = await create(created.id, "Welcome", null);
    const network = await create(created.id, "Network: setup/guide", null, "publish");
    const salaries = await create(created.id, "Salaries 2027", null);
    const bonus = await create(created.id, "Bonus plan", salaries.id);
    const unpublished = await create(created.id, "Unpublished idea", null, "publish");
    const ops = await create(created.id, "Ops", null);
    const remote = await create(other.id, "Remote page", null);
    await test.services.documents.replace(
      admin,
      salaries.id,
      doc(paragraph(text("Confidential numbers")), {
        type: "taskList",
        content: [{ type: "taskItem", content: [paragraph(text("Secret task"))] }],
      }),
    );
    await test.services.pageAccess.change(admin, salaries.id, [
      { action: "share", holderKind: "account", holderId: insiderId, role: "editor" },
      { action: "restrict", kind: "view" },
    ]);
    await test.services.documents.replace(admin, network.id, doc(paragraph(text("Published text"))));
    await test.services.versions.publish(admin, network.id);
    await test.services.documents.replace(admin, network.id, doc(paragraph(text("Draft secret"))));
    await test.services.documents.replace(admin, unpublished.id, doc(paragraph(text("Never published"))));
    await test.services.documents.replace(
      admin,
      ops.id,
      doc({
        type: "taskList",
        content: [{ type: "taskItem", content: [paragraph(text("Renew certificate"))] }],
      }),
    );
    const notes = await test.services.attachments.upload(admin, welcome.id, {
      name: "notes.txt",
      body: Readable.from([Buffer.from("attachment body")]),
      contentLength: 15,
    });
    await test.services.documents.replace(
      admin,
      welcome.id,
      doc(
        paragraph(
          text("See "),
          { type: "pageLink", attrs: { pageId: network.id } },
          text(" and "),
          { type: "pageLink", attrs: { pageId: salaries.id } },
          text(" and "),
          { type: "pageLink", attrs: { pageId: remote.id } },
          text(" and "),
          { type: "pageLink", attrs: { pageId: unpublished.id } },
          text(" by "),
          { type: "mention", attrs: { id: readerId } },
        ),
        paragraph(text("Docs", [{ type: "link", attrs: { href: `/spaces/X/pages/${ops.id}/ops#steps` } }])),
        { type: "file", attrs: { attachmentId: notes.id, name: "notes.txt" } },
        { type: "childPages", attrs: { pageId: null } },
        { type: "pageReport", attrs: { spaceId: created.id } },
        { type: "taskReport", attrs: { spaceId: created.id, status: "all" } },
      ),
    );
    return {
      org,
      space: created,
      other,
      pages: { welcome, network, salaries, bonus, unpublished, ops, remote },
      notes,
      adminId,
      readerId,
      stewardId,
      insiderId,
      editorId,
      admin,
      editor,
      reader: accountPrincipal(readerId),
      steward: accountPrincipal(stewardId),
      insider: accountPrincipal(insiderId),
    };
  }

  return { setup };
}

export type ExportContext = Awaited<ReturnType<ReturnType<typeof exportFixtures>["setup"]>>;
