/**
 * HTTP client for client-service.
 *
 * client-service OWNS account/Clerk/billing provisioning. When an unknown phone
 * number messages the WhatsApp bot, this service does NOT create a Clerk org or
 * grant credit itself — it asks client-service to resolve-or-provision a full
 * signup-equivalent account (with the welcome credit) for that phone, and caches
 * the returned mapping locally.
 *
 * Conforms to the deployed client-service contract (client-service PR #76 /
 * issue #77, verified live via the api-registry):
 *
 *   POST /internal/phone-accounts   (requireApiKey, service-to-service)
 *     request:  { phone }            — E.164, ^\+[1-9]\d{6,14}$
 *     response: { orgId, userId, phone, clerkOrgId, clerkUserId, created }
 *     Idempotent per phone: a repeat call returns the existing identity with
 *     created=false and no side effects. Fails loud (502) on Clerk/billing error.
 *
 * The path stays env-overridable (CLIENT_PHONE_PROVISION_PATH) so a future
 * rename conforms without a code change. Fails loud on any error — no silent
 * fallback, no local Clerk/credit work.
 */

const CLIENT_SERVICE_URL = process.env.CLIENT_SERVICE_URL;
const CLIENT_SERVICE_API_KEY = process.env.CLIENT_SERVICE_API_KEY || "";
const CLIENT_PHONE_PROVISION_PATH =
  process.env.CLIENT_PHONE_PROVISION_PATH || "/internal/phone-accounts";

export interface ResolveOrProvisionByPhoneParams {
  /** Sender phone in E.164, e.g. "+14155551234". */
  phone: string;
  /** WhatsApp profile display name, when known (currently informational only). */
  profileName?: string;
  /** Origin surface (currently informational only). */
  source?: string;
}

export interface ResolvedAccount {
  /** Internal client-service org UUID (the platform x-org-id). */
  orgId: string;
  /** Internal client-service user UUID (the platform x-user-id). */
  userId: string;
  /** True when this call provisioned a brand-new account. */
  created: boolean;
}

/**
 * Resolve a phone number to a platform account, provisioning a new one (full
 * signup-equivalent, welcome credit) via client-service if none exists.
 * Idempotent on the phone number. Fails loud on any error.
 */
export async function resolveOrProvisionAccountByPhone(
  params: ResolveOrProvisionByPhoneParams
): Promise<ResolvedAccount> {
  if (!CLIENT_SERVICE_URL) {
    throw new Error("CLIENT_SERVICE_URL not configured");
  }

  const res = await fetch(`${CLIENT_SERVICE_URL}${CLIENT_PHONE_PROVISION_PATH}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": CLIENT_SERVICE_API_KEY,
    },
    // Contract accepts only { phone }.
    body: JSON.stringify({ phone: params.phone }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `client-service phone provision failed: ${res.status} ${body}`
    );
  }

  const data = (await res.json()) as {
    orgId?: string;
    userId?: string;
    created?: boolean;
  };

  if (!data.orgId || !data.userId) {
    throw new Error("client-service phone provision returned no orgId/userId");
  }

  return {
    orgId: data.orgId,
    userId: data.userId,
    created: Boolean(data.created),
  };
}
