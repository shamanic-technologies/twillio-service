/**
 * HTTP client for client-service.
 *
 * client-service OWNS account/Clerk/billing provisioning. When an unknown phone
 * number messages the WhatsApp bot, this service does NOT create a Clerk org or
 * grant credit itself — it asks client-service to resolve-or-provision a full
 * signup-equivalent account (with the $5 welcome credit) for that phone, and
 * caches the returned mapping.
 *
 * NOTE ON THE CONTRACT: at time of writing, client-service does not yet deploy a
 * phone→account provisioning route (it exposes POST /internal/resolve, which
 * upserts an EXISTING Clerk external org/user id → internal UUIDs, and does not
 * create Clerk orgs or grant credit). This caller is therefore written
 * ADAPTABLY, not frozen to a guessed shape:
 *   - the endpoint path is env-overridable via CLIENT_PHONE_PROVISION_PATH, so
 *     conforming to whatever client-service ships is a config change, not a code
 *     change;
 *   - the response is read against client-service's existing {orgId, userId}
 *     internal-UUID convention (same as /internal/resolve).
 * A cross-repo request for this endpoint is tracked separately; until it deploys,
 * unknown-number provisioning fails loud (no silent fallback, no local Clerk /
 * credit work).
 */

const CLIENT_SERVICE_URL = process.env.CLIENT_SERVICE_URL;
const CLIENT_SERVICE_API_KEY = process.env.CLIENT_SERVICE_API_KEY || "";
// Overridable so we conform to the deployed client-service route name without a
// code change once it ships.
const CLIENT_PHONE_PROVISION_PATH =
  process.env.CLIENT_PHONE_PROVISION_PATH || "/internal/resolve-phone";

export interface ResolveOrProvisionByPhoneParams {
  /** Sender phone in E.164, e.g. "+14155551234". */
  phone: string;
  /** WhatsApp profile display name, when known — used for the account name. */
  profileName?: string;
  /** Which surface the signup originated from (for client-service attribution). */
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
 * signup-equivalent, $5 welcome credit) via client-service if none exists.
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
    body: JSON.stringify({
      phone: params.phone,
      profileName: params.profileName,
      source: params.source || "whatsapp",
    }),
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
    orgCreated?: boolean;
    userCreated?: boolean;
  };

  if (!data.orgId || !data.userId) {
    throw new Error(
      "client-service phone provision returned no orgId/userId"
    );
  }

  return {
    orgId: data.orgId,
    userId: data.userId,
    // Accept either an explicit `created` flag or client-service's existing
    // orgCreated/userCreated convention.
    created: Boolean(data.created ?? data.orgCreated ?? data.userCreated),
  };
}
