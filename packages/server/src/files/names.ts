export const FILE_NAME_MAX_LENGTH = 255;

function isHiddenCharacter(character: string): boolean {
  const code = character.codePointAt(0) ?? 0;
  return (
    code < 0x20 ||
    (code >= 0x7f && code <= 0x9f) ||
    code === 0x200e ||
    code === 0x200f ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069) ||
    code === 0xfeff
  );
}

export function cleanFileName(raw: string): string | null {
  const last = raw.normalize("NFC").split(/[/\\]/).pop() ?? "";
  let name = [...last]
    .filter((character) => !isHiddenCharacter(character))
    .join("")
    .replace(/[<>:"|?*]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  name = name.replace(/^\.+/, (dots) => (dots.length === name.length ? "" : dots.replace(/\./g, "_")));
  if (name === "" || name === "." || name === "..") return null;
  if (name.length > FILE_NAME_MAX_LENGTH) {
    const extension = /\.[^.]{1,16}$/.exec(name)?.[0] ?? "";
    name = `${name.slice(0, FILE_NAME_MAX_LENGTH - extension.length)}${extension}`;
  }
  return name;
}

export function fileNameKey(name: string): string {
  return name.normalize("NFC").toLowerCase();
}

export function contentDisposition(kind: "inline" | "attachment", name: string): string {
  const fallback = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\;]/g, "_");
  const encoded = encodeURIComponent(name).replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${kind}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
