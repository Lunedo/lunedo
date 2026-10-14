import { deflateSync } from "node:zlib";
import yazl from "yazl";

function escapeXml(text: string): string {
  return text.replace(/[<>&"]/g, (character) => `&#${character.charCodeAt(0)};`);
}

function escapePdf(text: string): string {
  return text.replace(/[\\()]/g, (character) => `\\${character}`);
}

export function pdfFile(pages: string[][], options: { encrypted?: boolean } = {}): Buffer {
  const objects: string[] = [];
  const add = (body: string) => {
    objects.push(body);
    return objects.length;
  };
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const pagesId = objects.length + 1 + pages.length * 2;
  const pageIds: number[] = [];
  for (const lines of pages) {
    const stream = [
      "BT /F1 11 Tf 14 TL 50 780 Td",
      ...lines.map((line) => `(${escapePdf(line)}) Tj T*`),
      "ET",
    ].join("\n");
    const content = add(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`);
    pageIds.push(
      add(
        `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Contents ${content} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`,
      ),
    );
  }
  add(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`);
  const catalog = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  const encryption = options.encrypted
    ? add(`<< /Filter /Standard /V 1 /R 2 /O <${"ab".repeat(32)}> /U <${"cd".repeat(32)}> /P -4 >>`)
    : null;
  let output = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(output, "latin1"));
    output += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(output, "latin1");
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  output += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  const encrypt = encryption
    ? ` /Encrypt ${encryption} 0 R /ID [<00112233445566778899aabbccddeeff> <00112233445566778899aabbccddeeff>]`
    : "";
  output += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R${encrypt} >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(output, "latin1");
}

export function inflatingPdfFile(expandedBytes: number): Buffer {
  const text = Buffer.from("BT /F1 11 Tf 50 780 Td (Inflated) Tj ET\n");
  const content = deflateSync(Buffer.concat([text, Buffer.alloc(expandedBytes, 0x20)]));
  const objects = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
    Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    Buffer.from(
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    ),
    Buffer.concat([
      Buffer.from(`<< /Length ${content.length} /Filter /FlateDecode >>\nstream\n`),
      content,
      Buffer.from("\nendstream"),
    ]),
    Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"),
  ];
  const header = Buffer.from("%PDF-1.4\n", "latin1");
  const parts: Buffer[] = [header];
  const offsets: number[] = [];
  let length = header.length;
  objects.forEach((body, index) => {
    const object = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`), body, Buffer.from("\nendobj\n")]);
    offsets.push(length);
    parts.push(object);
    length += object.length;
  });
  const xref = [
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`,
    ...offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`),
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`,
  ].join("");
  return Buffer.concat([...parts, Buffer.from(xref, "latin1")]);
}

export async function zipFile(entries: Record<string, string | Buffer>): Promise<Buffer> {
  const zip = new yazl.ZipFile();
  for (const [name, content] of Object.entries(entries)) {
    zip.addBuffer(typeof content === "string" ? Buffer.from(content, "utf8") : content, name, {
      mtime: new Date(Date.UTC(2026, 0, 1)),
    });
  }
  zip.end();
  const parts: Buffer[] = [];
  for await (const chunk of zip.outputStream) parts.push(chunk as Buffer);
  return Buffer.concat(parts);
}

export function markEncrypted(zip: Buffer): Buffer {
  const copy = Buffer.from(zip);
  for (let offset = 0; offset < copy.length - 4; offset++) {
    const signature = copy.readUInt32LE(offset);
    if (signature === 0x04034b50) copy.writeUInt16LE(copy.readUInt16LE(offset + 6) | 1, offset + 6);
    if (signature === 0x02014b50) copy.writeUInt16LE(copy.readUInt16LE(offset + 8) | 1, offset + 8);
  }
  return copy;
}

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

export function docxFile(
  paragraphs: string[],
  options: { footnotes?: string[]; extra?: Record<string, string | Buffer> } = {},
): Promise<Buffer> {
  const body = paragraphs
    .map((text) => {
      const [first, ...rest] = text.split("\t");
      const runs = [first ?? "", ...rest]
        .map(
          (part, index) =>
            `${index > 0 ? "<w:r><w:tab/></w:r>" : ""}<w:r><w:t xml:space="preserve">${escapeXml(part)}</w:t></w:r>`,
        )
        .join("");
      return `<w:p>${runs}</w:p>`;
    })
    .join("");
  const entries: Record<string, string | Buffer> = {
    "[Content_Types].xml":
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    "word/document.xml": `<?xml version="1.0" encoding="UTF-8"?><w:document ${W}><w:body>${body}</w:body></w:document>`,
    ...options.extra,
  };
  if (options.footnotes) {
    entries["word/footnotes.xml"] = `<?xml version="1.0"?><w:footnotes ${W}>${options.footnotes
      .map((text) => `<w:footnote><w:p><w:r><w:t>${escapeXml(text)}</w:t></w:r></w:p></w:footnote>`)
      .join("")}</w:footnotes>`;
  }
  return zipFile(entries);
}

const S = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
const R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

export function xlsxFile(sheets: { name: string; rows: (string | number)[][] }[]): Promise<Buffer> {
  const shared: string[] = [];
  const index = new Map<string, number>();
  const entries: Record<string, string> = {
    "[Content_Types].xml":
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    "xl/workbook.xml": `<?xml version="1.0"?><workbook ${S} ${R}><sheets>${sheets
      .map(
        (sheet, number) =>
          `<sheet name="${escapeXml(sheet.name)}" sheetId="${number + 1}" r:id="rId${number + 1}"/>`,
      )
      .join("")}</sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
      .map(
        (_sheet, number) =>
          `<Relationship Id="rId${number + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${number + 1}.xml"/>`,
      )
      .join("")}</Relationships>`,
  };
  sheets.forEach((sheet, number) => {
    const rows = sheet.rows
      .map((row, rowIndex) => {
        const cells = row
          .map((value, column) => {
            const reference = `${String.fromCharCode(65 + (column % 26))}${rowIndex + 1}`;
            if (typeof value === "number") return `<c r="${reference}"><v>${value}</v></c>`;
            let position = index.get(value);
            if (position === undefined) {
              position = shared.length;
              shared.push(value);
              index.set(value, position);
            }
            return `<c r="${reference}" t="s"><v>${position}</v></c>`;
          })
          .join("");
        return `<row r="${rowIndex + 1}">${cells}</row>`;
      })
      .join("");
    entries[`xl/worksheets/sheet${number + 1}.xml`] =
      `<?xml version="1.0"?><worksheet ${S}><sheetData>${rows}</sheetData></worksheet>`;
  });
  entries["xl/sharedStrings.xml"] =
    `<?xml version="1.0"?><sst ${S} count="${shared.length}" uniqueCount="${shared.length}">${shared
      .map((text) => `<si><t>${escapeXml(text)}</t></si>`)
      .join("")}</sst>`;
  return zipFile(entries);
}

export const COMPOUND_FILE_HEADER = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
