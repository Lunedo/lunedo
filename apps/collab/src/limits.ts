import { MAX_DOCUMENT_BYTES } from "@pagehall/editor-schema";

export const COLLAB_PATH = "/collab";
export const DOCUMENT_PREFIX = "page:";

export const MAX_UPDATE_BYTES = MAX_DOCUMENT_BYTES;
export const MAX_AWARENESS_BYTES = 64 * 1024;
export const MAX_FRAME_BYTES = 4 * MAX_UPDATE_BYTES;

export const MESSAGE_BURST = 400;
export const MESSAGES_PER_SECOND = 100;

export const CONNECTIONS_PER_ACCOUNT_PER_MINUTE = 60;
export const CONNECTIONS_PER_ADDRESS_PER_MINUTE = 300;

export const STORE_DEBOUNCE_MS = 800;
export const STORE_MAX_DEBOUNCE_MS = 10_000;
export const STORE_RETRY_MS = 5_000;
export const RECHECK_INTERVAL_MS = 30_000;

export const CLIENT_ADDRESS_HEADER = "x-pagehall-client-address";

export const closeReasons = {
  updateRejected: { code: 4400, reason: "updateRejected" },
  sessionEnded: { code: 4401, reason: "sessionEnded" },
  permissionRevoked: { code: 4403, reason: "permissionRevoked" },
  tooManyMessages: { code: 4429, reason: "tooManyMessages" },
  unavailable: { code: 4503, reason: "unavailable" },
} as const;

export const refusalReasons = [
  "originNotAllowed",
  "tokenNotAllowed",
  "notSignedIn",
  "pageNotFound",
  "noEditPermission",
  "tooManyConnections",
] as const;
export type RefusalReason = (typeof refusalReasons)[number];
