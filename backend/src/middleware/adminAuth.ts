import { Request, Response, NextFunction } from 'express';

export function requireAdminKey(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const key = process.env.ADMIN_API_KEY;
  if (!key) return next();
  if (req.headers['x-admin-key'] !== key) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}
