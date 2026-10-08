import { documentSize } from "./extract.js";
import type { DocumentJson } from "./json.js";
import { createEditorKit } from "./kit.js";
import { defineModule, ModuleRegistry } from "./module.js";
import { codeBlockModule } from "./modules/code.js";
import { coreModule } from "./modules/core.js";
import { listsModule } from "./modules/lists.js";
import { formattingModule, linkModule } from "./modules/marks.js";
import { mentionModule } from "./modules/references.js";
import type { ValidationResult } from "./validate.js";

export const MAX_COMMENT_BYTES = 64 * 1024;

const COMMENT_NODES = new Set(["doc", "paragraph", "text", "hardBreak"]);

export const commentCoreModule = defineModule({
  name: "commentCore",
  nodes: coreModule.nodes.filter((node) => COMMENT_NODES.has(node.name)),
});

const commentFormattingModule = defineModule({
  name: "commentFormatting",
  marks: formattingModule.marks.map((mark) =>
    mark.name === "code"
      ? { ...mark, spec: { ...mark.spec, excludes: "bold italic underline strike subscript superscript" } }
      : mark,
  ),
});

export const commentModules = [
  commentCoreModule,
  linkModule,
  commentFormattingModule,
  listsModule,
  codeBlockModule,
  mentionModule,
] as const;

export const commentKit = createEditorKit(new ModuleRegistry().register(...commentModules));

export function validateComment(json: unknown): ValidationResult {
  if (documentSize(json) > MAX_COMMENT_BYTES) {
    return {
      ok: false,
      problems: [
        { path: "", code: "tooLarge", message: `A comment can have up to ${MAX_COMMENT_BYTES} bytes` },
      ],
    };
  }
  const result = commentKit.validate(json);
  if (
    result.ok &&
    commentKit.plainText(result.document).trim().length === 0 &&
    !hasMention(result.document)
  ) {
    return { ok: false, problems: [{ path: "", code: "invalidContent", message: "A comment needs text" }] };
  }
  return result;
}

function hasMention(node: { type: string; content?: unknown[] }): boolean {
  return (
    node.type === "mention" ||
    (node.content ?? []).some((child) => hasMention(child as { type: string; content?: unknown[] }))
  );
}

export function commentText(document: DocumentJson): string {
  return commentKit.plainText(document);
}
