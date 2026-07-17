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
// The platform Twilio credential is resolved from key-service (no env creds).
process.env.KEY_SERVICE_URL =
  process.env.KEY_SERVICE_URL || "http://localhost:3005";
process.env.KEY_SERVICE_API_KEY =
  process.env.KEY_SERVICE_API_KEY || "test-key-service-key";
process.env.TWILIO_SERVICE_PUBLIC_URL =
  process.env.TWILIO_SERVICE_PUBLIC_URL || "https://twilio.test";
process.env.TWILIO_MCPFACTORY_PHONE_NUMBER =
  process.env.TWILIO_MCPFACTORY_PHONE_NUMBER || "+15551234567";

beforeAll(() => {
  console.log("Test suite starting...");
});

afterAll(() => {
  console.log("Test suite complete.");
});
