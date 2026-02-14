import { describe, it, expect } from "vitest";
import request from "supertest";
import { createTestApp } from "../helpers/test-app";

const app = createTestApp();

describe("Health endpoints", () => {
  describe("GET /", () => {
    it("should return service name", async () => {
      const res = await request(app).get("/");
      expect(res.status).toBe(200);
      expect(res.text).toBe("Twilio Service API");
    });
  });

  describe("GET /health", () => {
    it("should return health status", async () => {
      const res = await request(app).get("/health");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        status: "ok",
        service: "twilio-service",
      });
    });
  });
});
