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
    "Receives inbound WhatsApp messages from Twilio. Resolves the sender to a platform account (provisioning via client-service if unknown), forwards to the dashboard-chat agent, and replies over WhatsApp. Twilio-signed (no X-API-Key).",
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
