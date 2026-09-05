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

// ═══════════════════════════════════════════════════════════════════════════════
// Voice Calls — outbound phone calls placed via Twilio
//
// One row per call requested through POST /calls. The call is a two-keypress
// flow: the person rung must press 1 to TAKE the call (nothing but the
// announcement plays before that, so a voicemail never counts as taken), and,
// when the caller supplied a number to connect to, presses 1 a second time to be
// bridged to that person. `accepted` and `connected` are what let a caller tell
// a taken call from an unanswered one.
//
// Twilio bills voice per minute on BOTH legs, so the parent leg and the bridged
// leg carry their own destination-resolved cost name and their own declared
// minutes.
// ═══════════════════════════════════════════════════════════════════════════════

export const twilioCalls = pgTable(
  "twilio_calls",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    // Set once Twilio accepts the call. Null while the create is in flight, and
    // stays null when Twilio rejects it.
    callSid: text("call_sid").unique(),
    orgId: text("org_id").notNull(),
    userId: text("user_id").notNull(),
    // The run this service created for the call (costs hang off it).
    runId: text("run_id"),
    parentRunId: text("parent_run_id"),
    brandId: text("brand_id"),
    campaignId: text("campaign_id"),
    from: text("from").notNull(),
    to: text("to").notNull(),
    // The number to bridge to on the second keypress. Null means the connect
    // step is not offered, and the call says so in words.
    connectTo: text("connect_to"),
    connectName: text("connect_name"),
    brandName: text("brand_name"),
    replyName: text("reply_name").notNull(),
    replyCompany: text("reply_company"),
    replyMessage: text("reply_message").notNull(),
    // The assembled spoken script, frozen at request time so the webhook legs
    // read exactly what the caller asked for.
    summary: text("summary").notNull(),
    detail: text("detail").notNull(),
    // Catalogue cost names resolved from each destination at request time.
    costName: text("cost_name").notNull(),
    connectCostName: text("connect_cost_name"),
    status: text("status").notNull().default("queued"),
    accepted: boolean("accepted").notNull().default(false),
    connected: boolean("connected").notNull().default(false),
    durationSeconds: integer("duration_seconds"),
    billedMinutes: integer("billed_minutes"),
    connectDurationSeconds: integer("connect_duration_seconds"),
    connectBilledMinutes: integer("connect_billed_minutes"),
    // Guards against a retried Twilio callback declaring the same minutes twice.
    costDeclared: boolean("cost_declared").notNull().default(false),
    connectCostDeclared: boolean("connect_cost_declared")
      .notNull()
      .default(false),
    errorCode: integer("error_code"),
    errorMessage: text("error_message"),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    connectedAt: timestamp("connected_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("twilio_calls_call_sid_idx").on(table.callSid),
    index("twilio_calls_org_id_idx").on(table.orgId),
    index("twilio_calls_run_id_idx").on(table.runId),
    index("twilio_calls_brand_id_idx").on(table.brandId),
    index("twilio_calls_campaign_id_idx").on(table.campaignId),
    index("twilio_calls_status_idx").on(table.status),
  ]
);
