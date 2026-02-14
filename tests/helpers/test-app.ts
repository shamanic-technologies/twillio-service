import express from "express";
import cors from "cors";
import { serviceAuth } from "../../src/middleware/serviceAuth";
import healthRoutes from "../../src/routes/health";
import sendRoutes from "../../src/routes/send";
import statusRoutes from "../../src/routes/status";
import webhooksRoutes from "../../src/routes/webhooks";

/**
 * Creates a test Express app without starting the server or running migrations.
 */
export function createTestApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use(serviceAuth);

  app.use("/", healthRoutes);
  app.use("/", sendRoutes);
  app.use("/", statusRoutes);
  app.use("/", webhooksRoutes);

  return app;
}
