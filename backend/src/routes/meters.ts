import { Router } from "express";
import * as StellarSdk from "@stellar/stellar-sdk";
import { StellarService, stellarService } from "../lib/stellar.js";
import {
  getUsageHistory,
  persistAndSubmitUsageEvent,
} from "../lib/usageEvents.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { validateRequest, RegisterMeterSchema } from "../lib/validation.js";
import { requireAdminKey } from "../middleware/adminAuth.js";

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

  /** GET /api/meters/:id — get meter status */
  meterRouter.get(
    "/:id",
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

      // Verify meter exists first
      try {
        await stellar.query("get_meter", [
          StellarSdk.nativeToScVal(meterId, { type: "symbol" }),
        ]);
      } catch {
        return res.status(404).json({ error: "Meter not found" });
      }

      try {
        const txHash = await stellar.invoke("deactivate_meter", [
          StellarSdk.nativeToScVal(meterId, { type: "symbol" }),
        ]);
        res.json({ success: true, tx_hash: txHash, meter_id: meterId });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
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
        res.status(404).json({ error: "Meter not found" });
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
      res.status(500).json({ error: err.message });
    }
  });

  /** GET /api/meters/owner/:address — list all meters for an owner */
  meterRouter.get(
    "/owner/:address",
    asyncHandler(async (req, res) => {
      const result = await stellar.query("get_meters_by_owner", [
        StellarSdk.nativeToScVal(req.params.address, { type: "address" }),
      ]);
      res.json({ meters: StellarSdk.scValToNative(result) });
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
      return res.status(400).json({ error: "units and cost are required" });
    }

    const unitsNum = Number(units);
    const costNum = Number(cost);

    if (!Number.isFinite(unitsNum) || !Number.isFinite(costNum)) {
      return res.status(400).json({ error: "units and cost must be valid numbers" });
    }

    if (!Number.isInteger(unitsNum) || !Number.isInteger(costNum)) {
      return res.status(400).json({ error: "units and cost must be integers" });
    }

    if (unitsNum <= 0 || costNum <= 0) {
      return res.status(400).json({ error: "units and cost must be positive" });
    }

    try {
      const event = await persistAndSubmitUsageEvent({
        meterId: req.params.id,
        units: unitsNum,
        cost: costNum,
        sourceTopic: null,
      });

      res.json({
        event,
        hash: event.on_chain_tx_hash,
        queued: !event.on_chain_tx_hash,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return meterRouter;
}

