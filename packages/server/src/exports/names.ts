export const MAX_NAME_LENGTH = 64;

const FORBIDDEN = /[<>:"/\\|?*\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;
const RESERVED = /^(con|prn|aux|nul|conin\$|conout\$|com[0-9¹²³]|lpt[0-9¹²³])$/i;

function truncate(text: string, length: number): string {
  const characters = [...text];
  return characters.length <= length ? text : characters.slice(0, length).join("");
}

function trimEdges(text: string): string {
  return text.replace(/^[\s.]+|[\s.]+$/gu, "");
}

function clean(text: string, length: number): string {
  const name = trimEdges(
    truncate(trimEdges(text.normalize("NFC").replace(/\s+/gu, " ").replace(FORBIDDEN, "-")), length),
  );
  return RESERVED.test(name.split(".")[0] ?? "") ? `${name}_` : name;
}

export function safeName(title: string, fallback: string, length = MAX_NAME_LENGTH): string {
  return clean(title, length) || clean(fallback, length) || "export";
}

export function splitExtension(fileName: string): { base: string; extension: string } {
  const dot = fileName.lastIndexOf(".");
  if (dot <= 0 || dot === fileName.length - 1) return { base: fileName, extension: "" };
  const extension = fileName.slice(dot);
  return /^\.[\p{L}\p{N}]{1,10}$/u.test(extension)
    ? { base: fileName.slice(0, dot), extension }
    : { base: fileName, extension: "" };
}

export class NameScope {
  readonly #used = new Set<string>();

  #key(name: string): string {
    return name.normalize("NFC").toLowerCase();
  }

  reserve(name: string): void {
    this.#used.add(this.#key(name));
  }

  #free(name: string): boolean {
    return !this.#used.has(this.#key(name));
  }

  take(
    base: string,
    extensions: readonly string[] = [""],
    length = MAX_NAME_LENGTH,
    fallback = "export",
  ): string {
    for (let attempt = 1; ; attempt += 1) {
      const suffix = attempt === 1 ? "" : ` (${attempt})`;
      const stem = `${safeName(base, fallback, length - suffix.length)}${suffix}`;
      if (extensions.every((extension) => this.#free(`${stem}${extension}`))) {
        for (const extension of extensions) this.reserve(`${stem}${extension}`);
        return stem;
      }
    }
  }

  file(fileName: string, fallback: string, length = MAX_NAME_LENGTH): string {
    const { base, extension } = splitExtension(fileName.trim());
    return `${this.take(base, [extension], length - extension.length, fallback)}${extension}`;
  }
}
