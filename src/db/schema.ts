import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  index,
} from "drizzle-orm/pg-core";

// ═══════════════════════════════════════════════════════════════════════════════
// SMS Sendings — main record for each SMS sent via Twilio
// ═══════════════════════════════════════════════════════════════════════════════

export const twilioSendings = pgTable(
  "twilio_sendings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    messageSid: text("message_sid").notNull().unique(),
    orgId: text("org_id"),
    userId: text("user_id"),
    runId: text("run_id"),
    brandId: text("brand_id"),
    campaignId: text("campaign_id"),
    from: text("from").notNull(),
    to: text("to").notNull(),
    body: text("body").notNull(),
    status: text("status").notNull().default("queued"),
    numSegments: integer("num_segments"),
    price: text("price"),
    priceUnit: text("price_unit"),
    errorCode: integer("error_code"),
    errorMessage: text("error_message"),
    sentAt: timestamp("sent_at", { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("twilio_sendings_message_sid_idx").on(table.messageSid),
    index("twilio_sendings_org_id_idx").on(table.orgId),
    index("twilio_sendings_user_id_idx").on(table.userId),
    index("twilio_sendings_run_id_idx").on(table.runId),
    index("twilio_sendings_brand_id_idx").on(table.brandId),
    index("twilio_sendings_campaign_id_idx").on(table.campaignId),
  ]
);

// ═══════════════════════════════════════════════════════════════════════════════
// Status Updates — Twilio status callback events
// ═══════════════════════════════════════════════════════════════════════════════

export const twilioStatusUpdates = pgTable(
  "twilio_status_updates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    messageSid: text("message_sid").notNull(),
    messageStatus: text("message_status").notNull(),
    errorCode: integer("error_code"),
    errorMessage: text("error_message"),
    rawPayload: text("raw_payload"),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("twilio_status_updates_message_sid_idx").on(table.messageSid),
    index("twilio_status_updates_status_idx").on(table.messageStatus),
  ]
);
