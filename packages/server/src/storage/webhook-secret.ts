export const STORAGE_TEAMS_SECRET = "storage.operationsTeamsWebhook";

export function storageTeamsSecretContext(): string {
  return `instance_secrets.value:${STORAGE_TEAMS_SECRET}`;
}
