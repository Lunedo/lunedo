export const BREAKING_API_LABEL = "breaking-api-change";

export interface GithubContext {
  readonly apiUrl: string;
  readonly repository: string;
  readonly token: string;
  readonly fetch: typeof fetch;
}

export function contextFromEnvironment(environment: NodeJS.ProcessEnv): GithubContext {
  const repository = environment.GITHUB_REPOSITORY;
  const token = environment.GITHUB_TOKEN;
  if (!repository || !token) {
    throw new Error(
      "GITHUB_REPOSITORY and GITHUB_TOKEN must be set. Run this script in a GitHub Actions job that passes the token.",
    );
  }
  return { apiUrl: environment.GITHUB_API_URL ?? "https://api.github.com", repository, token, fetch };
}

export async function githubRequest(context: GithubContext, method: string, route: string): Promise<unknown> {
  const response = await context.fetch(`${context.apiUrl}/repos/${context.repository}${route}`, {
    method,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${context.token}`,
      "x-github-api-version": "2022-11-28",
    },
  });
  if (!response.ok) {
    throw new Error(
      `GitHub answered ${method} ${route} with ${response.status}. Check the token permissions and run the job again.`,
    );
  }
  const text = await response.text();
  return text === "" ? null : JSON.parse(text);
}

export async function pullRequestLabels(context: GithubContext, pullRequest: number): Promise<string[]> {
  const labels = (await githubRequest(context, "GET", `/issues/${pullRequest}/labels?per_page=100`)) as {
    name: string;
  }[];
  return labels.map((label) => label.name);
}
