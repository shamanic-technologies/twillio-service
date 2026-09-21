ALTER TABLE "twilio_calls" ADD COLUMN "reply_first_name" text;--> statement-breakpoint
ALTER TABLE "twilio_calls" ADD COLUMN "reply_last_name" text;--> statement-breakpoint
ALTER TABLE "twilio_calls" ADD COLUMN "reply_title" text;--> statement-breakpoint
ALTER TABLE "twilio_calls" ADD COLUMN "reply_city" text;--> statement-breakpoint
ALTER TABLE "twilio_calls" ADD COLUMN "reply_state" text;--> statement-breakpoint
ALTER TABLE "twilio_calls" ADD COLUMN "reply_country" text;--> statement-breakpoint
ALTER TABLE "twilio_calls" ADD COLUMN "prior_messages" jsonb;