import { createHash } from "node:crypto";
import type { ScanContext } from "../source.js";

export const MAX_LISTING_PAGES = 20_000;

export type ListingStop = "repeated" | "limit";
export type ListingStopped = (listing: string, reason: ListingStop) => Promise<void>;

export class ListingGuard {
  readonly #seen = new Set<string>();
  readonly #listing: string;
  readonly #stopped: ListingStopped | undefined;

  constructor(first: string, stopped?: ListingStopped) {
    this.#listing = first.split("?")[0] ?? first;
    this.#stopped = stopped;
    this.#seen.add(digest(first));
  }

  async follow(next: string | null): Promise<string | null> {
    if (next === null) return null;
    const key = digest(next);
    const reason: ListingStop | null = this.#seen.has(key)
      ? "repeated"
      : this.#seen.size >= MAX_LISTING_PAGES
        ? "limit"
        : null;
    if (reason) {
      await this.#stopped?.(this.#listing, reason);
      return null;
    }
    this.#seen.add(key);
    return next;
  }
}

export function reportStoppedListing(context: ScanContext): ListingStopped {
  return (listing, reason) =>
    context.problem("listingIncomplete", {
      listing: listing.slice(0, 500),
      reason,
      limit: MAX_LISTING_PAGES,
    });
}

function digest(path: string): string {
  return createHash("sha256").update(path).digest("base64url");
}
