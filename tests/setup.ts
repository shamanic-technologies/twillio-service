import * as dotenv from "dotenv";
import { beforeAll, afterAll } from "vitest";

// Load test environment variables
dotenv.config({ path: ".env.test" });

// Fallback to regular .env if .env.test doesn't exist
if (!process.env.TWILIO_SERVICE_DATABASE_URL) {
  dotenv.config();
}

// Set test-specific defaults (DB URL allows module to load; PG won't connect until queried)
process.env.TWILIO_SERVICE_DATABASE_URL =
  process.env.TWILIO_SERVICE_DATABASE_URL ||
  "postgresql://test:test@localhost:5432/twilio_test?sslmode=disable";
process.env.TWILIO_SERVICE_API_KEY =
  process.env.TWILIO_SERVICE_API_KEY || "test-secret-key";
process.env.TWILIO_ACCOUNT_SID =
  process.env.TWILIO_ACCOUNT_SID || "ACtest1234567890";
process.env.TWILIO_AUTH_TOKEN =
  process.env.TWILIO_AUTH_TOKEN || "test-auth-token";
process.env.TWILIO_MCPFACTORY_PHONE_NUMBER =
  process.env.TWILIO_MCPFACTORY_PHONE_NUMBER || "+15551234567";

beforeAll(() => {
  console.log("Test suite starting...");
});

afterAll(() => {
  console.log("Test suite complete.");
});
