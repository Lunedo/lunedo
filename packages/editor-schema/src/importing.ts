import type { NodeJson } from "./json.js";

export interface SourceElement {
  readonly name: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly children: readonly SourceContent[];
}

export type SourceContent = SourceElement | string;

export type ImportSource = "confluence";

export interface ImportedAttachment {
  readonly attachmentId: string;
  readonly name: string;
}

export interface ImportedFile extends ImportedAttachment {
  readonly version: number;
}

export interface FileReference {
  readonly fileName: string;
}

export type MacroNote =
  | { readonly code: "diagramFileMissing"; readonly macro: string; readonly name: string }
  | { readonly code: "gliffyDiagram"; readonly name: string }
  | { readonly code: "diagramPageMissing"; readonly name: string }
  | { readonly code: "unmappedQuery"; readonly macro: string; readonly query: string }
  | { readonly code: "macroOptionDropped"; readonly macro: string; readonly option: string }
  | {
      readonly code: "unresolvedInclude";
      readonly macro: string;
      readonly title: string;
      readonly spaceKey: string | null;
    }
  | { readonly code: "externalPageLink"; readonly title: string; readonly spaceKey: string | null }
  | { readonly code: "embedNotAllowed"; readonly macro: string; readonly url: string }
  | { readonly code: "previewOnly"; readonly macro: string; readonly name: string }
  | { readonly code: "previewMissing"; readonly macro: string; readonly name: string }
  | { readonly code: "chartNotImported"; readonly macro: string }
  | { readonly code: "jiraNotImported"; readonly macro: string; readonly issues: string };

export const importTexts = [
  "jiraNotImported",
  "chartNotImported",
  "pivotNotImported",
  "whiteboardNotImported",
  "databaseNotImported",
  "contentNotImported",
] as const;
export type ImportText = (typeof importTexts)[number];

export const defaultImportTexts: Readonly<Record<ImportText, string>> = {
  jiraNotImported: "Jira content not imported.",
  chartNotImported: "Chart not imported. Its source table follows.",
  pivotNotImported: "Pivot table not imported. Its source table follows.",
  whiteboardNotImported: "Confluence whiteboard not imported.",
  databaseNotImported: "Confluence database not imported.",
  contentNotImported: "Confluence content of this type not imported.",
};

export interface MacroImportContext {
  readonly spaceKey: string | null;
  blocks(content: readonly SourceContent[]): NodeJson[];
  inline(content: readonly SourceContent[]): NodeJson[];
  attachment(reference: SourceElement, page: SourceElement | null): ImportedAttachment | null;
  file(reference: FileReference): ImportedFile | null;
  page(reference: SourceElement, options?: { formerTitles?: boolean }): string | null;
  pageById(sourceId: string): string | null;
  space(key: string | null): string | null;
  template(sourceId: string): string | null;
  note(note: MacroNote): void;
  newId(): string;
  diagramId(name: string, pageSourceId: string | null): string;
  embeddable(url: string): boolean;
  numberHeadings(): void;
  text(key: ImportText): string;
  jiraIssueUrl(key: string): string | null;
}

export interface MacroReferences {
  readonly pageIds?: readonly string[];
  readonly pageTitles?: readonly string[];
  readonly files?: readonly FileReference[];
}

export interface MacroConverter {
  readonly source: ImportSource;
  readonly macros: readonly string[];
  readonly inline?: boolean;
  references?(macro: SourceElement): MacroReferences;
  convert(macro: SourceElement, context: MacroImportContext): NodeJson[] | null;
}

export function sourceElements(node: SourceElement, name?: string): SourceElement[] {
  return node.children.filter(
    (child): child is SourceElement =>
      typeof child !== "string" && (name === undefined || child.name === name),
  );
}

export function firstSourceElement(node: SourceElement, name: string): SourceElement | null {
  return sourceElements(node, name)[0] ?? null;
}

export function sourceText(node: SourceContent): string {
  if (typeof node === "string") return node;
  return node.children.map(sourceText).join("");
}

export function macroParameter(macro: SourceElement, name: string): SourceElement | null {
  return (
    sourceElements(macro, "ac:parameter").find((parameter) => parameter.attributes["ac:name"] === name) ??
    null
  );
}

export function macroText(macro: SourceElement, name: string): string | null {
  const parameter = macroParameter(macro, name);
  return parameter ? sourceText(parameter).trim() : null;
}

export function adfParameter(macro: SourceElement, name: string): string | null {
  const node = macro.name === "ac:adf-node" ? macro : firstSourceElement(macro, "ac:adf-node");
  if (!node) return null;
  const search = (parent: SourceElement): string | null => {
    for (const child of sourceElements(parent)) {
      if (
        child.name === "ac:adf-parameter" &&
        child.attributes.key === name &&
        sourceElements(child).length === 0
      ) {
        return sourceText(child).trim();
      }
      const nested = search(child);
      if (nested !== null) return nested;
    }
    return null;
  };
  for (const attribute of sourceElements(node, "ac:adf-attribute")) {
    if (attribute.attributes.key !== "parameters") continue;
    const found = search(attribute);
    if (found !== null) return found;
  }
  return null;
}

export function macroParameterNames(macro: SourceElement): string[] {
  return sourceElements(macro, "ac:parameter").map((parameter) => parameter.attributes["ac:name"] ?? "");
}

export function macroReference(macro: SourceElement, parameter: string, name: string): SourceElement | null {
  const found = macroParameter(macro, parameter);
  if (!found) return null;
  const search = (node: SourceElement): SourceElement | null => {
    for (const child of sourceElements(node)) {
      if (child.name === name) return child;
      const nested = search(child);
      if (nested) return nested;
    }
    return null;
  };
  return search(found);
}

export function macroReferences(macro: SourceElement, parameter: string, name: string): SourceElement[] {
  const found = macroParameter(macro, parameter);
  if (!found) return [];
  const result: SourceElement[] = [];
  const search = (node: SourceElement) => {
    for (const child of sourceElements(node)) {
      if (child.name === name) result.push(child);
      else search(child);
    }
  };
  search(found);
  return result;
}

export function listValues(value: string | null): string[] {
  return (value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

export function macroSpaceKeys(macro: SourceElement, parameter: string): string[] {
  const references = macroReferences(macro, parameter, "ri:space");
  if (references.length > 0) return references.map((reference) => reference.attributes["ri:space-key"] ?? "");
  return listValues(macroText(macro, parameter));
}

export function richBody(macro: SourceElement): SourceElement | null {
  return firstSourceElement(macro, "ac:rich-text-body");
}

export function plainBody(macro: SourceElement): string | null {
  const body = firstSourceElement(macro, "ac:plain-text-body");
  return body ? sourceText(body) : null;
}

export function singleLine(text: string | null): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

export function bodyBlocks(macro: SourceElement, context: MacroImportContext): NodeJson[] {
  const body = richBody(macro);
  const blocks = body ? context.blocks(body.children) : [];
  return blocks.length > 0 ? blocks : [{ type: "paragraph" }];
}

export function titleParagraph(title: string | null): NodeJson[] {
  const text = singleLine(title);
  if (text.length === 0) return [];
  return [{ type: "paragraph", content: [{ type: "text", text, marks: [{ type: "bold" }] }] }];
}

export function isTrue(value: string | null): boolean {
  return value?.toLowerCase() === "true";
}

export function boundedInteger(value: string | null, minimum: number, maximum: number): number | null {
  if (value === null || !/^\d{1,6}$/.test(value)) return null;
  const number = Number(value);
  return number >= minimum && number <= maximum ? number : null;
}
