import type { Reference } from "./docs-reference.ts";
import { auditEvents } from "./reference-audit.ts";
import { cliReference } from "./reference-cli.ts";
import { environmentVariables } from "./reference-environment.ts";
import { requirementsReference } from "./reference-requirements.ts";
import { settingsReference } from "./reference-settings.ts";

export const REFERENCES: readonly Reference<never>[] = [
  environmentVariables,
  settingsReference,
  auditEvents,
  cliReference,
  requirementsReference,
];
