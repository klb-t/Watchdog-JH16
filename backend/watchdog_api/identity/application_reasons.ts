import { fill, loadAccessMessages, type AccessMessages } from '../mail';
import type { ApplicationRow } from '../db/repositories/admission';

/**
 * Texts of the applications the system writes for a guest, from
 * `config/access/messages.json`. The stored reason is in the guest's interface
 * language; an administrator reading another language gets it rendered again
 * from the stored values, with the original kept beside it.
 */
export type ReasonOrigin = NonNullable<ApplicationRow['origin']>;
let cached: AccessMessages | null = null;
const messages = () => (cached ??= loadAccessMessages().messages);

export function reasonLanguage(language: unknown): string {
  const m = messages();
  return typeof language === 'string' && m.languages[language] ? language : m.default_language;
}

export function renderReason(origin: ReasonOrigin, params: Readonly<Record<string, string>>, language: string): string {
  return fill(messages().languages[language].application_reason[origin], params);
}

/** Every language the configuration can render this application in; empty for a text a person wrote. */
export function reasonTranslations(a: Pick<ApplicationRow, 'origin' | 'reason_params_json'>): Record<string, string> {
  if (!a.origin || !a.reason_params_json) return {};
  const params = JSON.parse(a.reason_params_json) as Record<string, string>;
  return Object.fromEntries(Object.keys(messages().languages).sort().map(l => [l, renderReason(a.origin!, params, l)]));
}
