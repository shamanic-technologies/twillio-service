import { describe, it, expect, vi } from "vitest";

vi.mock("../../src/db", () => ({ db: {} }));

import {
  buildCampaignCallStats,
  outcomeOf,
  CallStatRow,
} from "../../src/lib/call-stats";

const CAMPAIGN = "29c5606a-4b86-49f9-8ca8-ed7ddcf894f4";
const EMPTY = "a42ef86c-f13c-4d64-802b-1a217017ece4";

function row(over: Partial<CallStatRow>): CallStatRow {
  return {
    campaignId: CAMPAIGN,
    createdAt: new Date("2026-10-07T11:24:00Z"),
    callSid: "CA1",
    status: "completed",
    accepted: false,
    connected: false,
    billedMinutes: 1,
    connectBilledMinutes: null,
    ...over,
  };
}

// Mirrors prod for campaign 29c5606a: one answered without keypress, three no-answer.
const PROD_ROWS: CallStatRow[] = [
  row({}),
  row({ createdAt: new Date("2026-10-07T13:41:20Z"), callSid: "CA2", status: "no-answer", billedMinutes: 0 }),
  row({ createdAt: new Date("2026-10-08T08:36:56Z"), callSid: "CA3", status: "no-answer", billedMinutes: 0 }),
  row({ createdAt: new Date("2026-10-08T08:41:54Z"), callSid: "CA4", status: "no-answer", billedMinutes: 0 }),
];

describe("buildCampaignCallStats", () => {
  it("counts the prod campaign: 4 placed, 0 accepted, 0 connected, 3 no-answer, two days", () => {
    const out = buildCampaignCallStats([CAMPAIGN], PROD_ROWS);
    const c = out.campaigns[0];
    expect(c.campaignId).toBe(CAMPAIGN);
    expect(c.totals.requested).toBe(4);
    expect(c.totals.placed).toBe(4);
    expect(c.totals.accepted).toBe(0);
    expect(c.totals.connected).toBe(0);
    expect(c.totals.outcomes.noAnswer).toBe(3);
    expect(c.totals.outcomes.answeredNotAccepted).toBe(1);
    expect(c.totals.billedMinutes).toBe(1);
    expect(c.daily.map((d) => d.day)).toEqual(["2026-10-07", "2026-10-08"]);
    expect(c.daily[0].requested).toBe(2);
    expect(c.daily[1].outcomes.noAnswer).toBe(2);
    expect(out.totals).toEqual(c.totals);
  });

  it("answers zeros for a campaign without calls, never omits it", () => {
    const out = buildCampaignCallStats([EMPTY, CAMPAIGN], PROD_ROWS);
    expect(out.campaigns.map((c) => c.campaignId)).toEqual([EMPTY, CAMPAIGN]);
    const empty = out.campaigns[0];
    expect(empty.totals.requested).toBe(0);
    expect(empty.totals.placed).toBe(0);
    expect(empty.totals.totalBilledMinutes).toBe(0);
    expect(Object.values(empty.totals.outcomes).every((v) => v === 0)).toBe(true);
    expect(empty.daily).toEqual([]);
  });

  it("dedups repeated campaign ids", () => {
    const out = buildCampaignCallStats([CAMPAIGN, CAMPAIGN], PROD_ROWS);
    expect(out.campaigns).toHaveLength(1);
    expect(out.totals.requested).toBe(4);
  });

  it("outcomes partition requested and daily sums to totals", () => {
    const rows = [
      ...PROD_ROWS,
      row({ callSid: null, status: "failed", billedMinutes: null }),
      row({ accepted: true, connected: true, billedMinutes: 2, connectBilledMinutes: 1, status: "in-progress" }),
      row({ accepted: true, billedMinutes: 2, createdAt: new Date("2026-10-09T23:59:59Z") }),
      row({ status: "busy", billedMinutes: 0 }),
      row({ status: "ringing", billedMinutes: null }),
    ];
    const t = buildCampaignCallStats([CAMPAIGN], rows).campaigns[0];
    const sum = Object.values(t.totals.outcomes).reduce((a, b) => a + b, 0);
    expect(sum).toBe(t.totals.requested);
    expect(t.totals.requested).toBe(9);
    expect(t.totals.placed).toBe(8);
    expect(t.totals.accepted).toBe(2);
    expect(t.totals.connected).toBe(1);
    expect(t.totals.outcomes.failed).toBe(1);
    expect(t.totals.outcomes.busy).toBe(1);
    expect(t.totals.outcomes.inProgress).toBe(1);
    expect(t.totals.outcomes.acceptedNotConnected).toBe(1);
    expect(t.totals.billedMinutes).toBe(5);
    expect(t.totals.connectBilledMinutes).toBe(1);
    expect(t.totals.totalBilledMinutes).toBe(6);
    const dailyRequested = t.daily.reduce((a, d) => a + d.requested, 0);
    expect(dailyRequested).toBe(9);
    expect(t.daily.map((d) => d.day)).toEqual(["2026-10-07", "2026-10-08", "2026-10-09"]);
  });
});

describe("outcomeOf", () => {
  it("lets the keypress facts beat a stale status", () => {
    expect(outcomeOf(row({ accepted: true, connected: true, status: "in-progress" }))).toBe("connected");
    expect(outcomeOf(row({ accepted: true, status: "no-answer" }))).toBe("acceptedNotConnected");
  });
  it("buckets an unknown status as failed", () => {
    expect(outcomeOf(row({ status: "weird" }))).toBe("failed");
  });
});
