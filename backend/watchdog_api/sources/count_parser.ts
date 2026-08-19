/**
 * Parsing a provider's reported result count.
 *
 * `03_JH2016_CONTRACT.md` requires this to handle grouped digits and "about"
 * prefixes, and requires that anything it cannot parse becomes **missing** —
 * never zero, never a guess. The distinction that matters most here is between
 * "the provider said zero" (a real measurement) and "I could not tell what the
 * provider said" (missing); collapsing the two is how a fabricated data point
 * enters a dataset.
 */

export type CountParse =
  | { ok: true; count: number; grouped: boolean; approximate: boolean }
  | { ok: false; reason: 'ABSENT' | 'UNPARSEABLE'; raw: string | null };

const APPROX_PREFIX = /\b(about|approximately|around|roughly|ongeveer|około)\b/i;

export function parseResultCount(raw: unknown): CountParse {
  if (raw === null || raw === undefined || raw === '') {
    return { ok: false, reason: 'ABSENT', raw: raw === undefined ? null : (raw as string | null) };
  }

  // A provider that returns a real number needs no parsing.
  if (typeof raw === 'number') {
    return Number.isFinite(raw) && raw >= 0 && Number.isInteger(raw)
      ? { ok: true, count: raw, grouped: false, approximate: false }
      : { ok: false, reason: 'UNPARSEABLE', raw: String(raw) };
  }

  if (typeof raw !== 'string') return { ok: false, reason: 'UNPARSEABLE', raw: String(raw) };

  const approximate = APPROX_PREFIX.test(raw);

  // The count is the first run of digits, optionally grouped by commas,
  // periods or thin spaces. Anchored to a word boundary so the "0.41 seconds"
  // timing suffix in a typical response cannot be mistaken for the count.
  const match = raw.match(/(?:^|[^\d.,])(\d{1,3}(?:[,.   ]\d{3})+|\d+)(?=\s*(?:results?|hits?|\b))/i);
  if (!match) return { ok: false, reason: 'UNPARSEABLE', raw };

  const token = match[1];
  const grouped = /[,.   ]/.test(token);
  const digits = token.replace(/[,.   ]/g, '');
  if (!/^\d+$/.test(digits)) return { ok: false, reason: 'UNPARSEABLE', raw };

  const count = Number(digits);
  if (!Number.isSafeInteger(count)) return { ok: false, reason: 'UNPARSEABLE', raw };

  return { ok: true, count, grouped, approximate };
}
