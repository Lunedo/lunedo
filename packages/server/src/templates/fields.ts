import { TEMPLATE_FIELD_KEY } from "@pagehall/editor-schema";
import { z } from "zod";

export const templateFieldTypes = ["text", "date", "person", "choice"] as const;
export type TemplateFieldType = (typeof templateFieldTypes)[number];

export const MAX_TEMPLATE_FIELDS = 20;
export const MAX_CHOICE_OPTIONS = 30;

export const templateFieldSchema = z
  .object({
    key: z.string().regex(TEMPLATE_FIELD_KEY),
    label: z.string().trim().min(1).max(100),
    type: z.enum(templateFieldTypes),
    required: z.boolean(),
    options: z.array(z.string().trim().min(1).max(100)).max(MAX_CHOICE_OPTIONS).optional(),
  })
  .strict()
  .refine(
    (field) => (field.type === "choice") === (field.options !== undefined && field.options.length > 0),
    {
      message: "Choice fields need options, other fields none",
    },
  );
export type TemplateField = z.infer<typeof templateFieldSchema>;

export const templateFieldsSchema = z
  .array(templateFieldSchema)
  .max(MAX_TEMPLATE_FIELDS)
  .refine((fields) => new Set(fields.map((field) => field.key)).size === fields.length, {
    message: "Field keys must be unique",
  });
