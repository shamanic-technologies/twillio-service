ALTER TABLE "twilio_sendings" ADD COLUMN "user_id" text;--> statement-breakpoint
DROP INDEX "twilio_sendings_app_id_idx";--> statement-breakpoint
ALTER TABLE "twilio_sendings" DROP COLUMN "app_id";--> statement-breakpoint
CREATE INDEX "twilio_sendings_user_id_idx" ON "twilio_sendings" USING btree ("user_id");
