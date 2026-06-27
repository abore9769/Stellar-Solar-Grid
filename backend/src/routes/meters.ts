import { Router } from "express";
import * as StellarSdk from "@stellar/stellar-sdk";
import { StellarService, stellarService } from "../lib/stellar.js";
import {
  getUsageHistory,
  persistAndSubmitUsageEvent,
} from "../lib/usageEvents.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { validateRequest, RegisterMeterSchema } from "../lib/validation.js";
import { adminAuth } from "../lib/adminAuth.js";
import { requireAdminKey } from "../middleware/adminAuth.js";
import { cacheFor, invalidateCache } from "../middleware/cache.js";

const balanceCache = new Map<string, { data: any; ts: number }>();
const BALANCE_CACHE_TTL_MS = 5_000; // 5-second cache to reduce RPC load

export function createMeterRouter(stellar: StellarService) {
  const meterRouter = Router();

  /**
   * GET /api/meters?page=1&pageSize=25 — list all meters with pagination
   *
   * Registered BEFORE /:id so the literal string "meters" is never matched
   * as a meter ID parameter.
   *
   * Fixes #268.
   */
  meterRouter.get(
    "/",
    asyncHandler(async (req, res) => {
      const page = Math.max(1, Number(req.query.page ?? 1) || 1);
      const pageSize = Math.min(
        100,
        Math.max(1, Number(req.query.pageSize ?? 25) || 25),
      );

      const result = await stellar.query("get_all_meters", []);
      const allMeters = (StellarSdk.scValToNative(result) as any[]) ?? [];

      const total = allMeters.length;
      const start = (page - 1) * pageSize;
      const meters = allMeters.slice(start, start + pageSize);

      res.json({
        meters,
        pagination: {
          page,
          pageSize,
          total,
          pages: Math.ceil(total / pageSize),
        },
      });
    }),
  );

  /** GET /api/meters/export?format=csv|json — download all meter data */
  meterRouter.get(
    "/export",
    asyncHandler(async (req, res) => {
      const format = req.query.format === "json" ? "json" : "csv";
      const result = await stellar.query("get_all_meters", []);
      const meters = (StellarSdk.scValToNative(result) as any[]) ?? [];

      if (format === "json") {
        res.setHeader("Content-Disposition", "attachment; filename=meters.json");
        return res.json(meters);
      }

      const header = "owner,active,units_used,plan,last_payment,expires_at,daily_limit";
      const rows = meters.map((m: any) =>
        [m.owner, m.active, m.units_used, m.plan, m.last_payment, m.expires_at, m.daily_limit].join(",")
      );
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", "attachment; filename=meters.csv");
      return res.send([header, ...rows].join("\n"));
    }),
  );

  /** GET /api/meters/:id/status — lightweight status poll */
  meterRouter.get(
    "/:id/status",
    asyncHandler(async (req, res) => {
      const { id } = req.params;
      try {
        const result = await stellar.query("get_meter", [
          StellarSdk.nativeToScVal(id, { type: "symbol" }),
        ]);
        const meter = StellarSdk.scValToNative(result) as any;
        if (!meter) return res.status(404).json({ error: "Meter not found", code: "METER_NOT_FOUND" });
        return res.json({
          meterId: id,
          active: meter.active,
          dailyLimit: meter.daily_limit,
          daySpent: meter.day_spent,
          expiresAt: meter.expires_at,
          plan: meter.plan,
        });
      } catch {
        return res.status(500).json({ error: "Query failed", code: "CONTRACT_ERROR" });
      }
  /** GET /api/meters/owner/:address — list all meters for an owner (must be before /:id) */
  meterRouter.get(
    "/owner/:address",
    asyncHandler(async (req, res) => {
      try {
        StellarSdk.StrKey.decodeEd25519PublicKey(req.params.address);
      } catch {
        return res.status(400).json({ error: "Invalid Stellar address" });
      }
      const result = await stellar.query("get_meters_by_owner", [
        StellarSdk.nativeToScVal(req.params.address, { type: "address" }),
      ]);
      res.json({ meters: StellarSdk.scValToNative(result), owner: req.params.address });
    }),
  );

  /** GET /api/meters/:id — get meter status */
  meterRouter.get(
    "/:id",
    cacheFor(5_000),
    asyncHandler(async (req, res) => {
      const result = await stellar.query("get_meter", [
        StellarSdk.nativeToScVal(req.params.id, { type: "symbol" }),
      ]);
      res.json({ meter: StellarSdk.scValToNative(result) });
    }),
  );

  /** GET /api/meters/:id/access — check if meter is active */
  meterRouter.get(
    "/:id/access",
    cacheFor(5_000),
    asyncHandler(async (req, res) => {
      const result = await stellar.query("check_access", [
        StellarSdk.nativeToScVal(req.params.id, { type: "symbol" }),
      ]);
      res.json({ active: StellarSdk.scValToNative(result) });
    }),
  );

  /** POST /api/meters/:id/deactivate — admin manually deactivates a meter */
  meterRouter.post(
    "/:id/deactivate",
    requireAdminKey,
    asyncHandler(async (req, res) => {
      const meterId = req.params.id;
      try {
        await stellar.query("get_meter", [
          StellarSdk.nativeToScVal(meterId, { type: "symbol" }),
        ]);
      } catch {
        return res.status(404).json({ error: "Meter not found", code: "NOT_FOUND" });
      }
      const hash = await stellar.invoke("set_active", [
        StellarSdk.nativeToScVal(meterId, { type: "symbol" }),
        StellarSdk.nativeToScVal(false, { type: "bool" }),
      ]);
      res.json({ hash, meter_id: meterId, active: false });
    }),
  );

  /** POST /api/meters/:id/activate — admin manually activates a meter */
  meterRouter.post(
    "/:id/activate",
    requireAdminKey,
    asyncHandler(async (req, res) => {
      const meterId = req.params.id;
      try {
        await stellar.query("get_meter", [
          StellarSdk.nativeToScVal(meterId, { type: "symbol" }),
        ]);
      } catch {
        return res.status(404).json({ error: "Meter not found", code: "NOT_FOUND" });
      }
      const hash = await stellar.invoke("set_active", [
        StellarSdk.nativeToScVal(meterId, { type: "symbol" }),
        StellarSdk.nativeToScVal(true, { type: "bool" }),
      ]);
      res.json({ hash, meter_id: meterId, active: true });
    }),
  );

  /** GET /api/meters/:id/balance — live balance for a single meter */
  meterRouter.get(
    "/:id/balance",
    asyncHandler(async (req, res) => {
      const meterId = req.params.id;

      // Check cache first
      const cached = balanceCache.get(meterId);
      if (cached && Date.now() - cached.ts < BALANCE_CACHE_TTL_MS) {
        return res.json(cached.data);
      }

      try {
        const result = await stellar.query("get_meter", [
          StellarSdk.nativeToScVal(meterId, { type: "symbol" }),
        ]);
        const meter = StellarSdk.scValToNative(result) as any;
        const payload = {
          meter_id: meterId,
          balance: meter.balance,
          units_used: meter.units_used,
          active: meter.active,
        };
        balanceCache.set(meterId, { data: payload, ts: Date.now() });
        res.json(payload);
      } catch (err: any) {
        res.status(404).json({ error: "Meter not found", code: "NOT_FOUND" });
      }
    }),
  );

  /** GET /api/meters/:id/history — paginated local usage history */
  meterRouter.get("/:id/history", (req, res) => {
    const page = Math.max(1, Number(req.query.page ?? 1) || 1);
    const pageSize = Math.min(
      100,
      Math.max(1, Number(req.query.pageSize ?? 25) || 25),
    );

    try {
      const history = getUsageHistory(req.params.id, page, pageSize);
      res.json(history);
    } catch (err: any) {
      res.status(500).json({ error: err.message, code: "INTERNAL_ERROR" });
    }
  });

  /** POST /api/meters/:id/set-daily-limit — admin sets daily spending limit for a meter */
  meterRouter.post(
    "/:id/set-daily-limit",
    requireAdminKey,
    asyncHandler(async (req, res) => {
      const limit = Number(req.body.limit);
      if (!Number.isInteger(limit) || limit < 0) {
        return res.status(400).json({ error: "limit must be a non-negative integer (stroops)" });
      }
      const hash = await stellar.invoke("set_daily_limit", [
        StellarSdk.nativeToScVal(req.params.id, { type: "symbol" }),
        StellarSdk.nativeToScVal(BigInt(limit), { type: "i128" }),
      ]);
      res.json({ hash, meter_id: req.params.id, daily_limit: limit });
    }),
  );

  /** POST /api/meters — register a new meter (admin only) */
  meterRouter.post(
    "/",
    requireAdminKey,
    validateRequest({ body: RegisterMeterSchema }),
    asyncHandler(async (req, res) => {
      const { meter_id, owner } = req.body;

      const hash = await stellar.invoke("register_meter", [
        StellarSdk.nativeToScVal(meter_id, { type: "symbol" }),
        StellarSdk.nativeToScVal(owner, { type: "address" }),
      ]);
      res.json({ hash });
    }),
  );

  /** POST /api/meters/:id/usage — IoT oracle reports usage */
  meterRouter.post("/:id/usage", requireAdminKey, async (req, res) => {
    const { units, cost } = req.body as { units: unknown; cost: unknown };

    if (units == null || cost == null) {
      return res.status(400).json({ error: "units and cost are required", code: "VALIDATION_ERROR" });
    }

    const unitsNum = Number(units);
    const costNum = Number(cost);

    if (!Number.isFinite(unitsNum) || !Number.isFinite(costNum)) {
      return res.status(400).json({ error: "units and cost must be valid numbers", code: "VALIDATION_ERROR" });
    }

    if (!Number.isInteger(unitsNum) || !Number.isInteger(costNum)) {
      return res.status(400).json({ error: "units and cost must be integers", code: "VALIDATION_ERROR" });
    }

    if (unitsNum <= 0 || costNum <= 0) {
      return res.status(400).json({ error: "units and cost must be positive", code: "VALIDATION_ERROR" });
    }

    try {
      const event = await persistAndSubmitUsageEvent({
        meterId: req.params.id,
        units: unitsNum,
        cost: costNum,
        sourceTopic: null,
      });

      invalidateCache(`/api/meters/${req.params.id}`);

      res.json({
        event,
        hash: event.on_chain_tx_hash,
        queued: !event.on_chain_tx_hash,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message, code: "INTERNAL_ERROR" });
    }
  });

  /** POST /api/meters/:id/topup — top up meter token balance (admin only) */
  meterRouter.post(
    "/:id/topup",
    adminAuth,
    asyncHandler(async (req, res) => {
      const { id } = req.params;
      const { amount } = req.body;
      if (!Number.isInteger(amount) || amount <= 0) {
        return res.status(400).json({ error: "Invalid amount", code: "VALIDATION_ERROR" });
      }
      try {
        const txHash = await stellar.invoke("topup_meter", [
          StellarSdk.nativeToScVal(id, { type: "symbol" }),
          StellarSdk.nativeToScVal(BigInt(amount), { type: "i128" }),
        ]);
        return res.json({ success: true, txHash, meterId: id, amount });
      } catch (err: any) {
        return res.status(500).json({ error: err.message, code: "CONTRACT_ERROR" });
      }
    }),
  );

  return meterRouter;
}

