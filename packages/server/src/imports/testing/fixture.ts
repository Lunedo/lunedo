import type { SyntheticExport, SyntheticPage } from "./confluence-export.js";

export const ALICE = { key: "8a7f0001", accountId: "557058:aaaaaaaa-0001" };
export const BOB = { key: "8a7f0002", accountId: "557058:bbbbbbbb-0002" };
export const STRANGER_ACCOUNT = "557058:cccccccc-0003";

export const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d4948445200000001000000010806000000" +
    "1f15c4890000000d49444154789c6360000002000100e221bc330000000049454e44ae426082",
  "hex",
);

export const PAGE = {
  home: "1001",
  alpha: "1002",
  beta: "1003",
  zeta: "1004",
  aardvark: "1005",
  child: "1006",
  grandchild: "1007",
  deleted: "1008",
  draft: "1009",
  otherSpace: "1010",
  orphan: "1011",
} as const;

const RICH_BODY = [
  "<h1>Heading one</h1><h2>Heading two</h2><h3>Three</h3><h4>Four</h4><h5>Five</h5><h6>Six</h6>",
  '<p style="text-align: center;">Centered <strong>bold</strong> <em>italic</em> <u>underline</u> <s>strike</s>',
  ' <code>inline code</code> H<sub>2</sub>O x<sup>2</sup> <span style="color: rgb(255,0,0);">red</span>',
  ' <span style="background-color: #ffff00;">marked</span> caf&eacute; &rarr;<br/>next line</p>',
  '<p style="margin-left: 60.0px;">Indented twice</p>',
  "<ul><li><p>First</p><ul><li>Nested</li></ul></li><li>Second</li></ul>",
  '<ol start="3"><li>Third</li><li>Fourth</li></ol>',
  "<ac:task-list><ac:task><ac:task-id>1</ac:task-id><ac:task-status>complete</ac:task-status>",
  "<ac:task-body>Done task</ac:task-body></ac:task><ac:task><ac:task-id>2</ac:task-id>",
  "<ac:task-status>incomplete</ac:task-status><ac:task-body>Open task</ac:task-body></ac:task></ac:task-list>",
  '<table><colgroup><col style="width: 120.0px;"/><col style="width: 80.0px;"/><col style="width: 100.0px;"/></colgroup>',
  '<tbody><tr><th data-highlight-colour="#deebff">Head A</th><th colspan="2">Head BC</th></tr>',
  '<tr><td rowspan="2">Tall</td><td>b1</td><td>c1</td></tr><tr><td>b2</td><td>c2</td></tr></tbody></table>',
  "<pre>line one\nline two</pre>",
  "<blockquote><p>Quoted text</p></blockquote>",
  '<p>External <a href="https://example.org/docs">link</a> and <a href="javascript:alert(1)">bad</a></p>',
  `<p>See <ac:link><ri:page ri:content-title="Beta" /></ac:link> and `,
  '<ac:link><ri:page ri:content-title="Beta" /><ac:plain-text-link-body><![CDATA[the beta page]]></ac:plain-text-link-body></ac:link>',
  ` and <a href="https://example.atlassian.net/wiki/spaces/SYN/pages/${PAGE.zeta}/Zeta">Zeta by address</a>`,
  ' and <ac:link><ri:page ri:space-key="ELSE" ri:content-title="Elsewhere" /></ac:link></p>',
  '<p><ac:image ac:width="300" ac:align="left" ac:alt="Diagram"><ri:attachment ri:filename="diagram.png" /></ac:image></p>',
  '<ac:image><ri:attachment ri:filename="missing.png" /></ac:image>',
  '<p>Download <ac:link><ri:attachment ri:filename="report.pdf" /></ac:link></p>',
  `<p>Hello <ac:link><ri:user ri:account-id="${BOB.accountId}" /></ac:link> and `,
  `<ac:link><ri:user ri:account-id="${STRANGER_ACCOUNT}" /></ac:link> and `,
  `<ac:link><ri:user ri:userkey="${BOB.key}" /></ac:link> `,
  '<ac:emoticon ac:name="smile" ac:emoji-shortname=":slight_smile:" ac:emoji-fallback="🙂" /></p>',
  "<hr/>",
  '<p>Status: <ac:structured-macro ac:name="status" ac:schema-version="1"><ac:parameter ac:name="title">Done</ac:parameter>',
  '<ac:parameter ac:name="colour">Green</ac:parameter></ac:structured-macro> end</p>',
  '<ac:structured-macro ac:name="info" ac:schema-version="1"><ac:rich-text-body><p>Info panel</p></ac:rich-text-body></ac:structured-macro>',
  '<ac:structured-macro ac:name="code" ac:schema-version="1"><ac:parameter ac:name="language">js</ac:parameter>',
  "<ac:plain-text-body><![CDATA[const a = 1 < 2;]]></ac:plain-text-body></ac:structured-macro>",
  '<ac:layout><ac:layout-section ac:type="two_equal"><ac:layout-cell><p>Left</p></ac:layout-cell>',
  "<ac:layout-cell><p>Right</p></ac:layout-cell></ac:layout-section></ac:layout>",
  '<p><time datetime="2024-05-06" /></p>',
].join("");

export function syntheticExport(): SyntheticExport {
  return {
    space: { id: "5001", key: "SYN", name: "Synthetic space", homePageId: PAGE.home },
    users: [ALICE, BOB],
    pages: [
      {
        id: PAGE.home,
        title: "Synthetic home",
        parentId: null,
        position: null,
        body: "<p>Welcome home</p>",
        creatorKey: ALICE.key,
      },
      {
        id: PAGE.alpha,
        title: "Alpha",
        parentId: PAGE.home,
        position: 2,
        body: RICH_BODY,
        creatorKey: ALICE.key,
        labels: ["howto", "important"],
      },
      {
        id: PAGE.beta,
        title: "Beta",
        parentId: PAGE.home,
        position: 1,
        body: `<p>Beta links back to <ac:link><ri:page ri:content-title="Alpha" /></ac:link></p>`,
        creatorKey: BOB.key,
        labels: ["howto"],
        history: [{ id: "1903", body: "<p>Old beta</p>" }],
      },
      {
        id: PAGE.zeta,
        title: "Zeta",
        parentId: PAGE.home,
        position: null,
        body: "<p>Zeta</p>",
        creatorKey: BOB.key,
      },
      {
        id: PAGE.aardvark,
        title: "Aardvark",
        parentId: PAGE.home,
        position: null,
        body: "<p>Aardvark</p>",
        creatorKey: BOB.key,
      },
      {
        id: PAGE.child,
        title: "Child of alpha",
        parentId: PAGE.alpha,
        position: 0,
        body: "<p>Child</p>",
        creatorKey: ALICE.key,
      },
      {
        id: PAGE.grandchild,
        title: "Grandchild",
        parentId: PAGE.child,
        position: 0,
        body: "<p>Grandchild</p>",
        creatorKey: ALICE.key,
      },
      {
        id: PAGE.deleted,
        title: "Deleted page",
        parentId: PAGE.home,
        position: 5,
        body: "<p>Deleted</p>",
        creatorKey: ALICE.key,
        status: "deleted",
      },
      {
        id: PAGE.draft,
        title: "Draft page",
        parentId: PAGE.home,
        position: 6,
        body: "<p>Draft</p>",
        creatorKey: ALICE.key,
        status: "draft",
      },
      {
        id: PAGE.otherSpace,
        title: "Other space page",
        parentId: null,
        position: null,
        body: "<p>Other</p>",
        creatorKey: ALICE.key,
        spaceId: "5002",
      },
      {
        id: PAGE.orphan,
        title: "Orphan",
        parentId: "999999",
        position: null,
        body: "<p>Orphan</p>",
        creatorKey: ALICE.key,
      },
    ],
    attachments: [
      {
        pageId: PAGE.alpha,
        fileName: "diagram.png",
        versions: [
          { id: "3001", version: 1, data: PNG },
          { id: "3002", version: 2, data: Buffer.concat([PNG, Buffer.from([0])]) },
        ],
      },
      {
        pageId: PAGE.alpha,
        fileName: "report.pdf",
        versions: [{ id: "3003", version: 1, data: "%PDF-1.4 synthetic" }],
      },
      {
        pageId: PAGE.alpha,
        fileName: "lost.txt",
        versions: [{ id: "3004", version: 1, data: "lost" }],
        missingFile: true,
      },
      { pageId: PAGE.deleted, fileName: "gone.txt", versions: [{ id: "3005", version: 1, data: "gone" }] },
    ],
  };
}

export function largeExport(pageCount: number, attachmentCount: number): SyntheticExport {
  const pages: SyntheticPage[] = [
    {
      id: "2000",
      title: "Large home",
      parentId: null,
      position: null,
      body: "<p>Home</p>",
      creatorKey: ALICE.key,
    },
  ];
  for (let index = 1; index <= pageCount; index += 1) {
    const parentId = index <= 10 ? "2000" : String(2000 + ((index - 1) % 10) + 1);
    pages.push({
      id: String(2000 + index),
      title: `Page ${String(index).padStart(4, "0")}`,
      parentId,
      position: index,
      body: `<p>Body ${index} links to <ac:link><ri:page ri:content-title="Page 0001" /></ac:link></p>`,
      creatorKey: index % 2 === 0 ? ALICE.key : BOB.key,
    });
  }
  const attachments = Array.from({ length: attachmentCount }, (_, index) => ({
    pageId: String(2001 + (index % pageCount)),
    fileName: `file-${index}.txt`,
    versions: [
      { id: String(5000 + index * 2), version: 1, data: `first ${index}` },
      { id: String(5001 + index * 2), version: 2, data: `second ${index}` },
    ],
  }));
  return {
    space: { id: "6001", key: "BIG", name: "Large space", homePageId: "2000" },
    users: [ALICE, BOB],
    pages,
    attachments,
  };
}
