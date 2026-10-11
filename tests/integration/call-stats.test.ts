import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

const h = vi.hoisted(() => ({ fetchRows: vi.fn(), findFirstCall: vi.fn() }));

vi.mock("../../src/db", () => ({
  db: { query: { twilioCalls: { findFirst: h.findFirstCall } } },
}));

vi.mock("../../src/lib/call-stats", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/call-stats")>();
  return { ...actual, fetchCampaignCallRows: h.fetchRows };
});

import { createTestApp } from "../helpers/test-app";

const app = createTestApp();
const AUTH = {
  "X-API-Key": process.env.TWILIO_SERVICE_API_KEY || "test-secret-key",
  "x-org-id": "org-1",
  "x-user-id": "user-1",
};
const PATH = "/calls/stats/by-campaign";

beforeEach(() => {
  h.fetchRows.mockReset();
  h.findFirstCall.mockReset();
});

describe("GET /calls/stats/by-campaign", () => {
  it("scopes to the caller's org and counts per campaign and per day", async () => {
    h.fetchRows.mockResolvedValue([
      {
        campaignId: "c1",
        createdAt: new Date("2026-10-07T11:00:00Z"),
        callSid: "CA1",
        status: "no-answer",
        accepted: false,
        connected: false,
        billedMinutes: 0,
        connectBilledMinutes: null,
      },
    ]);
    const res = await request(app).get(`${PATH}?campaignIds=c1,c2,c1`).set(AUTH);
    expect(res.status).toBe(200);
    expect(h.fetchRows).toHaveBeenCalledWith("org-1", ["c1", "c2"]);
    expect(res.body.campaigns).toHaveLength(2);
    expect(res.body.campaigns[0].totals.placed).toBe(1);
    expect(res.body.campaigns[0].totals.outcomes.noAnswer).toBe(1);
    expect(res.body.campaigns[0].daily[0].day).toBe("2026-10-07");
    expect(res.body.campaigns[1]).toMatchObject({ campaignId: "c2", daily: [] });
    expect(res.body.campaigns[1].totals.requested).toBe(0);
    expect(res.body.totals.requested).toBe(1);
    // Never reads the single-call lookup.
    expect(h.findFirstCall).not.toHaveBeenCalled();
  });

  it("400s without campaignIds", async () => {
    const res = await request(app).get(PATH).set(AUTH);
    expect(res.status).toBe(400);
    expect(h.fetchRows).not.toHaveBeenCalled();
  });

  it("400s on an empty list", async () => {
    const res = await request(app).get(`${PATH}?campaignIds=,,`).set(AUTH);
    expect(res.status).toBe(400);
  });

  it("400s above 200 campaigns", async () => {
    const ids = Array.from({ length: 201 }, (_, i) => `c${i}`).join(",");
    const res = await request(app).get(`${PATH}?campaignIds=${ids}`).set(AUTH);
    expect(res.status).toBe(400);
  });

  it("requires the API key", async () => {
    const res = await request(app).get(`${PATH}?campaignIds=c1`);
    expect(res.status).toBe(401);
  });

  it("500s when the read fails", async () => {
    h.fetchRows.mockRejectedValue(new Error("db down"));
    const res = await request(app).get(`${PATH}?campaignIds=c1`).set(AUTH);
    expect(res.status).toBe(500);
  });
});
