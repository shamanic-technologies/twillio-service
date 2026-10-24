ALTER TABLE "twilio_sendings" ADD COLUMN "send_run_id" text;--> statement-breakpoint
ALTER TABLE "twilio_sendings" ADD COLUMN "outcome_subject_service" text;--> statement-breakpoint
ALTER TABLE "twilio_sendings" ADD COLUMN "outcome_subject_id" text;--> statement-breakpoint
ALTER TABLE "twilio_sendings" ADD COLUMN "consumed_outcome_keys" text[];--> statement-breakpoint
ALTER TABLE "twilio_sendings" ADD COLUMN "outcome_declared_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "twilio_sendings" ADD COLUMN "outcome_declare_error" text;