CREATE TABLE "twilio_sendings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_sid" text NOT NULL,
	"org_id" text,
	"run_id" text,
	"brand_id" text,
	"app_id" text,
	"campaign_id" text,
	"from" text NOT NULL,
	"to" text NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"num_segments" integer,
	"price" text,
	"price_unit" text,
	"error_code" integer,
	"error_message" text,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "twilio_sendings_message_sid_unique" UNIQUE("message_sid")
);
--> statement-breakpoint
CREATE TABLE "twilio_status_updates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_sid" text NOT NULL,
	"message_status" text NOT NULL,
	"error_code" integer,
	"error_message" text,
	"raw_payload" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "twilio_sendings_message_sid_idx" ON "twilio_sendings" USING btree ("message_sid");--> statement-breakpoint
CREATE INDEX "twilio_sendings_org_id_idx" ON "twilio_sendings" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "twilio_sendings_run_id_idx" ON "twilio_sendings" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "twilio_sendings_brand_id_idx" ON "twilio_sendings" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "twilio_sendings_app_id_idx" ON "twilio_sendings" USING btree ("app_id");--> statement-breakpoint
CREATE INDEX "twilio_sendings_campaign_id_idx" ON "twilio_sendings" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "twilio_status_updates_message_sid_idx" ON "twilio_status_updates" USING btree ("message_sid");--> statement-breakpoint
CREATE INDEX "twilio_status_updates_status_idx" ON "twilio_status_updates" USING btree ("message_status");