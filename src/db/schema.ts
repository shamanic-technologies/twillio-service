import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  boolean,
  index,
} from "drizzle-orm/pg-core";

// ═══════════════════════════════════════════════════════════════════════════════
// SMS / WhatsApp Sendings — main record for each outbound message sent via Twilio
// ═══════════════════════════════════════════════════════════════════════════════

export const twilioSendings = pgTable(
  "twilio_sendings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    messageSid: text("message_sid").notNull().unique(),
    // "sms" (default) or "whatsapp" — which Twilio channel carried the message.
    channel: text("channel").notNull().default("sms"),
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
    index("twilio_sendings_channel_idx").on(table.channel),
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

// ═══════════════════════════════════════════════════════════════════════════════
// WhatsApp Users — phone-number ↔ platform-account mapping
//
// The WhatsApp adapter resolves an inbound sender's phone number to a platform
// account (orgId/userId). The first time an unknown number messages in, the
// account is provisioned via client-service and the resulting mapping is cached
// here so every future message resolves instantly (no re-provision).
// ═══════════════════════════════════════════════════════════════════════════════

export const whatsappUsers = pgTable(
  "whatsapp_users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    // Sender phone in E.164 (no "whatsapp:" prefix), e.g. "+14155551234".
    phone: text("phone").notNull().unique(),
    // Twilio's WhatsApp id (WaId) for the sender — digits only, when provided.
    waId: text("wa_id"),
    // WhatsApp profile display name, when provided by Twilio.
    profileName: text("profile_name"),
    orgId: text("org_id").notNull(),
    userId: text("user_id").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("whatsapp_users_phone_idx").on(table.phone),
    index("whatsapp_users_org_id_idx").on(table.orgId),
    index("whatsapp_users_user_id_idx").on(table.userId),
  ]
);

// ═══════════════════════════════════════════════════════════════════════════════
// WhatsApp Sessions — phone ↔ chat-service conversation session
//
// Keeps conversation continuity: the sessionId returned by chat-service's
// agentic chat (POST /chat) is stored per phone so follow-up messages resume
// the same conversation instead of starting fresh.
// ═══════════════════════════════════════════════════════════════════════════════

export const whatsappSessions = pgTable(
  "whatsapp_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    phone: text("phone").notNull().unique(),
    sessionId: text("session_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("whatsapp_sessions_phone_idx").on(table.phone)]
);
