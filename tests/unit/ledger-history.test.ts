import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  callRows: [] as Array<{ runId: string | null }>,
  markOwnRunsSupport: vi.fn(),
  declareOwedSendOutcomes: vi.fn(),
}));

vi.mock("../../src/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => Promise.resolve(h.callRows) }) }),
  },
}));

vi.mock("../../src/lib/runs-client", () => ({
  markOwnRunsSupport: h.markOwnRunsSupport,
}));

vi.mock("../../src/lib/outcome-declaration", () => ({
  declareOwedSendOutcomes: h.declareOwedSendOutcomes,
}));

import { backfillLedgerHistory } from "../../src/lib/ledger-history";

describe("backfillLedgerHistory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.markOwnRunsSupport.mockResolvedValue({ markedCount: 0, alreadyMarkedCount: 0 });
    h.declareOwedSendOutcomes.mockResolvedValue({ owed: 0 });
  });

  it("marks every whatsapp-inbound run copilot, unordered calls staff_experiment, and sweeps owed sends", async () => {
    h.callRows = [{ runId: "run-a" }, { runId: "run-b" }, { runId: "run-a" }];
    await backfillLedgerHistory();

    expect(h.markOwnRunsSupport).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "copilot", taskNames: ["whatsapp-inbound"] })
    );
    expect(h.markOwnRunsSupport).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "staff_experiment", runIds: ["run-a", "run-b"] })
    );
    expect(h.declareOwedSendOutcomes).toHaveBeenCalledOnce();
  });

  it("asks nothing for calls when every call was ordered by a pipe", async () => {
    h.callRows = [];
    await backfillLedgerHistory();
    expect(h.markOwnRunsSupport).toHaveBeenCalledTimes(1);
  });

  it("fails loud when runs-service refuses (the boot wrapper logs it)", async () => {
    h.markOwnRunsSupport.mockRejectedValue(new Error("runs-service 422"));
    await expect(backfillLedgerHistory()).rejects.toThrow("runs-service 422");
  });
});
