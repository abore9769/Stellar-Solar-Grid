/**
 * Minimal structured logger using console.
 * Swap for winston/pino without changing call sites.
 */
export const logger = {
  info(data: Record<string, unknown>) {
    console.log(JSON.stringify({ level: 'info', ...data, ts: new Date().toISOString() }));
  },
  warn(data: Record<string, unknown>) {
    console.warn(JSON.stringify({ level: 'warn', ...data, ts: new Date().toISOString() }));
  },
  error(data: Record<string, unknown>) {
    console.error(JSON.stringify({ level: 'error', ...data, ts: new Date().toISOString() }));
  },
};
