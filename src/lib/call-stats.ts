import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { twilioCalls } from "../db/schema";

/**
 * Per-campaign call counts, since inception and per UTC day (the day the call
 * row was created, i.e. the day we asked Twilio to place it).
 *
 * Every call row is counted exactly once. The top-level counters
 * (`requested`, `placed`, `accepted`, `connected`) are nested (connected ⊆
 * accepted ⊆ placed ⊆ requested); `outcomes` PARTITIONS `requested` so its
 * members always add up to `requested`.
 */

/** Twilio statuses that mean the call is still underway. */
const IN_PROGRESS_STATUSES = ["queued", "initiated", "ringing", "in-progress"];

export interface CallOutcomes {
  connected: number;
  acceptedNotConnected: number;
  answeredNotAccepted: number;
  noAnswer: number;
  busy: number;
  failed: number;
  canceled: number;
  inProgress: number;
}

export interface CallCounts {
  requested: number;
  placed: number;
  accepted: number;
  connected: number;
  outcomes: CallOutcomes;
  billedMinutes: number;
  connectBilledMinutes: number;
  totalBilledMinutes: number;
}

export interface DailyCallCounts extends CallCounts {
  day: string;
}

export interface CampaignCallStats {
  campaignId: string;
  totals: CallCounts;
  daily: DailyCallCounts[];
}

export interface CampaignCallStatsResponse {
  campaigns: CampaignCallStats[];
  totals: CallCounts;
}

/** The minimum a call row must carry to be counted. */
export interface CallStatRow {
  campaignId: string;
  createdAt: Date;
  callSid: string | null;
  status: string;
  accepted: boolean;
  connected: boolean;
  billedMinutes: number | null;
  connectBilledMinutes: number | null;
}

export function emptyCounts(): CallCounts {
  return {
    requested: 0,
    placed: 0,
    accepted: 0,
    connected: 0,
    outcomes: {
      connected: 0,
      acceptedNotConnected: 0,
      answeredNotAccepted: 0,
      noAnswer: 0,
      busy: 0,
      failed: 0,
      canceled: 0,
      inProgress: 0,
    },
    billedMinutes: 0,
    connectBilledMinutes: 0,
    totalBilledMinutes: 0,
  };
}

/** The one outcome bucket a row falls in. Keypress facts beat the status. */
export function outcomeOf(row: CallStatRow): keyof CallOutcomes {
  if (row.connected) return "connected";
  if (row.accepted) return "acceptedNotConnected";
  switch (row.status) {
    case "completed":
      return "answeredNotAccepted";
    case "no-answer":
      return "noAnswer";
    case "busy":
      return "busy";
    case "failed":
      return "failed";
    case "canceled":
      return "canceled";
    default:
      return IN_PROGRESS_STATUSES.includes(row.status) ? "inProgress" : "failed";
  }
}

function add(counts: CallCounts, row: CallStatRow): void {
  counts.requested += 1;
  if (row.callSid) counts.placed += 1;
  if (row.accepted || row.connected) counts.accepted += 1;
  if (row.connected) counts.connected += 1;
  counts.outcomes[outcomeOf(row)] += 1;
  const placedMinutes = row.billedMinutes ?? 0;
  const connectMinutes = row.connectBilledMinutes ?? 0;
  counts.billedMinutes += placedMinutes;
  counts.connectBilledMinutes += connectMinutes;
  counts.totalBilledMinutes += placedMinutes + connectMinutes;
}

function utcDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Shape the rows into the response. Every requested campaign answers, a
 * campaign without rows answers zeros and an empty `daily`. Campaigns keep the
 * caller's order; days ascend.
 */
export function buildCampaignCallStats(
  campaignIds: string[],
  rows: CallStatRow[]
): CampaignCallStatsResponse {
  const byCampaign = new Map<
    string,
    { totals: CallCounts; days: Map<string, CallCounts> }
  >();
  for (const id of campaignIds) {
    if (!byCampaign.has(id)) {
      byCampaign.set(id, { totals: emptyCounts(), days: new Map() });
    }
  }
  const totals = emptyCounts();

  for (const row of rows) {
    const entry = byCampaign.get(row.campaignId);
    if (!entry) continue;
    add(entry.totals, row);
    add(totals, row);
    const day = utcDay(row.createdAt);
    let dayCounts = entry.days.get(day);
    if (!dayCounts) {
      dayCounts = emptyCounts();
      entry.days.set(day, dayCounts);
    }
    add(dayCounts, row);
  }

  return {
    campaigns: [...byCampaign.entries()].map(([campaignId, entry]) => ({
      campaignId,
      totals: entry.totals,
      daily: [...entry.days.entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([day, counts]) => ({ day, ...counts })),
    })),
    totals,
  };
}

/** Every call row of the caller's org for these campaigns. */
export async function fetchCampaignCallRows(
  orgId: string,
  campaignIds: string[]
): Promise<CallStatRow[]> {
  if (campaignIds.length === 0) return [];
  const rows = await db
    .select({
      campaignId: twilioCalls.campaignId,
      createdAt: twilioCalls.createdAt,
      callSid: twilioCalls.callSid,
      status: twilioCalls.status,
      accepted: twilioCalls.accepted,
      connected: twilioCalls.connected,
      billedMinutes: twilioCalls.billedMinutes,
      connectBilledMinutes: twilioCalls.connectBilledMinutes,
    })
    .from(twilioCalls)
    .where(
      and(
        eq(twilioCalls.orgId, orgId),
        inArray(twilioCalls.campaignId, campaignIds)
      )
    );
  return rows.filter((r): r is CallStatRow => r.campaignId !== null);
}
