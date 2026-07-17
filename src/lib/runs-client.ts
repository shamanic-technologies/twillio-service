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
    throw new Error(
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
