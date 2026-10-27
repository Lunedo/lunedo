import { z } from "zod";
import { defineSetting } from "../settings/definition.js";
import { emergencyRecipientsSetting } from "./emergency-recipients.js";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH_FLOOR } from "./passwords.js";

const minutes = (min: number, max: number) => z.number().int().min(min).max(max);
const DAY = 24 * 60;

export const passwordMinLengthSetting = defineSetting({
  key: "auth.passwordMinLength",
  schema: z.number().int().min(PASSWORD_MIN_LENGTH_FLOOR).max(PASSWORD_MAX_LENGTH),
  default: 12,
  levels: ["instance", "organization"],
  lockable: true,
  stricterOnly: "higher",
});

export const twoFactorRequiredSetting = defineSetting({
  key: "auth.twoFactorRequired",
  schema: z.boolean(),
  default: false,
  levels: ["instance", "organization"],
  lockable: true,
  stricterOnly: "higher",
});

export const maxSessionsSetting = defineSetting({
  key: "auth.maxSessionsPerAccount",
  schema: z.number().int().min(1).max(100),
  default: 10,
  levels: ["instance", "organization"],
  lockable: true,
  stricterOnly: "lower",
});

export const sessionIdleTimeoutSetting = defineSetting({
  key: "auth.sessionIdleTimeoutMinutes",
  schema: minutes(5, 365 * DAY),
  default: 7 * DAY,
  levels: ["instance", "organization"],
  lockable: true,
  stricterOnly: "lower",
});

export const sessionLifetimeSetting = defineSetting({
  key: "auth.sessionLifetimeMinutes",
  schema: minutes(5, 365 * DAY),
  default: 30 * DAY,
  levels: ["instance", "organization"],
  lockable: true,
  stricterOnly: "lower",
});

export const reauthenticationSetting = defineSetting({
  key: "auth.reauthenticationMinutes",
  schema: minutes(1, 60),
  default: 10,
  levels: ["instance", "organization"],
  lockable: true,
  stricterOnly: "lower",
});

export const accountAttemptLimitSetting = defineSetting({
  key: "auth.signInAttemptsPerAccountPerMinute",
  schema: z.number().int().min(1).max(1000),
  default: 10,
  levels: ["instance"],
  lockable: false,
});

export const clientAttemptLimitSetting = defineSetting({
  key: "auth.signInAttemptsPerClientPerMinute",
  schema: z.number().int().min(1).max(10_000),
  default: 30,
  levels: ["instance"],
  lockable: false,
});

export const accountLockoutFailuresSetting = defineSetting({
  key: "auth.lockoutFailuresPerAccount",
  schema: z.number().int().min(3).max(1000),
  default: 5,
  levels: ["instance"],
  lockable: false,
});

export const clientLockoutFailuresSetting = defineSetting({
  key: "auth.lockoutFailuresPerClient",
  schema: z.number().int().min(3).max(10_000),
  default: 20,
  levels: ["instance"],
  lockable: false,
});

export const lockoutWindowSetting = defineSetting({
  key: "auth.lockoutWindowMinutes",
  schema: minutes(1, DAY),
  default: 15,
  levels: ["instance"],
  lockable: false,
});

export const lockoutDurationSetting = defineSetting({
  key: "auth.lockoutMinutes",
  schema: minutes(1, DAY),
  default: 1,
  levels: ["instance"],
  lockable: false,
});

export const lockoutMaxDurationSetting = defineSetting({
  key: "auth.lockoutMaxMinutes",
  schema: minutes(1, 7 * DAY),
  default: 60,
  levels: ["instance"],
  lockable: false,
});

export const authSettings = [
  passwordMinLengthSetting,
  emergencyRecipientsSetting,
  twoFactorRequiredSetting,
  maxSessionsSetting,
  sessionIdleTimeoutSetting,
  sessionLifetimeSetting,
  reauthenticationSetting,
  accountAttemptLimitSetting,
  clientAttemptLimitSetting,
  accountLockoutFailuresSetting,
  clientLockoutFailuresSetting,
  lockoutWindowSetting,
  lockoutDurationSetting,
  lockoutMaxDurationSetting,
];
