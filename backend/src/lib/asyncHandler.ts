import { Request, Response, NextFunction } from 'express';

/**
 * Wraps an async Express route handler and forwards any thrown errors
 * to the next() error middleware, avoiding unhandled promise rejections.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
