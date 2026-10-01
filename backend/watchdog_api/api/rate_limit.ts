import type { Request, Response, NextFunction } from 'express';

/**
 * A fixed-window limiter for the endpoints anyone on the internet can reach:
 * sign-in, code requests, invitation previews and applications.
 *
 * In memory, because the deployment is one process by decision (SQLite, one
 * writer). If that ever changes this becomes per-instance and weaker, and the
 * per-address limits in the database — which do not depend on it — remain.
 */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** True if this hit is allowed. */
  hit(key: string): boolean {
    const t = this.now();
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= t) {
      this.hits.set(key, { count: 1, resetAt: t + this.windowMs });
      if (this.hits.size > 10_000) this.sweep(t);
      return true;
    }
    entry.count += 1;
    return entry.count <= this.limit;
  }

  retryAfterSeconds(key: string): number {
    const entry = this.hits.get(key);
    return entry ? Math.max(1, Math.ceil((entry.resetAt - this.now()) / 1000)) : 1;
  }

  private sweep(t: number): void {
    for (const [k, v] of this.hits) if (v.resetAt <= t) this.hits.delete(k);
  }
}

/** Express middleware keyed by client address. */
export function limitByIp(limiter: RateLimiter, scope: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${scope}:${req.ip ?? req.socket.remoteAddress ?? 'unknown'}`;
    if (limiter.hit(key)) return next();
    res.setHeader('Retry-After', String(limiter.retryAfterSeconds(key)));
    res.status(429).json({ error: { code: 'rate_limited', message: 'Too many attempts. Please wait a moment and try again.' } });
  };
}
