import {
  AuditLog,
  createDatabase,
  createDatabasePool,
  createKeyProvider,
  createLogger,
  Encryption,
  KeyRingHolder,
  MaintenanceService,
  type MaintenanceStatus,
  type ServerConfig,
  SYSTEM,
} from "@lunedo/server";

export type MaintenanceCommand =
  | { action: "on"; message: string; blockSignIn: boolean }
  | { action: "off" }
  | { action: "status" };

function describe(status: MaintenanceStatus): string[] {
  if (!status.enabled) return ["Maintenance mode is off. Everyone can make changes."];
  return [
    `Maintenance mode is on since ${status.startedAt?.toISOString() ?? "unknown"}. The instance is read-only.`,
    status.blockSignIn
      ? "Signing in is paused for everyone except instance administrators."
      : "Everyone can still sign in and read.",
    ...(status.message ? [`Message: ${status.message}`] : []),
  ];
}

export async function maintenance(
  config: ServerConfig,
  command: MaintenanceCommand,
  write: (line: string) => void,
): Promise<void> {
  const pool = createDatabasePool({
    connectionString: config.database.url.reveal(),
    applicationName: "lunedo-cli",
  });
  try {
    const database = createDatabase(pool);
    const logger = createLogger({ service: "cli", level: "warn", destination: process.stderr });
    const keyRing = new KeyRingHolder(createKeyProvider(config), logger);
    await keyRing.reload();
    const service = new MaintenanceService({
      database,
      audit: new AuditLog({ database, encryption: new Encryption(() => keyRing.ring) }),
    });
    const status =
      command.action === "status"
        ? await service.status()
        : await service.set(
            SYSTEM,
            command.action === "on"
              ? { enabled: true, message: command.message, blockSignIn: command.blockSignIn }
              : { enabled: false },
          );
    for (const line of describe(status)) write(line);
  } finally {
    await pool.end();
  }
}
