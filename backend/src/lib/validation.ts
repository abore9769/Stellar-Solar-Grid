import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';

/**
 * Validates req.body against the provided Zod schema.
 * Returns 400 with validation errors if the body is invalid.
 */
export function validateRequest<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const errors = (result.error as ZodError).errors.map((e) => ({
        path: e.path.join('.'),
        message: e.message,
      }));
      return res.status(400).json({ error: 'Validation failed', details: errors });
    }
    req.body = result.data;
    next();
  };
}
