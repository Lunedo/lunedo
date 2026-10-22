const former = ["page", "hall"].join("");
const formerName = new RegExp(former, "gi");

export interface NameAllowance {
  readonly files?: RegExp;
  readonly tokens?: readonly string[];
  readonly reason: string;
}

export const nameAllowances: readonly NameAllowance[] = [
  {
    files:
      /^packages\/server\/drizzle\/(?:(?:00[0-8]\d|009[0-7])_[a-z0-9_]+\.sql|meta\/(?:00[0-8]\d|009[0-7])_snapshot\.json)$/,
    reason: "Migrations that are already applied are never edited, so they keep the names they created.",
  },
  {
    tokens: [`mapping_rules_${former}_group_id_groups_id_fk`, `${former}_group_id`],
    reason: "Column and foreign key of the mapping rules, created by an applied migration.",
  },
  {
    tokens: [`${former}.audit_retention`, `${former}.tree_settled_later`],
    reason: "Transaction settings that database triggers read.",
  },
  {
    tokens: [`${former}.tree`, `${former}.search.terms`, `${former}.knowledge-base.paths`],
    reason: "Advisory lock keys that database triggers take as well.",
  },
  {
    tokens: [`${former}_search_changes`, `${former}_review_changes`, `${former}_portal_domains`],
    reason: "Notification channels that database triggers raise.",
  },
  {
    files: /^packages\/server\/src\/imports\/testing\/confluence-cloud\/(?:fixture-guard|prepare)\.test\.ts$/,
    tokens: [`${former}-test`],
    reason: "Real name of the external Confluence test site, which the fixtures must not contain.",
  },
  {
    files: /^packages\/server\/src\/imports\/testing\/confluence-cloud\/prepare(?:\.test)?\.ts$/,
    tokens: [former, former.toUpperCase(), `${former[0]?.toUpperCase()}${former.slice(1)}`],
    reason: "The fixture script replaces the former product name in recorded test site content.",
  },
];

export interface NameFinding {
  readonly line: number;
  readonly text: string;
}

function allowedRanges(line: string, tokens: readonly string[]): [number, number][] {
  const ranges: [number, number][] = [];
  for (const token of tokens) {
    for (let index = line.indexOf(token); index >= 0; index = line.indexOf(token, index + 1)) {
      ranges.push([index, index + token.length]);
    }
  }
  return ranges;
}

export function findFormerName(
  content: string,
  file: string,
  allowances: readonly NameAllowance[] = nameAllowances,
): NameFinding[] {
  const name = file.replaceAll("\\", "/");
  const applying = allowances.filter((allowance) => !allowance.files || allowance.files.test(name));
  if (applying.some((allowance) => allowance.files && !allowance.tokens)) return [];
  const tokens = applying.flatMap((allowance) => allowance.tokens ?? []);
  const findings: NameFinding[] = [];
  for (const [index, line] of [name, ...content.split("\n")].entries()) {
    const ranges = allowedRanges(line, tokens);
    for (const match of line.matchAll(formerName)) {
      const start = match.index;
      const end = start + match[0].length;
      if (!ranges.some(([from, to]) => from <= start && end <= to)) {
        findings.push({ line: index, text: line.trim().slice(0, 160) });
        break;
      }
    }
  }
  return findings;
}

const repositoryExpression = /github\.repository(?:_owner)?\b|\$\{?GITHUB_REPOSITORY(?:_OWNER)?\b/;
const imageContext = /ghcr\.io|image|tags:/i;
const registryReference = /ghcr\.io\/[^\s"'`)<>,]+/g;

export function imageNameProblems(content: string, file: string): string[] {
  const name = file.replaceAll("\\", "/");
  const problems: string[] = [];
  for (const [index, line] of content.split("\n").entries()) {
    const literal = line.replace(/\$\{\{[^}]*\}\}|\$\{[^}]*\}|<[^>]*>/g, "");
    for (const match of literal.matchAll(registryReference)) {
      if (match[0] !== match[0].toLowerCase()) {
        problems.push(`${name}:${index + 1}: image name ${match[0]} must be lowercase`);
      }
    }
    if (
      name.startsWith(".github/") &&
      imageContext.test(line) &&
      repositoryExpression.test(line) &&
      !/GITHUB_REPOSITORY(?:_OWNER)?,,/.test(line)
    ) {
      problems.push(
        `${name}:${index + 1}: image names must not come from the repository name, whose owner and name may contain capitals`,
      );
    }
  }
  return problems;
}
