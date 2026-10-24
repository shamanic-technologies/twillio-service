import { and, isNotNull, isNull } from "drizzle-orm";
import { db } from "../db";
import { twilioCalls } from "../db/schema";
import { errorMessage } from "./db-error";
import { declareOwedSendOutcomes } from "./outcome-declaration";
import { markOwnRunsSupport, SupportFunction } from "./runs-client";

/**
 * LEDGER-HISTORY-1024: every run this service has EVER run states, in
 * runs-service's general ledger, what it produced, or is marked support, from
 * this service's own records, exactly as a run made today would. Nothing
 * estimated. Idempotent: runs-service answers `already_recorded` /
 * `alreadyMarkedCount` on a replay, so it runs on every boot (after listen,
 * never blocking it).
 *
 * What each task of ours is, today and in the past:
 * - `send-sms` / `whatsapp-send`: `message_sent` for the person the caller
 *   named (outcome-declaration.ts). Unnamed = nothing declared.
 * - `whatsapp-inbound`: the Copilot answering over WhatsApp. Support
 *   `copilot` by design (marked at creation since this change; the past by a
 *   selection over our own runs of that task). The mark covers the
 *   chat-service subtree, which declares nothing.
 * - `place-call` ordered by a pipe (a parent run): the parent declares
 *   `booking_call` for the lead (workflow-service's AI Instant Call DAG); our
 *   run is its child and declares nothing, so its cost rides that occurrence.
 * - `place-call` with NO parent run: no pipe ordered it, so it is a staff
 *   probe of the voice channel: support `staff_experiment` (at creation since
 *   this change; the past from our own `twilio_calls` rows).
 * - A failed run that spent nothing stays a run with no output.
 */

export const WHATSAPP_INBOUND_TASK = "whatsapp-inbound";

export const COPILOT_SUPPORT: { kind: SupportFunction; reason: string } = {
  kind: "copilot",
  reason:
    "WhatsApp inbound: the Copilot (chat-service agentic chat) answering a user over WhatsApp. Produces no outcome by design.",
};

export const UNORDERED_CALL_SUPPORT: { kind: SupportFunction; reason: string } = {
  kind: "staff_experiment",
  reason:
    "Voice call placed with no parent run: no pipe ordered it, a direct probe of the voice channel.",
};

const MARKED_BY = "twilio-service LEDGER-HISTORY-1024";

/** Our own call runs that no pipe ordered (no parent run), from `twilio_calls`. */
export async function unorderedCallRunIds(): Promise<string[]> {
  const rows = await db
    .select({ runId: twilioCalls.runId })
    .from(twilioCalls)
    .where(and(isNotNull(twilioCalls.runId), isNull(twilioCalls.parentRunId)));
  return [...new Set(rows.map((r) => r.runId!))];
}

export async function backfillLedgerHistory(): Promise<void> {
  const copilot = await markOwnRunsSupport({
    ...COPILOT_SUPPORT,
    markedBy: MARKED_BY,
    taskNames: [WHATSAPP_INBOUND_TASK],
  });
  console.log(
    `[ledger-history] ${WHATSAPP_INBOUND_TASK} support copilot: marked=${copilot.markedCount} already=${copilot.alreadyMarkedCount}`
  );

  const runIds = await unorderedCallRunIds();
  if (runIds.length > 0) {
    const calls = await markOwnRunsSupport({
      ...UNORDERED_CALL_SUPPORT,
      markedBy: MARKED_BY,
      runIds,
    });
    console.log(
      `[ledger-history] unordered calls support staff_experiment: marked=${calls.markedCount} already=${calls.alreadyMarkedCount}`
    );
  }

  const sends = await declareOwedSendOutcomes();
  console.log(`[ledger-history] owed send declarations swept: ${sends.owed}`);
}

/** Boot entry: never throws, never blocks listen. */
export function runLedgerHistoryInBackground(): void {
  backfillLedgerHistory().catch((err) => {
    console.error(`[ledger-history] FAILED — error="${errorMessage(err)}"`);
  });
}
