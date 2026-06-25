import { Router } from "express";
import * as StellarSdk from "@stellar/stellar-sdk";
import { server, CONTRACT_ID, NETWORK_PASSPHRASE } from "../lib/stellar.js";
import { logger } from "../lib/logger.js";
import { asyncHandler } from "../lib/asyncHandler.js";

export const paymentsRouter = Router();

const HORIZON_URL =
  NETWORK_PASSPHRASE === StellarSdk.Networks.PUBLIC
    ? "https://horizon.stellar.org"
    : "https://horizon-testnet.stellar.org";

const horizonServer = new StellarSdk.Horizon.Server(HORIZON_URL);

export interface PaymentRecord {
  txHash: string;
  date: string; // ISO string
  meterId: string;
  amountXlm: number;
  plan: string;
}

/**
 * GET /api/payments/:address?page=1&limit=10&sort=desc
 *
 * Queries Soroban contract events for make_payment calls where payer === address.
 * Falls back to Horizon transaction history when events are unavailable.
 */
paymentsRouter.get(
  "/:address",
  asyncHandler(async (req, res) => {
    const rawAddress = req.params.address;
    const address = Array.isArray(rawAddress) ? rawAddress[0] : rawAddress;
    if (typeof address !== "string" || address.trim().length === 0) {
      return res.status(400).json({ error: "Invalid Stellar address" });
    }

    const page = Math.max(1, parseInt((req.query.page as string) ?? "1", 10));
    const limit = Math.min(
      50,
      Math.max(1, parseInt((req.query.limit as string) ?? "10", 10)),
    );
    const sort = req.query.sort === "asc" ? "asc" : "desc";

    try {
      StellarSdk.StrKey.decodeEd25519PublicKey(address);
    } catch {
      return res.status(400).json({ error: "Invalid Stellar address" });
    }

    const records = await fetchPaymentEvents(address, sort);
    const total = records.length;
    const start = (page - 1) * limit;
    const paginated = records.slice(start, start + limit);

    return res.json({
      payments: paginated,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message ?? "Failed to fetch payment history" });
  }
});
  }),
);

// ── Helpers ───────────────────────────────────────────────────────────────────

async function fetchPaymentEvents(
  address: string,
  sort: "asc" | "desc",
): Promise<PaymentRecord[]> {
  // Query Soroban RPC for contract events
  // Events follow (EVT_NS, action, subject) pattern; filter on namespace + action
  const EVT_NS = StellarSdk.xdr.ScVal.scvSymbol("solargrid").toXDR("base64");
  const ACTION = StellarSdk.xdr.ScVal.scvSymbol("payment").toXDR("base64");

  const response = await (server as any).getEvents({
    startLedger: 1,
    filters: [
      {
        type: "contract",
        contractIds: [CONTRACT_ID],
        topics: [
          // topics[0] = EVT_NS ("solargrid"), topics[1] = action ("payment")
          [EVT_NS, ACTION],
        ],
      },
    ],
    limit: 1000,
  });

  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const events: PaymentRecord[] = [];

  for (const event of response?.events ?? []) {
    try {
      const record = parsePaymentEvent(event, address);
      if (record && new Date(record.date).getTime() >= cutoff) events.push(record);
    } catch {
      // skip malformed events
    }
  }

  // Sort by date
  events.sort((a, b) => {
    const diff = new Date(a.date).getTime() - new Date(b.date).getTime();
    return sort === "asc" ? diff : -diff;
  });

  return events;
  } catch (err: any) {
    const rpcErr: any = new Error(err.message ?? "RPC request failed");
    rpcErr.isRpcError = true;
    throw rpcErr;
  }
}

function parsePaymentEvent(
  event: any,
  filterAddress: string,
): PaymentRecord | null {
  // Contract events emitted by make_payment have topics:
  // (EVT_NS, "payment", meter_id) and data: (payer, token_address, amount, plan)
  const topics: StellarSdk.xdr.ScVal[] = (event.topic ?? []).map((t: string) =>
    StellarSdk.xdr.ScVal.fromXDR(t, "base64"),
  );

  if (topics.length < 3) return null;

  // topics[0] = namespace, topics[1] = action, topics[2] = meter_id (subject)
  const meterVal = topics[2];
  const payerVal = topics[2];
  const payer =
    payerVal.switch().name === "scvAddress"
      ? StellarSdk.StrKey.encodeEd25519PublicKey(
          payerVal.address().accountId().ed25519(),
        )
      : null;

  if (!payer || payer !== filterAddress) return null;

  const meterVal = topics[1];
  const meterId =
    meterVal.switch().name === "scvSymbol"
      ? meterVal.sym().toString()
      : "unknown";

  // data is (payer, token_address, amount, plan)
  const dataXdr = event.value ?? event.data;
  let amountXlm = 0;
  let plan = "Unknown";
  let payer: string | null = null;

  if (dataXdr) {
    try {
      const dataVal = StellarSdk.xdr.ScVal.fromXDR(dataXdr, "base64");
      const native = StellarSdk.scValToNative(dataVal) as any[];
      if (Array.isArray(native) && native.length >= 4) {
        // data[0] = payer address, data[2] = amount, data[3] = plan
        const payerNative = native[0];
        payer =
          typeof payerNative === "string"
            ? payerNative
            : payerNative?.toString() ?? null;
        amountXlm = Number(native[2]) / 10_000_000;
        plan = Object.keys(native[3])[0] ?? "Unknown";
      }
    } catch {
      // leave defaults
    }
  }

  if (!payer || payer !== filterAddress) return null;

  // Ledger close time from event
  const date = event.ledgerClosedAt
    ? new Date(event.ledgerClosedAt).toISOString()
    : new Date().toISOString();

  return {
    txHash: event.txHash ?? event.id ?? "",
    date,
    meterId,
    amountXlm,
    plan,
  };
}
