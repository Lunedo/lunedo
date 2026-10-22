import type { Schemas } from "./client.js";

export type Problem = Schemas["Problem"];

const PROBLEM_PREFIX = "urn:lunedo:problem:";

export class ApiError extends Error {
  override name = "ApiError";

  constructor(
    readonly status: number,
    readonly problem: Problem,
  ) {
    super(problem.title);
  }

  get code(): string {
    return this.problem.code;
  }

  get fields(): string[] {
    return this.problem.fields ?? [];
  }
}

function isProblem(value: unknown): value is Problem {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Problem).type === "string" &&
    (value as Problem).type.startsWith(PROBLEM_PREFIX) &&
    typeof (value as Problem).code === "string"
  );
}

export function toApiError(response: Response, body: unknown): ApiError {
  if (isProblem(body)) return new ApiError(response.status, body);
  const code = response.status >= 500 ? "internalError" : response.status === 0 ? "networkError" : "unknown";
  return new ApiError(response.status, {
    type: `${PROBLEM_PREFIX}${code}`,
    title: response.statusText || code,
    status: response.status,
    code,
  });
}

export function networkError(): ApiError {
  return new ApiError(0, {
    type: `${PROBLEM_PREFIX}networkError`,
    title: "networkError",
    status: 0,
    code: "networkError",
  });
}

export function isApiError(error: unknown, code?: string): error is ApiError {
  return error instanceof ApiError && (code === undefined || error.code === code);
}

type ReauthenticationHandler = () => Promise<boolean>;
type SignedOutHandler = (code: string) => void;
type MovedHandler = (url: string) => void;
type MaintenanceHandler = () => void;

const handlers: {
  reauthenticate: ReauthenticationHandler | null;
  signedOut: SignedOutHandler | null;
  moved: MovedHandler | null;
  maintenance: MaintenanceHandler | null;
} = {
  reauthenticate: null,
  signedOut: null,
  moved: null,
  maintenance: null,
};

const MAINTENANCE_CODES = new Set(["maintenanceMode", "signInPaused"]);

export function setMaintenanceHandler(handler: MaintenanceHandler | null): void {
  handlers.maintenance = handler;
}

export function setMovedHandler(handler: MovedHandler | null): void {
  handlers.moved = handler;
}

export function setReauthenticationHandler(handler: ReauthenticationHandler | null): void {
  handlers.reauthenticate = handler;
}

export function setSignedOutHandler(handler: SignedOutHandler | null): void {
  handlers.signedOut = handler;
}

const SIGNED_OUT = new Set(["notSignedIn", "sessionEnded"]);

export interface RequestOptions {
  sessionHandling?: boolean;
}

interface Result<T> {
  data?: T;
  error?: unknown;
  response: Response;
}

export async function request<T>(call: () => Promise<Result<T>>, options: RequestOptions = {}): Promise<T> {
  const sessionHandling = options.sessionHandling ?? true;
  let result: Result<T>;
  try {
    result = await call();
  } catch {
    throw networkError();
  }
  if (result.response.ok) return result.data as T;
  const error = toApiError(result.response, result.error);
  if (sessionHandling && error.code === "reauthenticationRequired" && handlers.reauthenticate) {
    if (await handlers.reauthenticate()) return request(call, { sessionHandling: false });
  }
  if (sessionHandling && SIGNED_OUT.has(error.code)) handlers.signedOut?.(error.code);
  if (error.code === "instanceMoved" && error.problem.instanceUrl)
    handlers.moved?.(error.problem.instanceUrl);
  if (MAINTENANCE_CODES.has(error.code)) handlers.maintenance?.();
  throw error;
}
