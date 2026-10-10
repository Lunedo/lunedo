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

export const CAROL = { key: "8a7f0003", accountId: "557058:dddddddd-0004" };
export const DAVE = { key: "8a7f0004", accountId: "557058:eeeeeeee-0005" };

export const PEOPLE_PAGE = {
  home: "7001",
  plan: "7002",
  secret: "7003",
  editors: "7004",
  history: "7005",
  tasks: "7006",
  blog: "7101",
} as const;

export const PEOPLE_COMMENT = {
  root: "7201",
  reply: "7202",
  replyToReply: "7203",
  inlineFound: "7204",
  inlineMissing: "7205",
  inlineResolved: "7206",
  inlineDangling: "7207",
  onBlog: "7208",
} as const;

export const OLD_DATE = "2021-06-15 09:00:00.000";
export const OLDER_DATE = "2020-01-10 08:30:00.000";

export function peopleExport(): SyntheticExport {
  return {
    space: { id: "8001", key: "PPL", name: "People space", homePageId: PEOPLE_PAGE.home },
    users: [ALICE, BOB, CAROL, DAVE],
    pages: [
      {
        id: PEOPLE_PAGE.home,
        title: "People home",
        parentId: null,
        position: null,
        body: "<p>Home</p>",
        creatorKey: ALICE.key,
      },
      {
        id: PEOPLE_PAGE.plan,
        title: "Plan",
        parentId: PEOPLE_PAGE.home,
        position: 1,
        body: [
          '<p>The <ac:inline-comment-marker ac:ref="marker-found">rollout window</ac:inline-comment-marker> is fixed.</p>',
          '<p>Next <ac:inline-comment-marker ac:ref="marker-resolved">backup check</ac:inline-comment-marker> is done.</p>',
        ].join(""),
        creatorKey: CAROL.key,
        modifierKey: CAROL.key,
        created: OLDER_DATE,
        modified: OLD_DATE,
      },
      {
        id: PEOPLE_PAGE.secret,
        title: "Salary bands",
        parentId: PEOPLE_PAGE.home,
        position: 2,
        body: "<p>Confidential numbers</p>",
        creatorKey: ALICE.key,
      },
      {
        id: PEOPLE_PAGE.editors,
        title: "Editors only",
        parentId: PEOPLE_PAGE.home,
        position: 3,
        body: "<p>Editors may change this</p>",
        creatorKey: ALICE.key,
      },
      {
        id: PEOPLE_PAGE.history,
        title: "Release notes",
        parentId: PEOPLE_PAGE.home,
        position: 4,
        body: "<p>Version three</p>",
        creatorKey: ALICE.key,
        modifierKey: BOB.key,
        modified: "2023-03-03 03:03:03.000",
        history: [
          {
            id: "7051",
            body: "<p>Version one</p>",
            title: "Notes",
            authorKey: ALICE.key,
            modified: "2023-01-01 01:01:01.000",
          },
          {
            id: "7052",
            body: "<p>Version two</p>",
            authorKey: CAROL.key,
            modified: "2023-02-02 02:02:02.000",
          },
        ],
      },
      {
        id: PEOPLE_PAGE.tasks,
        title: "Tasks and mentions",
        parentId: PEOPLE_PAGE.home,
        position: 5,
        body: [
          `<p>Hello <ac:link><ri:user ri:account-id="${BOB.accountId}" /></ac:link> and `,
          `<ac:link><ri:user ri:account-id="${ALICE.accountId}" /></ac:link></p>`,
          "<ac:task-list><ac:task><ac:task-id>1</ac:task-id><ac:task-status>incomplete</ac:task-status>",
          `<ac:task-body>Check <ac:link><ri:user ri:account-id="${BOB.accountId}" /></ac:link></ac:task-body></ac:task>`,
          "<ac:task><ac:task-id>2</ac:task-id><ac:task-status>incomplete</ac:task-status>",
          `<ac:task-body><ac:link><ri:user ri:account-id="${ALICE.accountId}" /></ac:link> reviews `,
          '<time datetime="2024-07-01" /></ac:task-body></ac:task></ac:task-list>',
        ].join(""),
        creatorKey: ALICE.key,
      },
    ],
    blogPosts: [
      {
        id: PEOPLE_PAGE.blog,
        title: "Quarterly update",
        parentId: null,
        position: null,
        body: "<p>We shipped it</p>",
        creatorKey: CAROL.key,
        created: OLD_DATE,
        modified: OLD_DATE,
        labels: ["news"],
      },
    ],
    attachments: [
      { pageId: PEOPLE_PAGE.blog, fileName: "chart.png", versions: [{ id: "7301", version: 1, data: PNG }] },
    ],
    comments: [
      {
        id: PEOPLE_COMMENT.root,
        pageId: PEOPLE_PAGE.plan,
        creatorKey: BOB.key,
        body: "<p>Looks good</p>",
        created: OLDER_DATE,
      },
      {
        id: PEOPLE_COMMENT.reply,
        pageId: PEOPLE_PAGE.plan,
        parentId: PEOPLE_COMMENT.root,
        creatorKey: CAROL.key,
        body: `<p>Thanks <ac:link><ri:user ri:account-id="${BOB.accountId}" /></ac:link></p>`,
        created: OLD_DATE,
      },
      {
        id: PEOPLE_COMMENT.replyToReply,
        pageId: PEOPLE_PAGE.plan,
        parentId: PEOPLE_COMMENT.reply,
        creatorKey: BOB.key,
        body: "<h2>Heading</h2><table><tbody><tr><td>cell</td></tr></tbody></table>",
        created: "2021-06-16 09:00:00.000",
      },
      {
        id: PEOPLE_COMMENT.inlineFound,
        pageId: PEOPLE_PAGE.plan,
        creatorKey: BOB.key,
        body: "<p>Which window?</p>",
        inline: { markerRef: "marker-found", selection: "rollout window" },
        status: "open",
      },
      {
        id: PEOPLE_COMMENT.inlineMissing,
        pageId: PEOPLE_PAGE.plan,
        creatorKey: BOB.key,
        body: "<p>This text is gone</p>",
        inline: { markerRef: "marker-gone", selection: "removed sentence" },
        status: "open",
      },
      {
        id: PEOPLE_COMMENT.inlineResolved,
        pageId: PEOPLE_PAGE.plan,
        creatorKey: CAROL.key,
        body: "<p>Done already</p>",
        inline: { markerRef: "marker-resolved", selection: "backup check" },
        status: "resolved",
        resolverKey: ALICE.key,
      },
      {
        id: PEOPLE_COMMENT.inlineDangling,
        pageId: PEOPLE_PAGE.plan,
        creatorKey: CAROL.key,
        body: "<p>Old remark</p>",
        inline: { markerRef: "marker-dangling", selection: "older wording" },
        status: "dangling",
      },
      {
        id: PEOPLE_COMMENT.onBlog,
        pageId: PEOPLE_PAGE.blog,
        creatorKey: BOB.key,
        body: `<p>Great news, <ac:link><ri:user ri:account-id="${ALICE.accountId}" /></ac:link></p>`,
      },
    ],
    likes: [
      { id: "7401", contentId: PEOPLE_PAGE.plan, userKey: BOB.key },
      { id: "7402", contentId: PEOPLE_COMMENT.root, userKey: CAROL.key },
      { id: "7403", contentId: PEOPLE_PAGE.blog, userKey: ALICE.key },
      { id: "7404", contentId: PEOPLE_PAGE.blog, userKey: BOB.key },
    ],
    watchers: 3,
    spacePermissions: [
      ...["VIEWSPACE", "COMMENT"].map((type, index) => ({
        id: `81${index}`,
        type,
        group: "confluence-users",
      })),
      ...["VIEWSPACE", "EDITSPACE", "REMOVEPAGE", "SETPAGEPERMISSIONS", "COMMENT"].map((type, index) => ({
        id: `82${index}`,
        type,
        group: "Editors",
      })),
      ...["VIEWSPACE", "EDITSPACE", "COMMENT", "SETSPACEPERMISSIONS", "REMOVEPAGE", "SETPAGEPERMISSIONS"].map(
        (type, index) => ({ id: `83${index}`, type, userKey: ALICE.key }),
      ),
      ...["VIEWSPACE", "EDITSPACE"].map((type, index) => ({ id: `84${index}`, type, userKey: BOB.key })),
      { id: "850", type: "VIEWSPACE", userKey: CAROL.key },
      ...["VIEWSPACE", "REMOVEPAGE"].map((type, index) => ({ id: `86${index}`, type, group: "contractors" })),
      { id: "870", type: "EXPORTSPACE", group: "auditors" },
      { id: "880", type: "VIEWSPACE", allUsers: true },
      { id: "890", type: "VIEWSPACE" },
    ],
    restrictions: [
      { id: "7501", contentId: PEOPLE_PAGE.secret, kind: "View", userKey: CAROL.key },
      { id: "7502", contentId: PEOPLE_PAGE.secret, kind: "View", group: "hr-team" },
      { id: "7503", contentId: PEOPLE_PAGE.editors, kind: "Edit", group: "Editors" },
    ],
  };
}
