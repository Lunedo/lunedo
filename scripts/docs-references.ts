import type { Reference } from "./docs-reference.ts";
import { environmentVariables } from "./reference-environment.ts";
import { settingsReference } from "./reference-settings.ts";

export const REFERENCES: readonly Reference<never>[] = [environmentVariables, settingsReference];
