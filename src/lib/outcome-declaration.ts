import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";
import { db } from "../db";
import { twilioSendings } from "../db/schema";
import { errorMessage } from "./db-error";
import {
  declareRunOutcomes,
  OutcomeDeclaration,
  RunsHttpError,
} from "./runs-client";

/**
 * The outcome a send PRODUCES, declared on its own send run to runs-service's
 * production-cost ledger (COST-ACCOUNTING-1023, agent-config skill
 * `cost-accounting`). Same contract as postmark-service's sends.
 *
 * One rule for every channel this service sends on (SMS, WhatsApp): a send
 * that names the person it reached (an outcome subject) produced
 * `message_sent` for that person, plus the inputs the caller says it consumed
 * (e.g. `message_written`); a send that names nobody declares nothing and its
 * cost reads "produced none". Only the caller knows whom it is reaching on a
 * campaign, so the caller names the subject. Never invented here.
 *
 * Never blocks or fails the send: declared after the send is recorded. A
 * transient failure leaves the row owed (`outcome_declared_at` NULL) and the
 * boot sweep (`declareOwedSendOutcomes`, ledger-history.ts) re-declares it;
 * runs-service's idempotency makes a replay `already_recorded`. A permanent
 * 4xx refusal is stored on the row and logged, not retried.
 */

export const MESSAGE_SENT = "message_sent";
export const LEAD_SERVICE = "lead-service";

export interface OutcomeSubject {
  subjectService: string;
  subjectId: string;
}

export function resolveOutcomeSubject(input: {
  outcomeSubject?: OutcomeSubject;
  leadId?: string;
}): OutcomeSubject | null {
  if (input.outcomeSubject) return input.outcomeSubject;
  if (input.leadId) return { subjectService: LEAD_SERVICE, subjectId: input.leadId };
  return null;
}

export function buildSendDeclaration(
  subject: OutcomeSubject,
  consumedOutcomeKeys: string[] | null | undefined
): OutcomeDeclaration {
  return {
    produced: [{ outcomeKey: MESSAGE_SENT, ...subject }],
    consumed: (consumedOutcomeKeys ?? []).map((outcomeKey) => ({ outcomeKey, ...subject })),
    // One run per send, opened just before the provider call: the send
    // happened when its run started, however late the declaration lands.
    occurredAt: "run_started_at",
  };
}

export interface OwedSendDeclaration {
  sendingId: string;
  sendRunId: string;
  orgId: string;
  subjectService: string;
  subjectId: string;
  consumedOutcomeKeys: string[] | null;
}

function isPermanentRefusal(err: unknown): boolean {
  return (
    err instanceof RunsHttpError &&
    err.status >= 400 &&
    err.status < 500 &&
    err.status !== 408 &&
    err.status !== 429 &&
    // The catalogue key unknown right now is features-service's to fix: retry.
    !err.message.includes("unknown_outcome_key")
  );
}

/** Declare one send's outcome and record the result on its row. Never throws. */
export async function declareSendOutcome(owed: OwedSendDeclaration): Promise<void> {
  const declaration = buildSendDeclaration(
    { subjectService: owed.subjectService, subjectId: owed.subjectId },
    owed.consumedOutcomeKeys
  );
  try {
    await declareRunOutcomes(owed.sendRunId, declaration, { orgId: owed.orgId });
  } catch (err) {
    const reason = errorMessage(err);
    if (isPermanentRefusal(err)) {
      console.error(
        `[outcome-declaration] REFUSED, not retried — sending=${owed.sendingId} run=${owed.sendRunId} subject=${owed.subjectService}/${owed.subjectId} error="${reason}"`
      );
      await markRow(owed.sendingId, { outcomeDeclareError: reason.slice(0, 1000) });
      return;
    }
    console.error(
      `[outcome-declaration] FAILED, owed and retried at next boot — sending=${owed.sendingId} run=${owed.sendRunId} subject=${owed.subjectService}/${owed.subjectId} error="${reason}"`
    );
    return;
  }
  await markRow(owed.sendingId, { outcomeDeclaredAt: new Date() });
}

async function markRow(
  sendingId: string,
  set: { outcomeDeclaredAt?: Date; outcomeDeclareError?: string }
): Promise<void> {
  try {
    await db.update(twilioSendings).set(set).where(eq(twilioSendings.id, sendingId));
  } catch (err) {
    console.error(
      `[outcome-declaration] could not mark sending=${sendingId} — error="${errorMessage(err)}"`
    );
  }
}

/**
 * Every send that named its person and is not declared yet (past included),
 * oldest first. Rows with no subject or no own run are never declared: nothing
 * is invented.
 */
export async function declareOwedSendOutcomes(): Promise<{ owed: number }> {
  const rows = await db
    .select({
      sendingId: twilioSendings.id,
      sendRunId: twilioSendings.sendRunId,
      orgId: twilioSendings.orgId,
      subjectService: twilioSendings.outcomeSubjectService,
      subjectId: twilioSendings.outcomeSubjectId,
      consumedOutcomeKeys: twilioSendings.consumedOutcomeKeys,
    })
    .from(twilioSendings)
    .where(
      and(
        isNotNull(twilioSendings.outcomeSubjectId),
        isNotNull(twilioSendings.sendRunId),
        isNotNull(twilioSendings.orgId),
        isNull(twilioSendings.outcomeDeclaredAt),
        isNull(twilioSendings.outcomeDeclareError)
      )
    )
    .orderBy(asc(twilioSendings.createdAt));
  for (const r of rows) {
    await declareSendOutcome({
      sendingId: r.sendingId,
      sendRunId: r.sendRunId!,
      orgId: r.orgId!,
      subjectService: r.subjectService!,
      subjectId: r.subjectId!,
      consumedOutcomeKeys: r.consumedOutcomeKeys,
    });
  }
  return { owed: rows.length };
}

/** The row columns a send stores about whom it reached (all NULL when the caller named nobody). */
export function sendSubjectColumns(input: {
  outcomeSubject?: OutcomeSubject;
  leadId?: string;
  consumedOutcomeKeys?: string[];
}) {
  const subject = resolveOutcomeSubject(input);
  return {
    outcomeSubjectService: subject?.subjectService ?? null,
    outcomeSubjectId: subject?.subjectId ?? null,
    consumedOutcomeKeys: subject && input.consumedOutcomeKeys?.length ? input.consumedOutcomeKeys : null,
  };
}

/** After a recorded send: declare it off the request path when it named its person. */
export function declareRecordedSend(row: {
  sendingId: string;
  sendRunId: string;
  orgId: string;
  outcomeSubjectService: string | null;
  outcomeSubjectId: string | null;
  consumedOutcomeKeys: string[] | null;
}): void {
  if (!row.outcomeSubjectService || !row.outcomeSubjectId) return;
  void declareSendOutcome({
    sendingId: row.sendingId,
    sendRunId: row.sendRunId,
    orgId: row.orgId,
    subjectService: row.outcomeSubjectService,
    subjectId: row.outcomeSubjectId,
    consumedOutcomeKeys: row.consumedOutcomeKeys,
  });
}
