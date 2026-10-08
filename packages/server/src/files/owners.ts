import type { ServerConfig } from "../config/load.js";
import type { EncryptedStreamOwner } from "../crypto/encrypted-stream.js";
import { fileStreamOwner } from "./files.js";
import { createFileStore, type FileStore } from "./store.js";

export function fileStoreOf(config: Pick<ServerConfig, "fileStorage" | "paths">): FileStore {
  return createFileStore(config.fileStorage, config.paths.files);
}

export function encryptedStreamOwnersOf(store: FileStore): EncryptedStreamOwner[] {
  return [fileStreamOwner(store)];
}
