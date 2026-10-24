/**
 * HTTP client for runs-service
 * Vendored from @mcpfactory/runs-client
 */

const RUNS_SERVICE_URL =
  process.env.RUNS_SERVICE_URL || "http://localhost:3006";
const RUNS_SERVICE_API_KEY = process.env.RUNS_SERVICE_API_KEY || "";

// --- Types ---

export interface Run {
  id: string;
  parentRunId: string | null;
  organizationId: string;
  userId: string | null;
  appId: string;
  brandId: string | null;
  campaignId: string | null;
  serviceName: string;
  taskName: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RunCost {
  id: string;
  runId: string;
  costName: string;
  quantity: string;
  unitCostInUsdCents: string;
  totalCostInUsdCents: string;
  createdAt: string;
}

export interface CreateRunParams {
  orgId: string;
  serviceName: string;
  taskName: string;
  parentRunId?: string;
  userId?: string;
  brandId?: string;
  campaignId?: string;
  /**
   * The run serves a SUPPORT function (spend that produces no outcome by
   * design): runs-service marks it at creation, its cost and its non-declaring
   * subtree's never ride an outcome (agent-config skill `cost-accounting`).
   */
  support?: RunSupport;
}

/** runs-service support functions this service uses (closed list owned by runs-service). */
export type SupportFunction = "copilot" | "staff_experiment";

export interface RunSupport {
  kind: SupportFunction;
  reason: string;
}

export interface CostItem {
  costName: string;
  costSource: "platform" | "org";
  quantity: number;
}

// The deployed runs-service resolves identity from HEADERS (x-org-id required,
// x-user-id optional) on EVERY run-scoped call — status update + cost add too,
// not just create — even though the OpenAPI doc omits it on those routes.
export interface RunIdentity {
  orgId: string;
  userId?: string;
}

function identityHeaders(identity: RunIdentity): Record<string, string> {
  const headers: Record<string, string> = { "x-org-id": identity.orgId };
  if (identity.userId) headers["x-user-id"] = identity.userId;
  return headers;
}

// --- HTTP helpers ---

/** A runs-service refusal, with its status so callers tell a permanent 4xx from a transient failure. */
export class RunsHttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

async function runsRequest<T>(
  path: string,
  options: { method?: string; body?: unknown; headers?: Record<string, string> } = {}
): Promise<T> {
  const { method = "GET", body } = options;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-API-Key": RUNS_SERVICE_API_KEY,
    ...(options.headers ?? {}),
  };

  const response = await fetch(`${RUNS_SERVICE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new RunsHttpError(
      response.status,
      `runs-service ${method} ${path} failed: ${response.status} - ${errorText}`
    );
  }

  return response.json() as Promise<T>;
}

// --- Public API ---

export async function createRun(params: CreateRunParams): Promise<Run> {
  // runs-service resolves identity from HEADERS (x-org-id required, x-user-id
  // optional); body org/user is deprecated. serviceName/taskName stay in body.
  const headers: Record<string, string> = { "x-org-id": params.orgId };
  if (params.userId) headers["x-user-id"] = params.userId;
  if (params.parentRunId) headers["x-run-id"] = params.parentRunId;
  return runsRequest<Run>("/v1/runs", {
    method: "POST",
    headers,
    body: {
      serviceName: params.serviceName,
      taskName: params.taskName,
      ...(params.brandId ? { brandIds: [params.brandId] } : {}),
      ...(params.campaignId ? { campaignId: params.campaignId } : {}),
      ...(params.support ? { support: params.support } : {}),
    },
  });
}

export async function updateRun(
  runId: string,
  status: "completed" | "failed",
  identity: RunIdentity,
  error?: string
): Promise<Run> {
  return runsRequest<Run>(`/v1/runs/${runId}`, {
    method: "PATCH",
    headers: identityHeaders(identity),
    body: { status, error },
  });
}

export async function addCosts(
  runId: string,
  items: CostItem[],
  identity: RunIdentity
): Promise<{ costs: RunCost[] }> {
  return runsRequest<{ costs: RunCost[] }>(`/v1/runs/${runId}/costs`, {
    method: "POST",
    headers: identityHeaders(identity),
    body: { items },
  });
}

// --- Outcome ledger (COST-ACCOUNTING-1023) ---

export interface OutcomeOccurrence {
  outcomeKey: string;
  subjectService: string;
  subjectId: string;
}

export interface OutcomeDeclaration {
  produced: OutcomeOccurrence[];
  consumed: OutcomeOccurrence[];
  /** `run_started_at` = the occurrence happened when its run started (on time or backfilled). */
  occurredAt: "run_started_at";
}

/**
 * State on runs-service's general ledger the outcome occurrences a run of ours
 * produced and consumed. Idempotent on runs-service's side: a replay answers
 * `already_recorded` and records nothing twice.
 */
export async function declareRunOutcomes(
  runId: string,
  declaration: OutcomeDeclaration,
  identity: RunIdentity
): Promise<{ recordedCount: number; alreadyRecordedCount: number }> {
  return runsRequest(`/v1/runs/${runId}/outcomes`, {
    method: "POST",
    headers: identityHeaders(identity),
    body: declaration,
  });
}

export interface OwnSupportMark {
  kind: SupportFunction;
  reason: string;
  markedBy: string;
  runIds?: string[];
  taskNames?: string[];
  topLevelOnly?: boolean;
}

/**
 * Mark runs OF THIS SERVICE as support through runs-service's owner door
 * (x-service-name = twilio-service): by runIds (all or nothing) or by a
 * selection over our own runs. Idempotent: an already marked run is counted,
 * never marked twice.
 */
export async function markOwnRunsSupport(
  mark: OwnSupportMark
): Promise<{ markedCount: number; alreadyMarkedCount: number }> {
  return runsRequest("/v1/platform-runs/support-marks/apply", {
    method: "POST",
    headers: { "x-service-name": RUNS_SERVICE_NAME },
    body: mark,
  });
}

export const RUNS_SERVICE_NAME = "twilio-service";
