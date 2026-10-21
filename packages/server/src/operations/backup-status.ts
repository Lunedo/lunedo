export interface BackupStatus {
  scheduled: boolean;
  targetConfigured: boolean;
  beforeUpdate: boolean;
  lastSuccessAt: Date | null;
  lastFailure: { at: Date; reason: string } | null;
  nextRunAt: Date | null;
  failuresTotal: number;
}

export interface BackupStatusSource {
  status(): Promise<BackupStatus | null>;
}

export const commandOnlyBackups: BackupStatusSource = {
  async status() {
    return null;
  },
};
