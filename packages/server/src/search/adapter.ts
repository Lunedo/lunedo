import type { ContentLanguage } from "@pagehall/shared";
import type { Executor } from "../database/database.js";
import type { SearchViewer } from "./access.js";
import type { ParsedQuery } from "./query.js";
import type { SearchSource } from "./schema.js";

export const searchContentTypes = ["page", "blogPost", "comment", "attachment", "topic", "decision"] as const;
export type SearchContentType = (typeof searchContentTypes)[number];

export const searchSorts = ["relevance", "newest"] as const;
export type SearchSort = (typeof searchSorts)[number];

export const searchUpdatedRanges = ["week", "month", "year"] as const;
export type SearchUpdatedRange = (typeof searchUpdatedRanges)[number];

export const UPDATED_RANGE_DAYS: Record<SearchUpdatedRange, number> = { week: 7, month: 30, year: 365 };

export interface AttachmentMetadata {
  name: string;
  contentType: string;
  size: number;
}

export interface ContextAccess {
  itemId: string;
  readers: string[];
  restrictions: string[];
}

export interface IndexedChunk {
  source: SearchSource;
  sourceId: string;
  position: number;
  contentType: SearchContentType;
  title: string;
  heading: string;
  anchor: string | null;
  body: string;
  authorId: string | null;
  contentCreatedAt: Date;
  contentUpdatedAt: Date;
  context: ContextAccess | null;
  attachment: AttachmentMetadata | null;
}

export interface ItemAccess {
  itemId: string;
  spaceId: string;
  readers: string[];
  restrictions: string[];
  archived: boolean;
}

export interface IndexedItem extends ItemAccess {
  organizationId: string | null;
  labels: string[];
  status: string | null;
  language: ContentLanguage;
  config: string;
  chunks: IndexedChunk[];
}

export interface SearchFilters {
  spaceIds: string[] | null;
  contentTypes: SearchContentType[];
  labels: string[];
  authorIds: string[] | null;
  statusIds: string[];
  languages: string[];
  includeArchived: boolean;
  updatedAfter: Date | null;
  updatedBefore: Date | null;
}

export interface AdapterSearch {
  viewer: SearchViewer;
  query: ParsedQuery;
  prefixLastTerm: boolean;
  filters: SearchFilters;
  visibleSpaceIds: string[];
  sort: SearchSort;
  limit: number;
  after: { score: number; updatedAt: string; sourceId: string } | null;
  firstSpaceId: string | null;
  facets: boolean;
  suggest: boolean;
}

export interface AdapterHit {
  source: SearchSource;
  sourceId: string;
  itemId: string;
  spaceId: string;
  contentType: SearchContentType;
  title: string;
  heading: string;
  anchor: string | null;
  excerpt: string;
  labels: string[];
  status: string | null;
  authorId: string | null;
  archived: boolean;
  attachment: AttachmentMetadata | null;
  score: number;
  contentUpdatedAt: string;
}

export interface FacetCount<T> {
  value: T;
  count: number;
}

export interface AdapterFacets {
  contentTypes: FacetCount<SearchContentType>[];
  spaces: FacetCount<string | null>[];
  labels: FacetCount<string>[];
  authors: FacetCount<string>[];
  statuses: FacetCount<string>[];
  languages: FacetCount<string>[];
  updated: FacetCount<SearchUpdatedRange>[];
}

export interface AdapterResult {
  hits: AdapterHit[];
  total: number;
  hasMore: boolean;
  facets: AdapterFacets | null;
  corrections: Map<string, string>;
}

export const EXCERPT_START = "\u0001";
export const EXCERPT_END = "\u0002";

export interface SearchAdapter {
  replaceItem(executor: Executor, item: IndexedItem): Promise<void>;
  removeItem(executor: Executor, itemId: string): Promise<void>;
  updateAccess(executor: Executor, updates: ItemAccess[]): Promise<void>;
  updateContextAccess(executor: Executor, contexts: ContextAccess[]): Promise<void>;
  indexedItemsOfSpace(executor: Executor, spaceId: string): Promise<string[]>;
  search(executor: Executor, request: AdapterSearch): Promise<AdapterResult>;
}
