import "dotenv/config";
import express from "express";
import { NextFunction, Request, Response } from "express";
import { stellarService } from "./lib/stellar.js";
import { createMeterRouter } from "./routes/meters.js";
import { paymentsRouter } from "./routes/payments.js";
import { webhookRouter } from "./routes/webhooks.js";
import { startIoTBridge } from "./iot/bridge.js";
import { logger } from "./lib/logger.js";
import {
  initUsageEventStore,
  startUsageEventRetryWorker,
} from "./lib/usageEvents.js";

// Environment variable validation
const REQUIRED_ENV = [
  'ADMIN_SECRET_KEY',
  'CONTRACT_ID',
  'STELLAR_RPC_URL',
  'MQTT_BROKER',
];

const missing = REQUIRED_ENV.filter(k => !process.env[k]);
if (missing.length > 0) {
  console.error('Missing required environment variables:', missing.join(', '));
  console.error('Copy backend/.env.example to backend/.env and fill in the values.');
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT ?? 3001;

// Capture raw body for webhook signature verification before JSON parsing
app.use(
  express.json({
    verify: (req: any, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);
app.use((_, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  next();
});

app.use((req, _res, next) => {
  logger.info({ method: req.method, path: req.path });
  next();
});

app.use("/api/meters", createMeterRouter(stellarService));
app.use("/api/payments", paymentsRouter);
app.use("/api/webhooks", webhookRouter);

app.get("/health", (_, res) => res.json({ status: "ok" }));

app.get("/metrics", async (_req, res) => {
  res.set("Content-Type", register.contentType);
  res.end(await register.metrics());
});

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error("Request error", { error: err.message });

  const parseError = err as Error & {
    type?: string;
    status?: number;
    body?: unknown;
  };
  if (
    parseError.type === "entity.parse.failed" ||
    (err instanceof SyntaxError && typeof parseError.body !== "undefined") ||
    parseError.status === 400
  ) {
    return res.status(400).json({ error: "Invalid JSON request body" });
  }

  return res
    .status(500)
    .json({ error: err.message || "Internal server error" });
});

app.listen(PORT, () => {
  initUsageEventStore();
  startUsageEventRetryWorker();
  logger.info("SolarGrid backend listening", { port: PORT });
  startIoTBridge();
});
