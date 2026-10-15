import { z } from "zod";
import {
  OpenAPIRegistry,
  extendZodWithOpenApi,
} from "@asteasolutions/zod-to-openapi";

extendZodWithOpenApi(z);

export const registry = new OpenAPIRegistry();

// --- Security scheme ---
registry.registerComponent("securitySchemes", "apiKey", {
  type: "apiKey",
  in: "header",
  name: "X-API-Key",
  description: "Service-to-service API key",
});

// ===== Send SMS =====

export const SendSmsRequestSchema = z
  .object({
    parentRunId: z.string().openapi({ description: "Parent run ID" }),
    brandId: z.string().optional().openapi({ description: "Brand ID" }),
    campaignId: z
      .string()
      .optional()
      .openapi({ description: "Campaign ID" }),
    from: z
      .string()
      .optional()
      .openapi({
        description:
          "Sender phone number (E.164 format). Defaults to project phone number.",
      }),
    to: z
      .string()
      .openapi({ description: "Recipient phone number (E.164 format)" }),
    body: z.string().openapi({ description: "SMS message body" }),
    statusCallback: z
      .string()
      .optional()
      .openapi({
        description: "URL for Twilio status callbacks",
      }),
    project: z
      .enum(["mcpfactory", "pressbeat"])
      .optional()
      .openapi({
        description: "Which Twilio project/phone number to use",
      }),
  })
  .openapi("SendSmsRequest");

export type SendSmsRequest = z.infer<typeof SendSmsRequestSchema>;

export const SendSmsResponseSchema = z
  .object({
    success: z.boolean(),
    messageSid: z
      .string()
      .optional()
      .openapi({ description: "Twilio message SID" }),
    status: z
      .string()
      .optional()
      .openapi({ description: "Message status (queued, sent, etc.)" }),
    numSegments: z
      .string()
      .optional()
      .openapi({ description: "Number of SMS segments" }),
    recordId: z
      .string()
      .optional()
      .openapi({ description: "Database record ID" }),
  })
  .openapi("SendSmsResponse");

export type SendSmsResponse = z.infer<typeof SendSmsResponseSchema>;

// ===== Batch Send =====

export const BatchSendSmsRequestSchema = z
  .object({
    messages: z.array(SendSmsRequestSchema).openapi({
      description: "Array of SMS messages to send",
    }),
  })
  .openapi("BatchSendSmsRequest");

export type BatchSendSmsRequest = z.infer<typeof BatchSendSmsRequestSchema>;

export const BatchSendSmsResponseSchema = z
  .object({
    results: z.array(SendSmsResponseSchema),
    totalSent: z.number(),
    totalFailed: z.number(),
  })
  .openapi("BatchSendSmsResponse");

export type BatchSendSmsResponse = z.infer<typeof BatchSendSmsResponseSchema>;

// ===== Status =====

export const SmsStatusResponseSchema = z
  .object({
    sending: z
      .object({
        id: z.string(),
        messageSid: z.string(),
        orgId: z.string().nullable(),
        userId: z.string().nullable(),
        runId: z.string().nullable(),
        brandId: z.string().nullable(),
        campaignId: z.string().nullable(),
        from: z.string(),
        to: z.string(),
        body: z.string(),
        status: z.string(),
        numSegments: z.number().nullable(),
        errorCode: z.number().nullable(),
        errorMessage: z.string().nullable(),
        sentAt: z.string(),
        createdAt: z.string(),
      })
      .openapi("SmsSending"),
    statusUpdates: z
      .array(
        z
          .object({
            id: z.string(),
            messageStatus: z.string(),
            errorCode: z.number().nullable(),
            errorMessage: z.string().nullable(),
            receivedAt: z.string(),
          })
          .openapi("SmsStatusUpdate")
      )
      .openapi({ description: "Status callback events" }),
  })
  .openapi("SmsStatusResponse");

export type SmsStatusResponse = z.infer<typeof SmsStatusResponseSchema>;

// ===== Stats =====

export const StatsRequestSchema = z
  .object({
    runIds: z.array(z.string()).optional(),
    orgId: z.string().optional(),
    brandId: z.string().optional(),
    campaignId: z.string().optional(),
  })
  .openapi("StatsRequest");

export type StatsRequest = z.infer<typeof StatsRequestSchema>;

export const StatsResponseSchema = z
  .object({
    totalSent: z.number(),
    totalDelivered: z.number(),
    totalFailed: z.number(),
    totalUndelivered: z.number(),
  })
  .openapi("StatsResponse");

export type StatsResponse = z.infer<typeof StatsResponseSchema>;

// ===== Error =====

export const ErrorResponseSchema = z
  .object({
    error: z.string(),
    message: z.string().optional(),
  })
  .openapi("ErrorResponse");

// ===== Webhook =====

export const TwilioWebhookPayloadSchema = z
  .object({
    MessageSid: z.string(),
    MessageStatus: z.string(),
    ErrorCode: z.string().optional(),
    ErrorMessage: z.string().optional(),
    From: z.string().optional(),
    To: z.string().optional(),
  })
  .openapi("TwilioWebhookPayload");

export type TwilioWebhookPayload = z.infer<typeof TwilioWebhookPayloadSchema>;

// ===== WhatsApp =====

export const SendWhatsAppRequestSchema = z
  .object({
    to: z
      .string()
      .openapi({
        description:
          "Recipient phone number (E.164, with or without the 'whatsapp:' prefix)",
      }),
    body: z.string().openapi({ description: "WhatsApp message body" }),
    parentRunId: z
      .string()
      .optional()
      .openapi({ description: "Parent run ID for cost/run linkage" }),
    brandId: z.string().optional().openapi({ description: "Brand ID" }),
    campaignId: z.string().optional().openapi({ description: "Campaign ID" }),
    statusCallback: z
      .string()
      .optional()
      .openapi({ description: "URL for Twilio status callbacks" }),
  })
  .openapi("SendWhatsAppRequest");

export type SendWhatsAppRequest = z.infer<typeof SendWhatsAppRequestSchema>;

export const SendWhatsAppResponseSchema = z
  .object({
    success: z.boolean(),
    messageSid: z.string().optional(),
    status: z.string().optional(),
    numSegments: z.string().optional(),
    recordId: z.string().optional(),
  })
  .openapi("SendWhatsAppResponse");

export type SendWhatsAppResponse = z.infer<typeof SendWhatsAppResponseSchema>;

export const TwilioWhatsAppInboundSchema = z
  .object({
    From: z
      .string()
      .openapi({ description: "Sender WhatsApp address, e.g. whatsapp:+14155551234" }),
    To: z.string().optional(),
    Body: z.string().optional(),
    MessageSid: z.string().optional(),
    WaId: z.string().optional().openapi({ description: "Sender WhatsApp id (digits)" }),
    ProfileName: z.string().optional(),
  })
  .openapi("TwilioWhatsAppInbound");

export type TwilioWhatsAppInbound = z.infer<typeof TwilioWhatsAppInboundSchema>;

// ===== Voice calls =====

export const CallReplySchema = z
  .object({
    name: z
      .string()
      .min(1)
      .openapi({ description: "Who replied to the campaign" }),
    company: z
      .string()
      .optional()
      .openapi({ description: "The replier's company, when known" }),
    message: z
      .string()
      .min(1)
      .optional()
      .openapi({
        description:
          "What the replier actually wrote. Required for a reply; omit it on a form fill, where occasion.answers say it",
      }),
    firstName: z
      .string()
      .optional()
      .openapi({ description: "The replier's first name, spoken in the identity line" }),
    lastName: z
      .string()
      .optional()
      .openapi({ description: "The replier's last name, spoken in the identity line" }),
    title: z
      .string()
      .optional()
      .openapi({ description: "The replier's job title" }),
    city: z.string().optional().openapi({ description: "The replier's city" }),
    state: z.string().optional().openapi({ description: "The replier's state or region" }),
    country: z.string().optional().openapi({ description: "The replier's country" }),
  })
  .openapi("CallReply");

export const PriorMessageSchema = z
  .object({
    direction: z
      .enum(["outbound", "inbound"])
      .openapi({ description: "Who sent it: outbound is us, inbound is the prospect" }),
    text: z.string().openapi({ description: "The message body, already stripped by the caller" }),
  })
  .openapi("PriorMessage");

export const FormAnswerSchema = z
  .object({
    question: z
      .string()
      .min(1)
      .openapi({ description: "The form question, as the form labels it" }),
    answer: z
      .string()
      .min(1)
      .openapi({ description: "What the person answered" }),
  })
  .openapi("FormAnswer");

export const CallOccasionSchema = z
  .discriminatedUnion("type", [
    z
      .object({ type: z.literal("reply") })
      .openapi({ description: "The person replied to a campaign (the default)" }),
    z
      .object({
        type: z.literal("form"),
        formName: z
          .string()
          .min(1)
          .openapi({ description: "The form's name, spoken in the opener, e.g. \"Doc Dinners - Meta lead form\"" }),
        answers: z
          .array(FormAnswerSchema)
          .min(1)
          .openapi({ description: "Question and answer pairs, in form order; read aloud after the accept keypress" }),
      })
      .openapi({ description: "The person submitted a form. There is no email thread, so priorMessages is refused" }),
  ])
  .openapi("CallOccasion", {
    description:
      "What the person did that rings the phone. Omit it for a reply to a campaign: the call then says exactly what it always said",
  });

export const PlaceCallRequestSchema = z
  .object({
    to: z
      .string()
      .openapi({ description: "Number to ring (E.164), e.g. the sales rep" }),
    reply: CallReplySchema.openapi({
      description: "The person the call is about and, for a reply, what they wrote; spoken after the accept keypress",
    }),
    occasion: CallOccasionSchema.optional(),
    brandName: z
      .string()
      .optional()
      .openapi({ description: "Brand whose campaign was replied to, spoken in the opener" }),
    connectTo: z
      .string()
      .optional()
      .openapi({
        description:
          "Number to bridge to on a second keypress (E.164). Omit it and the call says the connect option is unavailable.",
      }),
    priorMessages: z
      .array(PriorMessageSchema)
      .optional()
      .openapi({
        description:
          "The thread the reply belongs to, NEWEST-FIRST and excluding the reply itself: entry 0 is the email the reply answers. Offered one step at a time behind the second keypress.",
      }),
    connectName: z
      .string()
      .optional()
      .openapi({ description: "Who the connect keypress reaches, when not the replier" }),
    parentRunId: z
      .string()
      .optional()
      .openapi({ description: "Parent run ID for cost/run linkage" }),
    brandId: z.string().optional().openapi({ description: "Brand ID" }),
    campaignId: z.string().optional().openapi({ description: "Campaign ID" }),
    idempotencyKey: z
      .string()
      .min(1)
      .max(500)
      .optional()
      .openapi({
        description:
          "One call per key per org, durably. A second POST with the same key places no call and answers the first call's record (replayed: true). A key whose call Twilio refused is released, since nobody was rung.",
      }),
  })
  .superRefine((body, ctx) => {
    if (body.occasion?.type === "form") {
      if (body.priorMessages && body.priorMessages.length > 0) {
        ctx.addIssue({
          code: "custom",
          path: ["priorMessages"],
          message: "A form fill has no email thread: send no priorMessages",
        });
      }
      return;
    }
    if (!body.reply.message) {
      ctx.addIssue({
        code: "custom",
        path: ["reply", "message"],
        message: "reply.message is required unless occasion.type is \"form\"",
      });
    }
  })
  .openapi("PlaceCallRequest");

export type PlaceCallRequest = z.infer<typeof PlaceCallRequestSchema>;

export const PlaceCallResponseSchema = z
  .object({
    success: z.boolean(),
    callId: z.string().openapi({ description: "This service's call record id" }),
    callSid: z.string().optional().openapi({ description: "Twilio call SID" }),
    status: z.string().optional().openapi({ description: "Twilio call status" }),
    costName: z
      .string()
      .openapi({ description: "Catalogue cost name the call's minutes are declared under" }),
    connectOffered: z
      .boolean()
      .openapi({ description: "Whether a connect number was supplied" }),
    replayed: z
      .boolean()
      .optional()
      .openapi({ description: "True when an earlier request with the same idempotencyKey already placed this call; no new call was placed" }),
  })
  .openapi("PlaceCallResponse");

export type PlaceCallResponse = z.infer<typeof PlaceCallResponseSchema>;

export const CallRecordSchema = z
  .object({
    id: z.string(),
    callSid: z.string().nullable(),
    to: z.string(),
    from: z.string(),
    connectTo: z.string().nullable(),
    status: z.string().openapi({ description: "Twilio call status" }),
    accepted: z
      .boolean()
      .openapi({
        description:
          "True only once the accept keypress arrived. False means nobody took the call: no answer, no keypress, or a machine picked up.",
      }),
    connected: z
      .boolean()
      .openapi({ description: "True once the second keypress bridged the two parties" }),
    durationSeconds: z.number().nullable(),
    billedMinutes: z.number().nullable(),
    connectDurationSeconds: z.number().nullable(),
    connectBilledMinutes: z.number().nullable(),
    costName: z.string(),
    connectCostName: z.string().nullable(),
    errorCode: z.number().nullable(),
    errorMessage: z.string().nullable(),
  })
  .openapi("CallRecord");

export const GetCallResponseSchema = z
  .object({ call: CallRecordSchema })
  .openapi("GetCallResponse");

// --- Per-campaign call stats ---

export const MAX_CALL_STATS_CAMPAIGNS = 200;

export const CampaignCallStatsQuerySchema = z.object({
  campaignIds: z
    .string()
    .min(1)
    .openapi({
      description: `Comma-separated campaign ids (1 to ${MAX_CALL_STATS_CAMPAIGNS}). Only calls of the caller's org (x-org-id) are counted.`,
      example: "29c5606a-4b86-49f9-8ca8-ed7ddcf894f4",
    }),
});

export const CallOutcomesSchema = z
  .object({
    connected: z.number().int().openapi({ description: "Rep accepted and the bridge to the prospect happened" }),
    acceptedNotConnected: z.number().int().openapi({ description: "Rep pressed 1 to take the call but no bridge happened (no connect number, no second keypress, or the bridged leg did not pick up)" }),
    answeredNotAccepted: z.number().int().openapi({ description: "The call completed without the accept keypress: picked up but nobody pressed 1, or a voicemail/machine answered" }),
    noAnswer: z.number().int().openapi({ description: "Rang out unanswered (Twilio status no-answer)" }),
    busy: z.number().int().openapi({ description: "Line busy (Twilio status busy)" }),
    failed: z.number().int().openapi({ description: "Twilio refused or failed the call, including a call it rejected at creation (never placed)" }),
    canceled: z.number().int().openapi({ description: "Canceled before it was answered" }),
    inProgress: z.number().int().openapi({ description: "Not finished yet (queued, ringing, in progress)" }),
  })
  .openapi("CallOutcomes", {
    description:
      "Each call row lands in exactly ONE bucket, so the buckets add up to `requested`. The keypress facts (connected, accepted) decide first, then the Twilio status.",
  });

export const CallCountsSchema = z
  .object({
    requested: z.number().int().openapi({ description: "Call rows recorded: every POST /calls that got past validation, whether or not Twilio accepted it" }),
    placed: z.number().int().openapi({ description: "Calls Twilio accepted and dialled (a Twilio call SID was issued). <= requested" }),
    accepted: z.number().int().openapi({ description: "Calls the rep took by pressing 1 (the accept keypress). <= placed" }),
    connected: z.number().int().openapi({ description: "Calls bridged to the prospect after the rep's second keypress (a booking call obtained). <= accepted" }),
    outcomes: CallOutcomesSchema,
    billedMinutes: z.number().int().openapi({ description: "Minutes billed on the placed leg (to the rep), a started minute counts in full. 0 while not yet reported" }),
    connectBilledMinutes: z.number().int().openapi({ description: "Minutes billed on the bridged leg (to the prospect)" }),
    totalBilledMinutes: z.number().int().openapi({ description: "billedMinutes + connectBilledMinutes" }),
  })
  .openapi("CallCounts");

export const DailyCallCountsSchema = CallCountsSchema.extend({
  day: z.string().openapi({ description: "UTC day the call was requested (row created), YYYY-MM-DD", example: "2026-10-07" }),
}).openapi("DailyCallCounts");

export const CampaignCallStatsSchema = z
  .object({
    campaignId: z.string(),
    totals: CallCountsSchema.openapi({ description: "Since inception" }),
    daily: z.array(DailyCallCountsSchema).openapi({ description: "One entry per UTC day with at least one call, ascending. Sums to `totals`. Empty when the campaign has no calls" }),
  })
  .openapi("CampaignCallStats");

export const CampaignCallStatsResponseSchema = z
  .object({
    campaigns: z.array(CampaignCallStatsSchema).openapi({ description: "One entry per distinct requested campaign id, in request order. A campaign with no calls answers zeros" }),
    totals: CallCountsSchema.openapi({ description: "Sum over every requested campaign" }),
  })
  .openapi("CampaignCallStatsResponse");

export const TwilioVoiceWebhookSchema = z
  .object({
    CallSid: z.string().optional(),
    CallStatus: z.string().optional(),
    CallDuration: z.string().optional(),
    DialCallStatus: z.string().optional(),
    DialCallDuration: z.string().optional(),
    Digits: z.string().optional().openapi({ description: "The key pressed" }),
    AnsweredBy: z.string().optional(),
  })
  .openapi("TwilioVoiceWebhook");

// ================================================================
// Register all API paths
// ================================================================

// --- Health ---

registry.registerPath({
  method: "get",
  path: "/",
  summary: "Root endpoint",
  tags: ["Health"],
  responses: {
    200: {
      description: "Service name",
      content: { "text/plain": { schema: z.string() } },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/health",
  summary: "Health check",
  tags: ["Health"],
  responses: {
    200: {
      description: "Service is healthy",
      content: {
        "application/json": {
          schema: z
            .object({
              status: z.string(),
              service: z.string(),
            })
            .openapi("HealthResponse"),
        },
      },
    },
  },
});

// --- Send SMS ---

registry.registerPath({
  method: "post",
  path: "/send",
  summary: "Send a single SMS",
  description:
    "Send an SMS via Twilio and record it in the database. Runs-service integration is BLOCKING.",
  tags: ["SMS Sending"],
  security: [{ apiKey: [] }],
  request: {
    body: {
      content: { "application/json": { schema: SendSmsRequestSchema } },
    },
  },
  responses: {
    200: {
      description: "SMS sent successfully",
      content: { "application/json": { schema: SendSmsResponseSchema } },
    },
    400: {
      description: "Invalid request",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    500: {
      description: "Server error",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/send/batch",
  summary: "Send multiple SMS messages",
  description: "Send a batch of SMS messages. Each message is processed independently.",
  tags: ["SMS Sending"],
  security: [{ apiKey: [] }],
  request: {
    body: {
      content: {
        "application/json": { schema: BatchSendSmsRequestSchema },
      },
    },
  },
  responses: {
    200: {
      description: "Batch results",
      content: {
        "application/json": { schema: BatchSendSmsResponseSchema },
      },
    },
    400: {
      description: "Invalid request",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    500: {
      description: "Server error",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

// --- Status ---

registry.registerPath({
  method: "get",
  path: "/status/{messageSid}",
  summary: "Get SMS status by message SID",
  description: "Get full status including all status callback events for an SMS.",
  tags: ["SMS Status"],
  security: [{ apiKey: [] }],
  request: {
    params: z.object({
      messageSid: z.string().openapi({ description: "Twilio message SID" }),
    }),
  },
  responses: {
    200: {
      description: "SMS status",
      content: { "application/json": { schema: SmsStatusResponseSchema } },
    },
    404: {
      description: "Message not found",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/status/by-org/{orgId}",
  summary: "List SMS sendings by organization",
  tags: ["SMS Status"],
  security: [{ apiKey: [] }],
  request: {
    params: z.object({
      orgId: z.string().openapi({ description: "Clerk organization ID" }),
    }),
  },
  responses: {
    200: {
      description: "List of SMS sendings",
      content: {
        "application/json": {
          schema: z.object({ sendings: z.array(z.any()) }),
        },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/status/by-run/{runId}",
  summary: "List SMS sendings by run ID",
  tags: ["SMS Status"],
  security: [{ apiKey: [] }],
  request: {
    params: z.object({
      runId: z.string().openapi({ description: "Run ID" }),
    }),
  },
  responses: {
    200: {
      description: "List of SMS sendings",
      content: {
        "application/json": {
          schema: z.object({ sendings: z.array(z.any()) }),
        },
      },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/stats",
  summary: "Get aggregated SMS stats",
  description:
    "Get aggregated statistics with filters (runIds, orgId, brandId, campaignId).",
  tags: ["SMS Status"],
  security: [{ apiKey: [] }],
  request: {
    body: {
      content: { "application/json": { schema: StatsRequestSchema } },
    },
  },
  responses: {
    200: {
      description: "Aggregated stats",
      content: { "application/json": { schema: StatsResponseSchema } },
    },
  },
});

// --- WhatsApp ---

registry.registerPath({
  method: "post",
  path: "/send/whatsapp",
  summary: "Send a WhatsApp message",
  description:
    "Send a WhatsApp message via Twilio and record it. Tracks a run. Used to push agent replies (or any message) to a WhatsApp user.",
  tags: ["WhatsApp"],
  security: [{ apiKey: [] }],
  request: {
    body: {
      content: { "application/json": { schema: SendWhatsAppRequestSchema } },
    },
  },
  responses: {
    200: {
      description: "WhatsApp message sent",
      content: {
        "application/json": { schema: SendWhatsAppResponseSchema },
      },
    },
    400: {
      description: "Invalid request",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    500: {
      description: "Server error",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/webhooks/twilio/whatsapp",
  summary: "Inbound WhatsApp webhook",
  description:
    "Receives inbound WhatsApp messages from Twilio. Resolves the sender to a platform account (provisioning via client-service if unknown), forwards to the chat-service agent (the same brain the dashboard uses), and replies over WhatsApp. Twilio-signed (no X-API-Key).",
  tags: ["WhatsApp"],
  request: {
    body: {
      content: {
        "application/x-www-form-urlencoded": {
          schema: TwilioWhatsAppInboundSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Acknowledged (empty TwiML)",
      content: { "text/xml": { schema: z.string() } },
    },
  },
});

// --- Webhooks ---

registry.registerPath({
  method: "post",
  path: "/webhooks/twilio/status",
  summary: "Twilio status callback webhook",
  description:
    "Receives status callbacks from Twilio for message delivery events.",
  tags: ["Webhooks"],
  request: {
    body: {
      content: {
        "application/x-www-form-urlencoded": {
          schema: TwilioWebhookPayloadSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Webhook processed",
      content: { "text/xml": { schema: z.string() } },
    },
  },
});

// --- Voice calls ---

registry.registerPath({
  method: "post",
  path: "/calls",
  summary: "Place an outbound call",
  description:
    "Ring a number and read a short spoken summary of why. The person who picks up must press 1 to take the call before any detail is spoken, so a voicemail never counts as taken. Once taken they hear who replied, which company, and what they wrote, and — only when connectTo was supplied — are offered a second keypress that bridges them to that person. When connectTo is absent the call says so in words. Refuses a destination that has no published voice cost band.",
  tags: ["Voice"],
  security: [{ apiKey: [] }],
  request: {
    body: {
      content: { "application/json": { schema: PlaceCallRequestSchema } },
    },
  },
  responses: {
    200: {
      description: "Call placed",
      content: { "application/json": { schema: PlaceCallResponseSchema } },
    },
    400: {
      description: "Invalid request, or a destination with no published cost band",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    502: {
      description: "Twilio rejected the call",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    500: {
      description: "Server error",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/calls/{id}",
  summary: "Read a call",
  description:
    "Read a call by record id or Twilio call SID. `accepted` distinguishes a call somebody took from one nobody answered, nobody accepted, or a machine picked up; `connected` says whether the bridge happened.",
  tags: ["Voice"],
  security: [{ apiKey: [] }],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      description: "Call record",
      content: { "application/json": { schema: GetCallResponseSchema } },
    },
    404: {
      description: "Call not found",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/calls/stats/by-campaign",
  summary: "Call counts per campaign, since inception and per UTC day",
  description:
    "For one or several campaigns of the caller's org (x-org-id), what the AI instant call did: calls requested, placed (Twilio dialled), accepted (rep pressed 1), connected (bridged to the prospect), the outcome of each call, and billed minutes, since inception and per UTC day. Each call row is counted once. Unknown campaigns and campaigns with no calls answer zeros, never 404. No phone numbers or message contents.",
  tags: ["Voice"],
  security: [{ apiKey: [] }],
  request: { query: CampaignCallStatsQuerySchema },
  responses: {
    200: {
      description: "Per-campaign call counts",
      content: { "application/json": { schema: CampaignCallStatsResponseSchema } },
    },
    400: {
      description: "campaignIds missing, empty, or more than 200",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

for (const [path, summary] of [
  ["/webhooks/twilio/voice/answer", "Voice answer webhook (announces the call, asks for the accept keypress)"],
  ["/webhooks/twilio/voice/accept", "Voice accept keypress webhook (plays the detail, offers the connect keypress)"],
  ["/webhooks/twilio/voice/connect", "Voice connect keypress webhook (bridges to the supplied number)"],
  ["/webhooks/twilio/voice/dial-status", "Bridged-leg status webhook (declares the bridged leg's minutes)"],
  ["/webhooks/twilio/voice/status", "Voice call status webhook (records the outcome, declares the placed leg's minutes)"],
] as const) {
  registry.registerPath({
    method: "post",
    path,
    summary,
    description: "Twilio-signed (no X-API-Key). Returns TwiML.",
    tags: ["Voice"],
    request: {
      query: z.object({ ref: z.string().openapi({ description: "Call record id" }) }),
      body: {
        content: {
          "application/x-www-form-urlencoded": { schema: TwilioVoiceWebhookSchema },
        },
      },
    },
    responses: {
      200: {
        description: "TwiML response",
        content: { "text/xml": { schema: z.string() } },
      },
    },
  });
}
