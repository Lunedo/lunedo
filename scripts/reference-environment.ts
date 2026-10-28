import { code, defineReference, table } from "./docs-reference.ts";
import { allowedValues, type JsonSchema } from "./docs-schema.ts";

export type { JsonSchema };

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

export function variableValues(variable: EnvironmentVariable): string {
  return variable.format ?? allowedValues(variable.schema);
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
        variableValues(variable),
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
