import { QueryClient } from "@tanstack/react-query";
import { ApiError } from "./request.js";

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: (failures, error) => {
          if (error instanceof ApiError && error.status > 0 && error.status < 500) return false;
          return failures < 2;
        },
        throwOnError: (error, query) =>
          query.state.data === undefined && !(error instanceof ApiError && error.status === 401),
      },
      mutations: { retry: false },
    },
  });
}
