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
import { startIoTBridge } from "./iot/bridge.js";
import { logger } from "./lib/logger.js";
import requestLogger from "./middleware/requestLogger.js";
import { register } from "./lib/metrics.js";
import {
  initUsageEventStore,
  startUsageEventRetryWorker,
} from "./lib/usageEvents.js";

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

// Rate limiting configuration (driven by env vars)
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60 * 1000);
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX ?? 60);
const PAYMENTS_RATE_LIMIT_MAX = Number(process.env.PAYMENTS_RATE_LIMIT_MAX ?? 10);
const RATE_LIMIT_MESSAGE = process.env.RATE_LIMIT_MESSAGE ?? 'Too many requests, please try again later.';

const globalLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    // Provide Retry-After in seconds
    res.setHeader('Retry-After', String(Math.ceil(RATE_LIMIT_WINDOW_MS / 1000)));
    res.status(429).json({ error: RATE_LIMIT_MESSAGE });
  },
});

const paymentsLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: PAYMENTS_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.setHeader('Retry-After', String(Math.ceil(RATE_LIMIT_WINDOW_MS / 1000)));
    res.status(429).json({ error: RATE_LIMIT_MESSAGE });
  },
});

// Apply global limiter to all /api routes
app.use('/api', globalLimiter);

app.use((req, _res, next) => {
  logger.info({ method: req.method, path: req.path });
  next();
});

app.use("/api/meters", createMeterRouter(stellarService));
app.use("/api/payments", paymentsLimiter, paymentsRouter);
app.use("/api/webhooks", webhookRouter);
app.use("/api/allowlist", allowlistRouter);

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

// Timeout error handler — must come before the generic error handler
app.use((err: any, req: any, res: any, next: any) => {
  if (req.timedout) {
    logger.error('Request timed out', {
      method: req.method,
      path: req.path,
      timeout: requestTimeout,
    });
    return res.status(504).json({ error: 'Request timed out' });
  }
  next(err);
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
  logger.info(
    { port: PORT, network: process.env.STELLAR_NETWORK ?? "testnet" },
    "SolarGrid backend started"
  );
  initUsageEventStore();
  startUsageEventRetryWorker();
  logger.info("SolarGrid backend listening", { port: PORT });
  startIoTBridge().catch(err => {
    logger.error("Failed to start IoT bridge", { err });
  });
});
