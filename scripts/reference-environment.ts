import { code, defineReference, table } from "./docs-reference.ts";

export interface JsonSchema {
  readonly type?: string;
  readonly enum?: readonly unknown[];
  readonly default?: unknown;
  readonly minimum?: number;
  readonly exclusiveMinimum?: number;
  readonly maximum?: number;
  readonly minLength?: number;
}

export interface EnvironmentVariable {
  readonly name: string;
  readonly topic: string;
  readonly description: string;
  readonly secret: boolean;
  readonly required: boolean;
  readonly format: string | null;
  readonly defaultText: string | null;
  readonly schema: JsonSchema;
}

const SOURCE = "packages/server/src/config/definitions.ts";

function list(values: readonly string[]): string {
  if (values.length <= 1) return values.join("");
  return `${values.slice(0, -1).join(", ")} or ${values.at(-1)}`;
}

export function allowedValues(variable: EnvironmentVariable): string {
  if (variable.format !== null) return variable.format;
  const { schema } = variable;
  if (schema.enum) return `${list(schema.enum.map((value) => code(String(value))))}.`;
  if (schema.type === "integer") {
    const minimum =
      schema.minimum ?? (schema.exclusiveMinimum === undefined ? null : schema.exclusiveMinimum + 1);
    const maximum =
      schema.maximum !== undefined && schema.maximum < Number.MAX_SAFE_INTEGER ? schema.maximum : null;
    if (minimum !== null && maximum !== null) return `A whole number from ${minimum} to ${maximum}.`;
    if (minimum !== null) return `A whole number of at least ${minimum}.`;
    return "A whole number.";
  }
  if (schema.minLength !== undefined && schema.minLength > 1)
    return `At least ${schema.minLength} characters.`;
  return "";
}

export function defaultValue(variable: EnvironmentVariable): string {
  if (variable.defaultText !== null) return variable.defaultText;
  if (variable.required) return "required";
  if (variable.schema.default === undefined) return "none";
  if (variable.schema.default === "") return "empty";
  return code(String(variable.schema.default));
}

function secret(variable: EnvironmentVariable): string {
  return variable.secret ? `yes, also as ${code(`${variable.name}_FILE`)}` : "";
}

export function renderEnvironmentVariables(variables: readonly EnvironmentVariable[]): string {
  const topics = [...new Set(variables.map((variable) => variable.topic))];
  const sections = topics.map((topic) => {
    const rows = variables
      .filter((variable) => variable.topic === topic)
      .map((variable) => [
        code(variable.name),
        defaultValue(variable),
        allowedValues(variable),
        secret(variable),
        variable.description,
      ]);
    return `## ${topic}\n\n${table(["Variable", "Default", "Allowed values", "Secret", "Description"], rows)}`;
  });
  return [
    "Every environment variable Lunedo reads, grouped by task. The [configuration file](configuration.md#configuration-file) takes the same names as keys. A secret can be given directly or, with `_FILE` appended to its name, as the path of a file that holds it; see [Secrets](configuration.md#secrets).",
    ...sections,
  ].join("\n\n");
}

export const environmentVariables = defineReference<EnvironmentVariable[]>({
  page: "admin/environment-variables.md",
  title: "Environment variables",
  sources: [SOURCE],
  entry: `
import { z } from "zod";
import { configSettings } from "./${SOURCE}";

export default configSettings.map((setting) => ({
  name: setting.name,
  topic: setting.topic,
  description: setting.description,
  secret: setting.secret,
  required: !setting.schema.safeParse(undefined).success,
  format: setting.format ?? null,
  defaultText: setting.defaultText ?? null,
  schema: z.toJSONSchema(setting.schema, { io: "input", unrepresentable: "any" }),
}));
`,
  render: renderEnvironmentVariables,
});
