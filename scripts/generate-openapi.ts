import { OpenApiGeneratorV3 } from "@asteasolutions/zod-to-openapi";
import { registry } from "../src/schemas";
import * as fs from "fs";

const generator = new OpenApiGeneratorV3(registry.definitions);

const document = generator.generateDocument({
  openapi: "3.0.0",
  info: {
    title: "Twilio Service API",
    description:
      "SMS sending and tracking service built on Twilio. Handles SMS delivery, webhook processing for status callbacks, and integrates with a runs-service for cost tracking.",
    version: "1.0.0",
  },
  servers: [
    { url: "https://twilio.mcpfactory.org", description: "Production" },
    { url: "http://localhost:3011", description: "Local development" },
  ],
  tags: [
    { name: "Health", description: "Health check endpoints" },
    { name: "SMS Sending", description: "Send SMS via Twilio" },
    { name: "SMS Status", description: "Query SMS delivery status" },
    { name: "Webhooks", description: "Twilio webhook handlers" },
  ],
});

fs.writeFileSync("openapi.json", JSON.stringify(document, null, 2));
console.log("Generated openapi.json");
