import { LocalFileStore, type StoreCapacity } from "../files/store.js";

const TERABYTE = 1024 ** 4;

export class EmptyDiskFileStore extends LocalFileStore {
  override async capacity(): Promise<StoreCapacity> {
    return { free: TERABYTE, total: TERABYTE };
  }
}
