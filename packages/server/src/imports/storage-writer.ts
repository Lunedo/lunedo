import { escapeXml } from "./formats/escape.js";

function withoutControls(value: string): string {
  let result = "";
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code >= 0x20 || code === 0x09 || code === 0x0a || code === 0x0d) result += character;
  }
  return result;
}

export function text(value: string): string {
  return escapeXml(withoutControls(value));
}

export function attributes(values: Readonly<Record<string, string | null | undefined>>): string {
  return Object.entries(values)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")
    .map(([name, value]) => ` ${name}="${text(value)}"`)
    .join("");
}

export function element(
  name: string,
  values: Readonly<Record<string, string | null | undefined>>,
  content?: string,
): string {
  if (content === undefined) return `<${name}${attributes(values)}/>`;
  return `<${name}${attributes(values)}>${content}</${name}>`;
}

export function cdata(value: string): string {
  return `<![CDATA[${withoutControls(value).replaceAll("]]>", "]]]]><![CDATA[>")}]]>`;
}

export function macro(name: string, parameters: Readonly<Record<string, string>>, body: string): string {
  const params = Object.entries(parameters)
    .map(([key, value]) => element("ac:parameter", { "ac:name": key }, text(value)))
    .join("");
  return `<ac:structured-macro${attributes({ "ac:name": name })}>${params}${body}</ac:structured-macro>`;
}

export function codeMacro(code: string, language: string | null): string {
  return macro(
    "code",
    language ? { language } : {},
    `<ac:plain-text-body>${cdata(code)}</ac:plain-text-body>`,
  );
}

export function diagramMacro(name: "mermaid", source: string): string {
  return macro(name, {}, `<ac:plain-text-body>${cdata(source)}</ac:plain-text-body>`);
}

export function pageLink(sourceId: string, title: string, body: string | null): string {
  const target = element("ri:page", { "ri:content-id": sourceId, "ri:content-title": title });
  return `<ac:link>${target}${body ? `<ac:link-body>${body}</ac:link-body>` : ""}</ac:link>`;
}

export function attachmentLink(fileName: string, body: string | null): string {
  const target = element("ri:attachment", { "ri:filename": fileName });
  return `<ac:link>${target}${body ? `<ac:link-body>${body}</ac:link-body>` : ""}</ac:link>`;
}

export function attachmentImage(fileName: string, alt: string | null): string {
  return element(
    "ac:image",
    { "ac:alt": alt || null },
    element("ri:attachment", { "ri:filename": fileName }),
  );
}

export function urlImage(url: string, alt: string | null): string {
  return element("ac:image", { "ac:alt": alt || null }, element("ri:url", { "ri:value": url }));
}

export function includeMacro(sourceId: string, title: string): string {
  return macro("include", {}, `<ac:parameter ac:name="">${pageLink(sourceId, title, null)}</ac:parameter>`);
}

export function propertiesMacro(rows: readonly (readonly [string, string])[]): string {
  const body = rows
    .map(([key, value]) => `<tr><th>${text(key)}</th><td><p>${text(value)}</p></td></tr>`)
    .join("");
  return macro("details", {}, `<ac:rich-text-body><table><tbody>${body}</tbody></table></ac:rich-text-body>`);
}

export function taskList(tasks: readonly { done: boolean; body: string }[]): string {
  return `<ac:task-list>${tasks
    .map(
      (task) =>
        `<ac:task><ac:task-status>${task.done ? "complete" : "incomplete"}</ac:task-status><ac:task-body>${task.body}</ac:task-body></ac:task>`,
    )
    .join("")}</ac:task-list>`;
}
