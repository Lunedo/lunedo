import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import {
  blockReference,
  fileReference,
  serializeManifest,
  templateFormatJsonSchema,
  templateManifestSchema,
} from "./format.js";

const schemaFile = new URL("../../../../docs/template-format.schema.json", import.meta.url);

const hash = "a".repeat(64);

const valid = {
  format: "pagehall-template",
  formatVersion: 1,
  schemaVersion: 11,
  pagehallVersion: "1.0.0",
  templates: [
    {
      name: "Retro",
      description: "",
      category: "meetings",
      language: "en",
      titlePattern: "Retro {date}",
      fields: [{ key: "date", label: "Date", type: "date", required: false }],
      series: null,
      files: [{ path: `files/${hash}.png`, mediaType: "image/png", size: 10, sha256: hash, name: "a.png" }],
      document: { type: "doc", content: [{ type: "paragraph" }] },
    },
  ],
};

function changed(change: (copy: typeof valid & Record<string, unknown>) => void) {
  const copy = structuredClone(valid) as typeof valid & Record<string, unknown>;
  change(copy);
  return copy;
}

const examples: { name: string; value: unknown; accepted: boolean }[] = [
  { name: "a complete file", value: valid, accepted: true },
  {
    name: "a series template without language",
    value: changed((copy) => {
      Object.assign(copy.templates[0] as object, {
        language: null,
        series: { rhythm: { frequency: "weekly", interval: 1, weekdays: ["MO"] }, durationMinutes: 30 },
      });
    }),
    accepted: true,
  },
  {
    name: "an unknown key at the top",
    value: changed((copy) => Object.assign(copy, { owner: "x" })),
    accepted: false,
  },
  {
    name: "an unknown key in a template",
    value: changed((copy) => Object.assign(copy.templates[0] as object, { author: "x" })),
    accepted: false,
  },
  {
    name: "an unknown key in a file",
    value: changed((copy) => Object.assign(copy.templates[0]?.files[0] as object, { id: "x" })),
    accepted: false,
  },
  {
    name: "another format",
    value: changed((copy) => Object.assign(copy, { format: "other" })),
    accepted: false,
  },
  {
    name: "format version 2",
    value: changed((copy) => Object.assign(copy, { formatVersion: 2 })),
    accepted: false,
  },
  { name: "no templates", value: changed((copy) => Object.assign(copy, { templates: [] })), accepted: false },
  {
    name: "51 templates",
    value: changed((copy) =>
      Object.assign(copy, { templates: Array.from({ length: 51 }, () => valid.templates[0]) }),
    ),
    accepted: false,
  },
  {
    name: "an unknown category",
    value: changed((copy) => Object.assign(copy.templates[0] as object, { category: "secret" })),
    accepted: false,
  },
  {
    name: "an unknown language",
    value: changed((copy) => Object.assign(copy.templates[0] as object, { language: "fr" })),
    accepted: false,
  },
  {
    name: "a field key with a space",
    value: changed((copy) => Object.assign(copy.templates[0]?.fields[0] as object, { key: "my key" })),
    accepted: false,
  },
  {
    name: "a file path outside files/",
    value: changed((copy) =>
      Object.assign(copy.templates[0]?.files[0] as object, { path: `../${hash}.png` }),
    ),
    accepted: false,
  },
  {
    name: "a file name with a path",
    value: changed((copy) =>
      Object.assign(copy.templates[0]?.files[0] as object, { name: "../../etc/passwd" }),
    ),
    accepted: false,
  },
  {
    name: "an executable media type",
    value: changed((copy) =>
      Object.assign(copy.templates[0]?.files[0] as object, { mediaType: "text/html" }),
    ),
    accepted: false,
  },
  {
    name: "a file above 5 MB",
    value: changed((copy) =>
      Object.assign(copy.templates[0]?.files[0] as object, { size: 5 * 1024 * 1024 + 1 }),
    ),
    accepted: false,
  },
  {
    name: "a document that is not a doc",
    value: changed((copy) => Object.assign(copy.templates[0] as object, { document: { type: "paragraph" } })),
    accepted: false,
  },
  {
    name: "a name above 100 characters",
    value: changed((copy) => Object.assign(copy.templates[0] as object, { name: "x".repeat(101) })),
    accepted: false,
  },
];

describe("template file format", () => {
  it("publishes the JSON Schema the importer uses", () => {
    expect(readFileSync(schemaFile, "utf8")).toBe(`${JSON.stringify(templateFormatJsonSchema(), null, 2)}\n`);
  });

  const validate = new Ajv2020({ strict: false, allErrors: true }).compile(templateFormatJsonSchema());

  for (const example of examples) {
    it(`${example.accepted ? "accepts" : "rejects"} ${example.name} in the JSON Schema and the importer alike`, () => {
      expect(validate(example.value)).toBe(example.accepted);
      expect(templateManifestSchema.safeParse(example.value).success).toBe(example.accepted);
    });
  }

  it("writes keys in a fixed order with two spaces of indentation", () => {
    const text = serializeManifest({
      templates: [
        {
          document: { type: "doc", content: [{ type: "paragraph" }] },
          files: [],
          series: null,
          fields: [],
          titlePattern: "T",
          language: null,
          category: "teams",
          description: "",
          name: "N",
        },
      ],
      pagehallVersion: "1",
      schemaVersion: 11,
      formatVersion: 1,
      format: "pagehall-template",
    });
    expect(text.split("\n").slice(0, 5)).toEqual([
      "{",
      '  "format": "pagehall-template",',
      '  "formatVersion": 1,',
      '  "schemaVersion": 11,',
      '  "pagehallVersion": "1",',
    ]);
    expect(text.indexOf('"name"')).toBeLessThan(text.indexOf('"document"'));
    expect(text.endsWith("}\n")).toBe(true);
  });

  it("derives stable references that are valid UUIDs and never database IDs", () => {
    expect(fileReference(hash)).toBe(fileReference(hash));
    expect(fileReference(hash)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(blockReference(1)).not.toBe(blockReference(2));
    expect(blockReference(1)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8/);
  });
});
