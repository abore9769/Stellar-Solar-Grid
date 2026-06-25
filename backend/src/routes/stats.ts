import { Router } from 'express';
import * as StellarSdk from '@stellar/stellar-sdk';
import { stellarService } from '../lib/stellar.js';
import { asyncHandler } from '../lib/asyncHandler.js';

export const statsRouter = Router();
let cache: { data: object; expiresAt: number } | null = null;

statsRouter.get('/', asyncHandler(async (_req, res) => {
  if (cache && Date.now() < cache.expiresAt) return res.json(cache.data);

  const result = await stellarService.query('get_all_meters', []);
  const meters = (StellarSdk.scValToNative(result) as any[]) ?? [];
  const total = meters.length;
  const active = meters.filter((m: any) => m.active).length;
  const units = meters.reduce((s: number, m: any) => s + Number(m.units_used), 0);

  let revenue = 0;
  const adminAddr = process.env.ADMIN_ADDRESS;
  if (adminAddr) {
    const rev = await stellarService.query('get_provider_revenue', [
      StellarSdk.nativeToScVal(adminAddr, { type: 'address' }),
    ]);
    revenue = Number(StellarSdk.scValToNative(rev));
  }

  const data = { totalMeters: total, activeMeters: active, totalUnits: units, totalRevenue: revenue };
  cache = { data, expiresAt: Date.now() + 30_000 };
  res.json(data);
}));
