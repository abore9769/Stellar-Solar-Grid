import { Request, Response, NextFunction } from "express";

const store = new Map<string, { data: unknown; expiresAt: number }>();

export function cacheFor(ttlMs: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.originalUrl;
    const cached = store.get(key);
    if (cached && Date.now() < cached.expiresAt) {
      return res.json(cached.data);
    }
    const original = res.json.bind(res);
    res.json = (data: unknown) => {
      if (store.size > 500) store.clear(); // bound memory
      store.set(key, { data, expiresAt: Date.now() + ttlMs });
      return original(data);
    };
    next();
  };
}

export function invalidateCache(prefix: string) {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}
