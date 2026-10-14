import type { SearchRequest } from "./service.js";

export function searchRequest(query: string, overrides: Partial<SearchRequest> = {}): SearchRequest {
  return {
    query,
    mode: "full",
    spaceIds: [],
    contentTypes: [],
    labels: [],
    authorIds: [],
    statuses: [],
    includeArchived: false,
    updatedAfter: null,
    updatedBefore: null,
    sort: "relevance",
    limit: 20,
    cursor: null,
    currentSpaceId: null,
    ...overrides,
  };
}
