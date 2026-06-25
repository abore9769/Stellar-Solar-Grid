import { Router } from 'express';
import * as StellarSdk from '@stellar/stellar-sdk';
import { stellarService } from '../lib/stellar.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { requireAdminKey } from '../middleware/adminAuth.js';
import { z } from 'zod';

export const allowlistRouter = Router();
const AddressSchema = z.object({ address: z.string().length(56) });

allowlistRouter.get('/', asyncHandler(async (_req, res) => {
  const result = await stellarService.query('get_allowlist', []);
  res.json({ addresses: StellarSdk.scValToNative(result) });
}));

allowlistRouter.post('/', requireAdminKey, asyncHandler(async (req, res) => {
  const { address } = AddressSchema.parse(req.body);
  const hash = await stellarService.invoke('allowlist_add', [
    StellarSdk.nativeToScVal(address, { type: 'address' }),
  ]);
  res.json({ hash });
}));

allowlistRouter.delete('/:address', requireAdminKey, asyncHandler(async (req, res) => {
  const hash = await stellarService.invoke('allowlist_remove', [
    StellarSdk.nativeToScVal(req.params.address, { type: 'address' }),
  ]);
  res.json({ hash });
}));
