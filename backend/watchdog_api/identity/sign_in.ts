import { createHmac, randomInt, randomUUID } from 'node:crypto';
import { AdmissionRepository } from '../db/repositories/admission';
import { MailService, MailDeliveryError } from '../mail';
import { normalizeEmail, sameDigest, newToken, AdmissionError } from './admission';

/**
 * Email one-time codes and operator break-glass links (E4.5).
 *
 * The emailed code is what makes "any address" possible: a person without a
 * Google account proves they control an address by reading a code sent to it.
 * That proof is the whole of what an email-bound invitation needs.
 *
 * Codes are 8 characters from a 31-symbol alphabet with the easily confused
 * characters removed (no I, L, O, 0, 1) — about 8.5 × 10¹¹ possibilities. Five
 * wrong guesses burn a code, and a person can ask for at most five codes an
 * hour, so online guessing succeeds with probability around 3 × 10⁻¹¹ per hour.
 * Stored codes are HMAC'd with a server-side key, so a copy of the database
 * alone is not enough to brute-force a live code offline.
 */

export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const SIGN_IN_LIMITS = Object.freeze({
  codeLength: 8,
  codeMinutes: 10,
  maxAttempts: 5,
  codesPerHour: 5,
  operatorLinkMinutes: 15,
});

export function newCode(): string {
  let code = '';
  for (let i = 0; i < SIGN_IN_LIMITS.codeLength; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

/** `abcd efgh`, `ABCD-EFGH` and `abcdefgh` are the same code. */
export function normalizeCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const code = raw.toUpperCase().replace(/[\s-]/g, '');
  return code.length === SIGN_IN_LIMITS.codeLength && [...code].every(c => CODE_ALPHABET.includes(c)) ? code : null;
}

export function formatCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

export class SignInService {
  constructor(
    private readonly repo: AdmissionRepository,
    private readonly mail: MailService,
    private readonly pepper: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (pepper.length < 32) throw new Error('The sign-in pepper must be at least 32 characters.');
  }

  private digest(kind: string, email: string, secret: string): string {
    return createHmac('sha256', this.pepper).update(`${kind}\u0000${email}\u0000${secret}`).digest('hex');
  }

  /**
   * Sends a code. Callers answer every request identically whatever happens
   * here — an unknown address is a normal case (strangers may sign in and
   * apply), so there is nothing to enumerate, but a uniform answer costs
   * nothing and keeps it that way.
   */
  async startEmailCode(rawEmail: unknown, language?: unknown): Promise<{ expiresAt: string }> {
    const email = normalizeEmail(rawEmail);
    const now = this.now();
    const hourAgo = new Date(now.getTime() - 3_600_000).toISOString();
    if (this.repo.countChallengesSince('email_code', email, hourAgo) >= SIGN_IN_LIMITS.codesPerHour) {
      throw new AdmissionError('rate_limited', 429, 'Too many codes requested for this address. Try again in an hour.');
    }
    if (!(await this.mail.availability()).available) {
      throw new AdmissionError('method_unavailable', 409, 'Sign-in by emailed code is not configured on this installation.');
    }

    const code = newCode();
    const id = randomUUID();
    const expiresAt = new Date(now.getTime() + SIGN_IN_LIMITS.codeMinutes * 60_000).toISOString();
    this.repo.insertChallenge({ id, kind: 'email_code', email, secret_hash: this.digest('email_code', email, code),
      created_at: now.toISOString(), expires_at: expiresAt, delivery_status: 'pending' });

    const base = this.mail.publicUrl();
    // The code travels in the fragment, which browsers never send to a server:
    // it stays out of access logs, proxies and Referer headers.
    const link = base ? `${base}/login#email=${encodeURIComponent(email)}&code=${code}` : null;
    try {
      await this.mail.send(this.mail.signInCodeMessage({
        to: email, code: formatCode(code), minutes: SIGN_IN_LIMITS.codeMinutes, link, language }));
      this.repo.setChallengeDelivery(id, 'sent');
    } catch (e) {
      this.repo.setChallengeDelivery(id, 'send_failed');
      if (e instanceof MailDeliveryError) {
        throw new AdmissionError('mail_delivery_failed', 502, 'The sign-in code could not be sent. Try again shortly.');
      }
      throw e;
    }
    return { expiresAt };
  }

  /** The verified address, or a single generic refusal for every failure mode. */
  verifyEmailCode(rawEmail: unknown, rawCode: unknown): string {
    const refused = new AdmissionError('code_invalid', 401, 'That code is not correct or has expired. Ask for a new one.');
    let email: string;
    try { email = normalizeEmail(rawEmail); } catch { throw refused; }
    const code = normalizeCode(rawCode);
    const at = this.now().toISOString();
    const challenge = this.repo.liveChallenge('email_code', email, at);
    if (!challenge) throw refused;

    const attempts = this.repo.incrementChallengeAttempts(challenge.id);
    if (attempts > SIGN_IN_LIMITS.maxAttempts) {
      this.repo.consumeChallenge(challenge.id, at);
      throw refused;
    }
    if (!code || !sameDigest(this.digest('email_code', email, code), challenge.secret_hash)) {
      if (attempts >= SIGN_IN_LIMITS.maxAttempts) this.repo.consumeChallenge(challenge.id, at);
      throw refused;
    }
    // Consumed atomically: two tabs submitting the same code cannot both sign in.
    if (!this.repo.consumeChallenge(challenge.id, at)) throw refused;
    return email;
  }

  /**
   * Break-glass for the operator (`watchdog-admin signin-link`). Proven by shell
   * access to the server, which is a stronger proof than a mailbox, and needed
   * when mail is not configured yet or has stopped working.
   */
  createOperatorLink(rawEmail: unknown): { token: string; expiresAt: string; email: string } {
    const email = normalizeEmail(rawEmail);
    const now = this.now();
    const token = newToken();
    const expiresAt = new Date(now.getTime() + SIGN_IN_LIMITS.operatorLinkMinutes * 60_000).toISOString();
    this.repo.insertChallenge({ id: randomUUID(), kind: 'operator_link', email,
      secret_hash: this.digest('operator_link', '', token), created_at: now.toISOString(), expires_at: expiresAt,
      delivery_status: 'printed' });
    return { token, expiresAt, email };
  }

  verifyOperatorLink(token: unknown): string {
    const refused = new AdmissionError('link_invalid', 401, 'This sign-in link is not valid or has expired.');
    if (typeof token !== 'string' || token.length < 20 || token.length > 200) throw refused;
    const challenge = this.repo.challengeBySecretHash('operator_link', this.digest('operator_link', '', token));
    const at = this.now().toISOString();
    if (!challenge || challenge.consumed_at || challenge.expires_at <= at) throw refused;
    if (!this.repo.consumeChallenge(challenge.id, at)) throw refused;
    return challenge.email;
  }
}
