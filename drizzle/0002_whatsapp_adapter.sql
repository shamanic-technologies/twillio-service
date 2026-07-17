CREATE TABLE "whatsapp_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone" text NOT NULL,
	"session_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_sessions_phone_unique" UNIQUE("phone")
);
--> statement-breakpoint
CREATE TABLE "whatsapp_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone" text NOT NULL,
	"wa_id" text,
	"profile_name" text,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_users_phone_unique" UNIQUE("phone")
);
--> statement-breakpoint
ALTER TABLE "twilio_sendings" ADD COLUMN "channel" text DEFAULT 'sms' NOT NULL;--> statement-breakpoint
CREATE INDEX "whatsapp_sessions_phone_idx" ON "whatsapp_sessions" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "whatsapp_users_phone_idx" ON "whatsapp_users" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "whatsapp_users_org_id_idx" ON "whatsapp_users" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "whatsapp_users_user_id_idx" ON "whatsapp_users" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "twilio_sendings_channel_idx" ON "twilio_sendings" USING btree ("channel");