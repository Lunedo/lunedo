import { randomUUID } from "node:crypto";

type Inline = string | Record<string, unknown>;

export function text(value: string, ...marks: string[]) {
  return marks.length === 0
    ? { type: "text", text: value }
    : { type: "text", text: value, marks: marks.map((type) => ({ type })) };
}

export function p(...parts: Inline[]) {
  const content = parts
    .filter((part) => part !== "")
    .map((part) => (typeof part === "string" ? text(part) : part));
  return content.length === 0 ? { type: "paragraph" } : { type: "paragraph", content };
}

export function h(level: number, title: string) {
  return { type: "heading", attrs: { level }, content: [text(title)] };
}

export function mention(id: string) {
  return { type: "mention", attrs: { id } };
}

export function bullets(...items: string[]) {
  return { type: "bulletList", content: items.map((item) => ({ type: "listItem", content: [p(item)] })) };
}

export function steps(...items: string[]) {
  return { type: "orderedList", content: items.map((item) => ({ type: "listItem", content: [p(item)] })) };
}

export function panel(variant: "info" | "tip" | "note" | "warning" | "error", ...paragraphs: string[]) {
  return { type: "callout", attrs: { variant }, content: paragraphs.map((paragraph) => p(paragraph)) };
}

function cell(type: "tableHeader" | "tableCell", value: string) {
  return { type, content: [p(value)] };
}

export function table(header: string[], ...rows: string[][]) {
  return {
    type: "table",
    content: [
      { type: "tableRow", content: header.map((value) => cell("tableHeader", value)) },
      ...rows.map((row) => ({ type: "tableRow", content: row.map((value) => cell("tableCell", value)) })),
    ],
  };
}

export function doc(...content: unknown[]) {
  return { type: "doc", content };
}

export function section(key: string, title: string, ...content: unknown[]) {
  return { type: "section", attrs: { key, title }, content };
}

export const NETWORK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="360" viewBox="0 0 720 360">
<rect width="720" height="360" fill="#ffffff"/>
<g font-family="Helvetica, Arial, sans-serif" font-size="14" text-anchor="middle" fill="#1f2933">
<rect x="300" y="20" width="120" height="48" rx="24" fill="#e8f1fb" stroke="#4a7fbf"/>
<text x="360" y="49">Internet</text>
<rect x="290" y="110" width="140" height="48" rx="6" fill="#fdeeee" stroke="#c0504d"/>
<text x="360" y="139">Firewall (HA)</text>
<rect x="290" y="200" width="140" height="48" rx="6" fill="#eaf5ea" stroke="#4f8a4f"/>
<text x="360" y="229">Core-Switch</text>
<rect x="40" y="290" width="170" height="48" rx="6" fill="#f4f4f4" stroke="#6b7280"/>
<text x="125" y="319">VLAN 10 · Büro</text>
<rect x="275" y="290" width="170" height="48" rx="6" fill="#f4f4f4" stroke="#6b7280"/>
<text x="360" y="319">VLAN 20 · Server</text>
<rect x="510" y="290" width="170" height="48" rx="6" fill="#f4f4f4" stroke="#6b7280"/>
<text x="595" y="319">VLAN 30 · Gäste-WLAN</text>
</g>
<g stroke="#6b7280" stroke-width="2" fill="none">
<path d="M360 68 V110"/><path d="M360 158 V200"/>
<path d="M360 248 V270 H125 V290"/><path d="M360 248 V290"/><path d="M360 248 V270 H595 V290"/>
</g>
</svg>`;

export const NETWORK_DRAWIO = `<mxfile host="embed.diagrams.net"><diagram id="netz" name="Standort Wien"><mxGraphModel><root>
<mxCell id="0"/><mxCell id="1" parent="0"/>
<mxCell id="internet" value="Internet" style="ellipse;whiteSpace=wrap;html=1;fillColor=#e8f1fb;strokeColor=#4a7fbf;" vertex="1" parent="1"><mxGeometry x="300" y="20" width="120" height="48" as="geometry"/></mxCell>
<mxCell id="firewall" value="Firewall (HA)" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#fdeeee;strokeColor=#c0504d;" vertex="1" parent="1"><mxGeometry x="290" y="110" width="140" height="48" as="geometry"/></mxCell>
<mxCell id="core" value="Core-Switch" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#eaf5ea;strokeColor=#4f8a4f;" vertex="1" parent="1"><mxGeometry x="290" y="200" width="140" height="48" as="geometry"/></mxCell>
<mxCell id="office" value="VLAN 10 · Büro" style="rounded=1;whiteSpace=wrap;html=1;" vertex="1" parent="1"><mxGeometry x="40" y="290" width="170" height="48" as="geometry"/></mxCell>
<mxCell id="server" value="VLAN 20 · Server" style="rounded=1;whiteSpace=wrap;html=1;" vertex="1" parent="1"><mxGeometry x="275" y="290" width="170" height="48" as="geometry"/></mxCell>
<mxCell id="guests" value="VLAN 30 · Gäste-WLAN" style="rounded=1;whiteSpace=wrap;html=1;" vertex="1" parent="1"><mxGeometry x="510" y="290" width="170" height="48" as="geometry"/></mxCell>
<mxCell id="e1" edge="1" parent="1" source="internet" target="firewall"><mxGeometry relative="1" as="geometry"/></mxCell>
<mxCell id="e2" edge="1" parent="1" source="firewall" target="core"><mxGeometry relative="1" as="geometry"/></mxCell>
<mxCell id="e3" edge="1" parent="1" source="core" target="office" style="edgeStyle=orthogonalEdgeStyle;"><mxGeometry relative="1" as="geometry"/></mxCell>
<mxCell id="e4" edge="1" parent="1" source="core" target="server"><mxGeometry relative="1" as="geometry"/></mxCell>
<mxCell id="e5" edge="1" parent="1" source="core" target="guests" style="edgeStyle=orthogonalEdgeStyle;"><mxGeometry relative="1" as="geometry"/></mxCell>
</root></mxGraphModel></diagram></mxfile>`;

export const MERMAID_SOURCE = `flowchart LR
  A[Störung gemeldet] --> B{Kritisch?}
  B -- ja --> C[Bereitschaft anrufen]
  B -- nein --> D[Ticket anlegen]
  C --> E[Lösung dokumentieren]
  D --> E`;

export const RACK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675">
<defs><linearGradient id="floor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#dfe6ee"/><stop offset="1" stop-color="#b8c4d1"/></linearGradient></defs>
<rect width="1200" height="675" fill="url(#floor)"/>
<rect x="0" y="520" width="1200" height="155" fill="#9aa8b8"/>
${[160, 470, 780]
  .map(
    (x) => `<g transform="translate(${x} 70)"><rect width="260" height="470" rx="8" fill="#2b3440"/>
${Array.from({ length: 11 }, (_, row) => `<rect x="18" y="${20 + row * 40}" width="224" height="30" rx="3" fill="#3d4856"/><circle cx="34" cy="${35 + row * 40}" r="4" fill="${row % 4 === 0 ? "#f5b942" : "#52c47a"}"/><rect x="50" y="${31 + row * 40}" width="120" height="8" rx="2" fill="#566273"/>`).join("")}
</g>`,
  )
  .join("")}
</svg>`;

export function richDocument(ids: {
  lena: string;
  jonas: string;
  mateo: string;
  includePageId: string;
  imageId: string;
  dueSoon: string;
  drawio: Record<string, unknown>;
}) {
  return doc(
    p(
      "Diese Seite beschreibt das Netz am Standort Wien: Segmente, Firewall-Regeln und die Ansprechpersonen. Fragen gehen an ",
      mention(ids.lena),
      " oder ",
      mention(ids.jonas),
      ".",
    ),
    panel("info", "Gültig ab 1. November 2026. Änderungen am Netz bitte immer über einen Change-Antrag."),
    h(2, "Segmente"),
    table(
      ["VLAN", "Zweck", "Adressbereich", "Gateway"],
      ["10", "Büro-Arbeitsplätze", "10.20.10.0/24", "10.20.10.1"],
      ["20", "Server und Speicher", "10.20.20.0/24", "10.20.20.1"],
      ["30", "Gäste-WLAN, nur Internet", "172.16.30.0/24", "172.16.30.1"],
      ["40", "Drucker und Multifunktionsgeräte", "10.20.40.0/24", "10.20.40.1"],
    ),
    panel("tip", "Die aktuelle Belegung der Ports steht im Switch-Inventar unter Netzwerk › Inventar."),
    h(2, "Übersicht"),
    { type: "drawio", attrs: ids.drawio },
    h(2, "Serverraum"),
    {
      type: "image",
      attrs: {
        attachmentId: ids.imageId,
        alt: "Serverraum mit drei Racks",
        width: 95,
        align: "center",
        frame: true,
      },
    },
    panel("note", "Der Serverraum ist nur mit Zutrittskarte und in Begleitung von IT-Betrieb zugänglich."),
    h(2, "Firewall-Regeln"),
    p("Die Regeln werden als Code gepflegt und bei jedem Merge automatisch ausgerollt:"),
    {
      type: "codeBlock",
      attrs: { language: "yaml" },
      content: [
        text(
          "rules:\n  - name: buero-zu-server\n    from: vlan10\n    to: vlan20\n    ports: [443, 445, 3389]\n    action: allow\n  - name: gaeste-isoliert\n    from: vlan30\n    to: [vlan10, vlan20, vlan40]\n    action: deny",
        ),
      ],
    },
    panel("warning", "Regeln für das Gäste-WLAN nie lockern. Gäste erreichen ausschließlich das Internet."),
    panel("error", "Bekannte Störung: Die zweite Firewall meldet seit dem Update 7.4.2 sporadisch Failover."),
    { type: "includePage", attrs: { pageId: ids.includePageId, sourceSpace: null, sourceTitle: null } },
    h(2, "Offene Aufgaben"),
    {
      type: "taskList",
      content: [
        {
          type: "taskItem",
          attrs: { assignee: ids.lena, dueDate: ids.dueSoon },
          content: [p("Firmware der zweiten Firewall auf 7.4.3 aktualisieren")],
        },
        {
          type: "taskItem",
          attrs: { assignee: ids.jonas, dueDate: "2026-10-20" },
          content: [p("Gäste-WLAN auf WPA3 umstellen")],
        },
        {
          type: "taskItem",
          attrs: { assignee: ids.mateo, dueDate: "2026-12-01" },
          content: [p("Switch-Inventar mit der Dokumentation abgleichen")],
        },
      ],
    },
    h(2, "Ablauf bei Störungen"),
    p("Wer eine Störung meldet, folgt diesem Ablauf. Die Bereitschaft ist rund um die Uhr erreichbar."),
  );
}

export function firstVersion() {
  return doc(
    p("Diese Seite beschreibt das Netz am Standort Wien."),
    h(2, "Segmente"),
    table(
      ["VLAN", "Zweck", "Adressbereich"],
      ["10", "Büro-Arbeitsplätze", "10.20.10.0/24"],
      ["20", "Server", "10.20.20.0/24"],
    ),
    h(2, "Firewall-Regeln"),
    p("Die Regeln liegen im Repository der Netzwerkkonfiguration."),
  );
}

export const FIREWALL_DOCUMENT = doc(
  h(2, "Freigaben für Dienstleister"),
  p(
    "Externe Dienstleister erhalten Zugriff nur über das Jump-Host-Segment und nur für die Dauer des Auftrags.",
  ),
  bullets(
    "Antrag mindestens drei Werktage vorher stellen",
    "Zugang endet automatisch am Ende des Auftrags",
    "Jede Sitzung wird protokolliert",
  ),
);

export const TREE: { title: string; text: string; children?: typeof TREE }[] = [
  {
    title: "Arbeitsplatz und Geräte",
    text: "Alles rund um Laptops, Drucker und Mobilgeräte im Unternehmen.",
    children: [
      {
        title: "Laptop einrichten",
        text: "Neue Laptops werden vorinstalliert ausgegeben. Die ersten Schritte dauern etwa 20 Minuten.",
        children: [
          {
            title: "Windows-Laptop",
            text: "Beim ersten Start mit dem Firmenkonto anmelden und die Bitlocker-Wiederherstellung bestätigen.",
          },
          {
            title: "MacBook",
            text: "Das MacBook registriert sich über die Geräteverwaltung. Danach installiert das Self-Service-Portal die Programme.",
          },
        ],
      },
      { title: "Drucker im Büro", text: "Druckaufträge werden mit der Zutrittskarte am Gerät freigegeben." },
      { title: "Mobilgeräte", text: "Diensthandys werden über die Geräteverwaltung eingerichtet." },
    ],
  },
  {
    title: "Netzwerk",
    text: "Aufbau des Netzes, Zugänge und Regeln.",
    children: [
      {
        title: "VPN-Zugang",
        text: "Mit dem VPN erreichst du von zu Hause die internen Laufwerke.",
        children: [
          {
            title: "VPN unter Windows",
            text: "Den VPN-Client aus dem Startmenü öffnen und Verbinden wählen.",
          },
          { title: "VPN unter macOS", text: "Den VPN-Client aus dem Programme-Ordner starten." },
        ],
      },
      {
        title: "WLAN für Gäste",
        text: "Das Gäste-WLAN heißt Northwind-Gast. Das Passwort wechselt jeden Montag.",
      },
    ],
  },
  {
    title: "Betrieb",
    text: "Bereitschaft, Wartung und Störungen.",
    children: [
      {
        title: "Bereitschaftsdienst",
        text: "Die Bereitschaft wechselt jeden Montag um 9 Uhr. Der Plan liegt im Teamkalender.",
      },
      {
        title: "Wartungsfenster 2026",
        text: "Wartungen finden am zweiten Dienstag im Monat ab 20 Uhr statt.",
      },
      {
        title: "Störungsablauf",
        text: "Störungen werden im Ticketsystem erfasst und nach Dringlichkeit bearbeitet.",
      },
    ],
  },
  {
    title: "Sicherheit",
    text: "Richtlinien und Hinweise zur Informationssicherheit.",
    children: [
      {
        title: "Passwortrichtlinie",
        text: "Passwörter haben mindestens 14 Zeichen. Ein Passwortmanager ist Pflicht.",
      },
      {
        title: "Umgang mit Phishing",
        text: "Verdächtige Mails mit der Schaltfläche Melden an die IT weiterleiten und nicht öffnen.",
      },
    ],
  },
  {
    title: "Onboarding für neue Mitarbeitende",
    text: "Checkliste für die ersten Tage: Konto, Laptop, Zugänge und Ansprechpersonen.",
  },
];

export const KNOWLEDGE_BASE: {
  category: string;
  description: string;
  icon: string;
  articles: { title: string; type: "howTo" | "troubleshooting"; lead: string; english?: string }[];
}[] = [
  {
    category: "IT und Geräte",
    description: "Konten, Laptops, Drucker und Arbeiten von zu Hause.",
    icon: "monitor",
    articles: [
      {
        title: "VPN-Verbindung von zu Hause einrichten",
        type: "howTo",
        lead: "Mit der VPN-Verbindung erreichst du von zu Hause die internen Laufwerke.",
        english: "Set up the VPN connection from home",
      },
      {
        title: "Passwort zurücksetzen",
        type: "howTo",
        lead: "So setzt du dein Passwort selbst zurück, auch wenn du es vergessen hast.",
        english: "Reset your password",
      },
      {
        title: "Drucker zeigt Auftrag angehalten",
        type: "troubleshooting",
        lead: "Dein Druckauftrag steht in der Warteschlange, aber der Drucker druckt nicht.",
      },
      {
        title: "VPN trennt nach wenigen Minuten",
        type: "troubleshooting",
        lead: "Die VPN-Verbindung bricht nach kurzer Zeit ab.",
      },
    ],
  },
  {
    category: "Personal",
    description: "Urlaub, Gehalt, Reisen und die ersten Tage.",
    icon: "users",
    articles: [
      {
        title: "Urlaub beantragen",
        type: "howTo",
        lead: "Urlaub beantragst du im Zeiterfassungsportal. Dort siehst du auch, wer ihn genehmigt.",
      },
      {
        title: "Reisekosten abrechnen",
        type: "howTo",
        lead: "Belege fotografieren, in der App erfassen und innerhalb von 30 Tagen einreichen.",
      },
      {
        title: "Gehaltszettel nicht im Postfach",
        type: "troubleshooting",
        lead: "Der Gehaltszettel des Monats ist nicht im digitalen Postfach angekommen.",
      },
    ],
  },
  {
    category: "Gebäude und Büro",
    description: "Zutritt, Arbeitsplätze, Parken und Besprechungsräume.",
    icon: "briefcase",
    articles: [
      {
        title: "Besprechungsraum buchen",
        type: "howTo",
        lead: "Räume buchst du im Kalender. Größere Räume brauchen eine Freigabe des Empfangs.",
      },
      {
        title: "Zutrittskarte verloren",
        type: "howTo",
        lead: "Eine verlorene Karte sofort sperren lassen und eine Ersatzkarte am Empfang holen.",
      },
      {
        title: "Schreibtisch für einen Tag reservieren",
        type: "howTo",
        lead: "Freie Schreibtische reservierst du in der Arbeitsplatz-App bis 18 Uhr am Vortag.",
      },
    ],
  },
];

export function howTo(lead: string) {
  return doc(
    section("summary", "Worum es geht", p(lead)),
    section(
      "prerequisites",
      "Bevor du beginnst",
      bullets("Du arbeitest an einem Firmenlaptop.", "Die Zwei-Faktor-Anmeldung ist eingerichtet."),
    ),
    section(
      "steps",
      "Schritte",
      steps(
        "Das Self-Service-Portal im Startmenü öffnen.",
        "Den passenden Eintrag suchen und Starten wählen.",
        "Die Anmeldung in der Authenticator-App bestätigen.",
      ),
      panel("info", "Das Portal merkt sich deine Auswahl. Beim nächsten Mal genügt ein Klick."),
    ),
    section(
      "help",
      "Hat es nicht geklappt?",
      p("Laptop neu starten und es noch einmal versuchen. Sonst hilft der Service Desk."),
    ),
  );
}

export function troubleshooting(lead: string) {
  return doc(
    section("symptom", "Was du siehst", p(lead)),
    section("cause", "Ursache", p("Der Dienst wartet auf eine Bestätigung, die nicht angekommen ist.")),
    section(
      "resolution",
      "Lösung",
      p("Die Anwendung schließen, eine Minute warten und neu starten."),
      panel("warning", "Aufträge, die nicht innerhalb von 24 Stunden bestätigt werden, werden gelöscht."),
    ),
  );
}

export function howToEnglish(lead: string) {
  return doc(
    section("summary", "What this is about", p(lead)),
    section(
      "prerequisites",
      "Before you start",
      bullets("You work on a company laptop.", "Two-factor sign-in is set up."),
    ),
    section(
      "steps",
      "Steps",
      steps(
        "Open the self-service portal from the start menu.",
        "Find the entry and choose Start.",
        "Confirm the sign-in in the authenticator app.",
      ),
    ),
    section(
      "help",
      "Did it not work?",
      p("Restart the laptop and try again. Otherwise the service desk helps."),
    ),
  );
}

export const ENGINEERING_TREE: { title: string; text: string; children?: typeof ENGINEERING_TREE }[] = [
  {
    title: "Architecture overview",
    text: "How our services fit together and which team owns which part.",
    children: [
      { title: "Service map", text: "Every production service with its owner, dependencies and dashboards." },
      { title: "Decision log", text: "Architecture decisions with their context and consequences." },
    ],
  },
  {
    title: "Operations",
    text: "Everything you need while you are on call or shipping a release.",
    children: [
      { title: "On-call runbook", text: "" },
      {
        title: "Incident reviews",
        text: "Blameless reviews of every SEV1 and SEV2 incident.",
        children: [
          {
            title: "Payment queue backlog, September",
            text: "A stuck consumer delayed payment confirmations for 40 minutes.",
          },
        ],
      },
      { title: "Release checklist", text: "Steps before, during and after a production release." },
    ],
  },
  {
    title: "Onboarding for engineers",
    text: "Your first two weeks on the engineering team.",
    children: [
      { title: "Local development setup", text: "Install the tools and run the platform on your laptop." },
    ],
  },
  { title: "Coding guidelines", text: "Conventions for code, reviews and tests." },
];

export function runbookDocument(ids: { lena: string; jonas: string; aylin: string; mateo: string }) {
  const task = (label: string, assignee: string | null = null) => ({
    type: "taskItem",
    attrs: { id: randomUUID(), assignee, dueDate: null },
    content: [p(label)],
  });
  return doc(
    p(
      "This runbook covers the first hour of an incident: who to call, what to check and where to write things down. It applies to every service the platform team runs in production.",
    ),
    panel(
      "info",
      "The rotation changes every Monday at 09:00. Swap shifts in the on-call calendar, not in chat.",
    ),
    h(2, "Escalation contacts"),
    table(
      ["Role", "Person", "How to reach"],
      ["Primary on-call", "Lena Hofer", "Pager, then phone +1 555 0142"],
      ["Secondary on-call", "Jonas Berger", "Pager"],
      ["Engineering manager", "Aylin Demir", "Phone +1 555 0187"],
      ["Database owner", "Mateo Rossi", "Chat, #db-help"],
    ),
    h(2, "First steps"),
    {
      type: "taskList",
      content: [
        task("Acknowledge the page within five minutes"),
        task("Open an incident channel and post the alert link"),
        task("Check error rate and latency on the service dashboard", ids.lena),
        task("Set the severity and inform the engineering manager for SEV1 and SEV2", ids.jonas),
        task("Post a short status update every 30 minutes", ids.aylin),
      ],
    },
    h(2, "After the incident"),
    p(
      "Write the incident review within two working days and link it under Operations › Incident reviews. ",
      mention(ids.mateo),
      " reviews every change to the database runbooks.",
    ),
  );
}

export function avatarSvg(background: string, skin: string, hair: string, shirt: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
  <rect width="256" height="256" fill="${background}"/>
  <path d="M38 256c6-52 44-80 90-80s84 28 90 80z" fill="${shirt}"/>
  <rect x="110" y="140" width="36" height="44" rx="14" fill="${skin}"/>
  <ellipse cx="128" cy="106" rx="46" ry="54" fill="${skin}"/>
  <path d="M80 102c-4-40 20-64 50-64 30 0 52 22 48 62-10-20-30-30-50-30-22 0-38 12-48 32z" fill="${hair}"/>
</svg>`;
}
