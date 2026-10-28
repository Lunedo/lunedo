import type { Reference } from "./docs-reference.ts";
import { environmentVariables } from "./reference-environment.ts";

export const REFERENCES: readonly Reference<never>[] = [environmentVariables];
