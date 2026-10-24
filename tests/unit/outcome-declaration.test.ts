import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  declareRunOutcomes: vi.fn(),
  set: vi.fn(),
}));

vi.mock("../../src/db", () => ({
  db: { update: () => ({ set: (v: unknown) => (h.set(v), { where: () => Promise.resolve() }) }) },
}));

vi.mock("../../src/lib/runs-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/runs-client")>();
  return { ...actual, declareRunOutcomes: h.declareRunOutcomes };
});

import { RunsHttpError } from "../../src/lib/runs-client";
import {
  buildSendDeclaration,
  declareSendOutcome,
  sendSubjectColumns,
} from "../../src/lib/outcome-declaration";

const OWED = {
  sendingId: "s-1",
  sendRunId: "run-1",
  orgId: "org-1",
  subjectService: "lead-service",
  subjectId: "lead-1",
  consumedOutcomeKeys: null,
};

describe("send subject", () => {
  it("names the lead in lead-service from leadId, an explicit subject wins", () => {
    expect(sendSubjectColumns({ leadId: "lead-1" })).toEqual({
      outcomeSubjectService: "lead-service",
      outcomeSubjectId: "lead-1",
      consumedOutcomeKeys: null,
    });
    expect(
      sendSubjectColumns({ leadId: "lead-1", outcomeSubject: { subjectService: "crm-service", subjectId: "c-1" } })
        .outcomeSubjectService
    ).toBe("crm-service");
  });

  it("names nobody when the caller names nobody", () => {
    expect(sendSubjectColumns({})).toEqual({
      outcomeSubjectService: null,
      outcomeSubjectId: null,
      consumedOutcomeKeys: null,
    });
  });

  it("declares message_sent produced and the stated inputs consumed", () => {
    expect(buildSendDeclaration({ subjectService: "lead-service", subjectId: "l" }, ["message_written"])).toEqual({
      produced: [{ outcomeKey: "message_sent", subjectService: "lead-service", subjectId: "l" }],
      consumed: [{ outcomeKey: "message_written", subjectService: "lead-service", subjectId: "l" }],
      occurredAt: "run_started_at",
    });
  });
});

describe("declareSendOutcome", () => {
  beforeEach(() => vi.clearAllMocks());

  it("marks the row declared on success", async () => {
    h.declareRunOutcomes.mockResolvedValue({ recordedCount: 1, alreadyRecordedCount: 0 });
    await declareSendOutcome(OWED);
    expect(h.set).toHaveBeenCalledWith({ outcomeDeclaredAt: expect.any(Date) });
  });

  it("stores a permanent refusal and never retries it", async () => {
    h.declareRunOutcomes.mockRejectedValue(new RunsHttpError(409, "run_org_mismatch"));
    await declareSendOutcome(OWED);
    expect(h.set).toHaveBeenCalledWith({ outcomeDeclareError: "run_org_mismatch" });
  });

  it("leaves the row owed on a transient failure or an unknown catalogue key", async () => {
    h.declareRunOutcomes.mockRejectedValueOnce(new RunsHttpError(502, "down"));
    await declareSendOutcome(OWED);
    h.declareRunOutcomes.mockRejectedValueOnce(new RunsHttpError(400, "unknown_outcome_key"));
    await declareSendOutcome(OWED);
    expect(h.set).not.toHaveBeenCalled();
  });
});
