CREATE TABLE "twilio_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"call_sid" text,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"run_id" text,
	"parent_run_id" text,
	"brand_id" text,
	"campaign_id" text,
	"from" text NOT NULL,
	"to" text NOT NULL,
	"connect_to" text,
	"connect_name" text,
	"brand_name" text,
	"reply_name" text NOT NULL,
	"reply_company" text,
	"reply_message" text NOT NULL,
	"summary" text NOT NULL,
	"detail" text NOT NULL,
	"cost_name" text NOT NULL,
	"connect_cost_name" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"accepted" boolean DEFAULT false NOT NULL,
	"connected" boolean DEFAULT false NOT NULL,
	"duration_seconds" integer,
	"billed_minutes" integer,
	"connect_duration_seconds" integer,
	"connect_billed_minutes" integer,
	"cost_declared" boolean DEFAULT false NOT NULL,
	"connect_cost_declared" boolean DEFAULT false NOT NULL,
	"error_code" integer,
	"error_message" text,
	"accepted_at" timestamp with time zone,
	"connected_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "twilio_calls_call_sid_unique" UNIQUE("call_sid")
);
--> statement-breakpoint
CREATE INDEX "twilio_calls_call_sid_idx" ON "twilio_calls" USING btree ("call_sid");--> statement-breakpoint
CREATE INDEX "twilio_calls_org_id_idx" ON "twilio_calls" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "twilio_calls_run_id_idx" ON "twilio_calls" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "twilio_calls_brand_id_idx" ON "twilio_calls" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "twilio_calls_campaign_id_idx" ON "twilio_calls" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "twilio_calls_status_idx" ON "twilio_calls" USING btree ("status");