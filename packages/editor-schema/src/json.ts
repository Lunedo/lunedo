export interface MarkJson {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface NodeJson {
  type: string;
  attrs?: Record<string, unknown>;
  content?: NodeJson[];
  marks?: MarkJson[];
  text?: string;
}

export interface DocumentJson extends NodeJson {
  type: "doc";
}

export interface ValidMark {
  type: string;
  attrs: Record<string, unknown>;
}

export interface ValidNode {
  type: string;
  attrs: Record<string, unknown>;
  content: ValidNode[];
  marks: ValidMark[];
  text?: string;
}

export function toValidNode(node: NodeJson): ValidNode {
  return {
    type: node.type,
    attrs: node.attrs ?? {},
    content: (node.content ?? []).map(toValidNode),
    marks: (node.marks ?? []).map((mark) => ({ type: mark.type, attrs: mark.attrs ?? {} })),
    ...(node.text === undefined ? {} : { text: node.text }),
  };
}
