import "dotenv/config";
import express from "express";
import cors from "cors";
import timeout from "connect-timeout";
import { NextFunction, Request, Response } from "express";
import mqtt from "mqtt";
import { stellarService, server } from "./lib/stellar.js";
import { createMeterRouter } from "./routes/meters.js";
import { paymentsRouter } from "./routes/payments.js";
import { webhookRouter } from "./routes/webhooks.js";
import { allowlistRouter } from "./routes/allowlist.js";
import { collaboratorRouter } from "./routes/collaborators.js";
import { statsRouter } from "./routes/stats.js";
import { startIoTBridge } from "./iot/bridge.js";
import { logger } from "./lib/logger.js";
import requestLogger from "./middleware/requestLogger.js";
import { register } from "./lib/metrics.js";
import {
  initUsageEventStore,
  startUsageEventRetryWorker,
} from "./lib/usageEvents.js";
import { logger } from "./lib/logger.js";
import { register } from "./lib/metrics.js";

const REQUIRED_ENV = ["CONTRACT_ID", "ADMIN_SECRET_KEY", "STELLAR_RPC_URL", "MQTT_BROKER"];
const PORT = process.env.PORT ?? 3001;

const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missing.length > 0) {
  logger.fatal(
    { missing },
    "Missing required environment variables. Copy backend/.env.example to backend/.env."
  );
  process.exit(1);
}

const app = express();

app.use(
  cors({
    origin: process.env.FRONTEND_ORIGIN ?? "*",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Admin-Key"],
    optionsSuccessStatus: 204,
  })
);

// Capture raw body for webhook signature verification before JSON parsing
app.use(
  express.json({
    verify: (req: any, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(requestLogger);

// Request timeout — configurable via REQUEST_TIMEOUT env var (default 15s)
const requestTimeout = process.env.REQUEST_TIMEOUT ?? '15s';
app.use(timeout(requestTimeout));

// Halt middleware chain if request has already timed out
app.use((req: any, _res: any, next: any) => {
  if (!req.timedout) next();
});

app.use((req, _res, next) => {
  logger.info({ method: req.method, path: req.path });
  next();
});

app.use("/api/meters", createMeterRouter(stellarService));
app.use("/api/payments", paymentsRouter);
app.use("/api/webhooks", webhookRouter);
app.use("/api/allowlist", allowlistRouter);
app.use("/api/collaborators", collaboratorRouter);
app.use("/api/stats", statsRouter);

app.get('/health', async (_req, res) => {
  const checks: Record<string, string> = {};

  // Check Stellar RPC
  try {
    await server.getLatestLedger();
    checks.stellar = 'ok';
  } catch (err) {
    logger.error('Stellar health check failed', { err });
    checks.stellar = 'error';
  }

  // Check MQTT by attempting a short-lived connection
  const broker = process.env.MQTT_BROKER ?? 'mqtt://localhost:1883';
  try {
    const client = mqtt.connect(broker, { reconnectPeriod: 0, connectTimeout: 3000 });
    const ok = await new Promise<boolean>((resolve) => {
      const onConnect = () => {
        client.end(true);
        resolve(true);
      };
      const onError = () => {
        client.end(true);
        resolve(false);
      };
      const timer = setTimeout(() => {
        client.end(true);
        resolve(false);
      }, 3000);

      client.once('connect', () => { clearTimeout(timer); onConnect(); });
      client.once('error', () => { clearTimeout(timer); onError(); });
    });
    checks.mqtt = ok ? 'ok' : 'error';
  } catch (err) {
    logger.error('MQTT health check failed', { err });
    checks.mqtt = 'error';
  }

  const healthy = Object.values(checks).every((v) => v === 'ok');
  res.status(healthy ? 200 : 503).json({ status: healthy ? 'ok' : 'degraded', checks });
});

app.get("/metrics", async (_req, res) => {
  res.set("Content-Type", register.contentType);
  res.end(await register.metrics());
});

// 404 catch-all — must come after all routes
app.use((_req: Request, res: Response) =>
  res.status(404).json({ error: "Route not found", code: "NOT_FOUND" })
);

// Timeout error handler — must come before the generic error handler
app.use((err: any, req: any, res: any, next: any) => {
  if (req.timedout) {
    logger.error('Request timed out', {
      method: req.method,
      path: req.path,
      timeout: requestTimeout,
    });
    return res.status(504).json({ error: "Request timed out", code: "TIMEOUT" });
  }
  next(err);
});

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error({ error: err.message, stack: err.stack }, "Unhandled error");

  const e = err as any;
  if (e.type === "entity.parse.failed" || (err instanceof SyntaxError && e.body !== undefined)) {
    return res.status(400).json({ error: "Invalid JSON body", code: "INVALID_JSON" });
  }
  if (e.status === 404) {
    return res.status(404).json({ error: "Resource not found", code: "NOT_FOUND" });
  }
  if (e.code === "VALIDATION_ERROR" && e.details) {
    return res.status(400).json({ error: "Validation failed", code: "VALIDATION_ERROR", details: e.details });
  }
  res.status(500).json({ error: err.message || "Internal server error", code: "INTERNAL_ERROR" });
});

app.listen(PORT, () => {
  logger.info(
    { port: PORT, network: process.env.STELLAR_NETWORK ?? "testnet" },
    "SolarGrid backend started"
  );
  initUsageEventStore();
  startUsageEventRetryWorker();
  logger.info("SolarGrid backend listening", { port: PORT });
  try {
    startIoTBridge();
  } catch (err) {
    logger.error("Failed to start IoT bridge", { err });
  }
});
