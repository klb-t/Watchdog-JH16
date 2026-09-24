import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';
import nodemailer from 'nodemailer';
import { SecretStore, secretStore as defaultSecretStore, CredentialStatus } from '../secrets';
import { redact } from '../utils/redaction';
import { hashConfig } from '../config/canonicalize';

/**
 * The `mail.send` capability (E4.5): invitations and sign-in codes.
 *
 * Two rules shape it.
 *
 * **Nothing is reported as sent unless an SMTP server accepted it.** Without a
 * configured transport an invitation is a draft and a link the administrator
 * shares themselves — never a "sent" status that nobody's mail server saw. And
 * "accepted by the SMTP server" is all `sent` ever means; delivery to an inbox
 * is not something this code can observe, and it does not claim to.
 *
 * **Links in server-sent mail come only from `WATCHDOG_PUBLIC_URL`.** Deriving
 * them from the request's Host header is the classic way to email someone a
 * sign-in link that points at an attacker's site, carrying their code with it.
 * With no public URL configured, sign-in mail carries the code alone and
 * invitations are not sent by the server at all.
 */

const Text = z.string().min(1);
const LanguageSchema = z.object({
  role_labels: z.record(z.string(), z.string()),
  invitation: z.object({ subject: Text, body: Text }),
  open_link: z.object({ subject: Text, body: Text }),
  sign_in_code: z.object({ subject: Text, body: Text }),
  fragments: z.object({ note: Text, uses: Text, link: Text }),
});
const MessagesSchema = z.object({
  schema_version: z.string(),
  instance_name: Text,
  default_language: z.string(),
  languages: z.record(z.string(), LanguageSchema),
}).refine(m => m.languages[m.default_language] !== undefined, { message: 'default_language must be one of languages.' });

export type AccessMessages = z.infer<typeof MessagesSchema>;

export const DEFAULT_MESSAGES_PATH = path.join(process.cwd(), 'config', 'access', 'messages.json');

export function loadAccessMessages(file: string = DEFAULT_MESSAGES_PATH): { messages: AccessMessages; hash: string } {
  const messages = MessagesSchema.parse(JSON.parse(fs.readFileSync(file, 'utf-8')));
  return { messages, hash: hashConfig(messages) };
}

/** Plain `{{name}}` substitution. Unknown placeholders stay visible rather than vanishing. */
export function fill(template: string, vars: Readonly<Record<string, string>>): string {
  return template.replace(/\{\{([a-z_]+)\}\}/g, (whole, key: string) => (key in vars ? vars[key] : whole));
}

export interface MailMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
}

export interface MailReceipt {
  readonly messageId: string | null;
  readonly accepted: readonly string[];
  readonly rejected: readonly string[];
}

export interface MailTransport {
  send(message: MailMessage): Promise<MailReceipt>;
}

export class MailDeliveryError extends Error {
  readonly code = 'mail_delivery_failed';
  constructor(detail: string) {
    super(detail);
    this.name = 'MailDeliveryError';
  }
}

/** nodemailer over whatever `SMTP_URL` names: Gmail with an app password, Brevo, SES, a local relay. */
export class SmtpMailTransport implements MailTransport {
  private readonly transporter;
  constructor(url: string, private readonly from: string) {
    this.transporter = nodemailer.createTransport(url);
  }

  async send(message: MailMessage): Promise<MailReceipt> {
    try {
      const info = await this.transporter.sendMail({ from: this.from, to: message.to, subject: message.subject, text: message.text });
      return {
        messageId: typeof info.messageId === 'string' ? info.messageId : null,
        accepted: (info.accepted ?? []).map(String),
        rejected: (info.rejected ?? []).map(String),
      };
    } catch (e) {
      // An SMTP error can echo the connection string; the redactor knows it.
      throw new MailDeliveryError(redact(e instanceof Error ? e.message : String(e)));
    }
  }
}

export interface MailAvailability {
  readonly available: boolean;
  readonly credentialStatus: CredentialStatus;
  readonly from: string | null;
  readonly publicUrl: string | null;
  /** What the operator should do; empty when mail works. */
  readonly remediation: string;
}

export type TransportFactory = (url: string, from: string) => MailTransport;

export class MailService {
  constructor(
    readonly messages: AccessMessages,
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly secrets: SecretStore = defaultSecretStore,
    private readonly factory: TransportFactory = (url, from) => new SmtpMailTransport(url, from),
  ) {}

  /** The configured public origin, validated, without a trailing slash. */
  publicUrl(): string | null {
    const raw = this.env.WATCHDOG_PUBLIC_URL?.trim();
    if (!raw) return null;
    try {
      const url = new URL(raw);
      if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) return null;
      return url.origin;
    } catch {
      return null;
    }
  }

  async availability(): Promise<MailAvailability> {
    const handle = await this.secrets.resolve('env:SMTP_URL');
    const from = this.env.MAIL_FROM?.trim() || null;
    const publicUrl = this.publicUrl();
    let remediation = '';
    if (!handle.isPresent) {
      remediation = handle.status === 'invalid'
        ? `SMTP_URL is set but unusable. ${handle.detail}`
        : 'Set SMTP_URL (e.g. smtps://you%40gmail.com:APP_PASSWORD@smtp.gmail.com:465) and MAIL_FROM to send mail.';
    } else if (!from) {
      remediation = 'Set MAIL_FROM, e.g. "WatchDog <you@gmail.com>".';
    }
    return { available: handle.isPresent && !!from, credentialStatus: handle.status, from, publicUrl, remediation };
  }

  private async transport(): Promise<MailTransport> {
    const a = await this.availability();
    if (!a.available) throw new MailDeliveryError(`Mail is not configured. ${a.remediation}`);
    const handle = await this.secrets.resolve('env:SMTP_URL');
    return handle.use(url => this.factory(url, a.from!));
  }

  async send(message: MailMessage): Promise<MailReceipt> {
    const receipt = await (await this.transport()).send(message);
    if (!receipt.accepted.map(a => a.toLowerCase()).includes(message.to.toLowerCase())) {
      throw new MailDeliveryError(`The mail server did not accept ${message.to}.`);
    }
    return receipt;
  }

  language(requested: unknown): string {
    return typeof requested === 'string' && this.messages.languages[requested] ? requested : this.messages.default_language;
  }

  roleList(roles: readonly string[], lang: string): string {
    const labels = this.messages.languages[this.language(lang)].role_labels;
    return roles.map(r => labels[r] ?? r).join(', ');
  }

  /** The invitation text an administrator previews, copies, shares or sends. */
  invitationDraft(input: { kind: 'email' | 'open_link'; email: string | null; roles: readonly string[];
    note: string | null; inviter: string; link: string; expiresAt: string; maxUses: number; language?: unknown }):
    { subject: string; body: string; language: string } {
    const language = this.language(input.language);
    const m = this.messages.languages[language];
    const template = input.kind === 'email' ? m.invitation : m.open_link;
    const expires = new Date(input.expiresAt).toLocaleString(language === 'pl' ? 'pl-PL' : 'en-GB',
      { dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/Warsaw' });
    const vars = {
      instance: this.messages.instance_name, inviter: input.inviter, roles: this.roleList(input.roles, language),
      email: input.email ?? '', link: input.link, expires,
      note_block: input.note ? fill(m.fragments.note, { note: input.note }) : '',
      uses_block: input.kind === 'open_link' && input.maxUses > 1 ? fill(m.fragments.uses, { max_uses: String(input.maxUses) }) : '',
    };
    return { subject: fill(template.subject, vars), body: fill(template.body, vars), language };
  }

  signInCodeMessage(input: { to: string; code: string; minutes: number; link: string | null; language?: unknown }): MailMessage {
    const language = this.language(input.language);
    const m = this.messages.languages[language];
    const vars = {
      instance: this.messages.instance_name, code: input.code, minutes: String(input.minutes),
      link_block: input.link ? fill(m.fragments.link, { link: input.link }) : '',
    };
    return { to: input.to, subject: fill(m.sign_in_code.subject, vars), text: fill(m.sign_in_code.body, vars) };
  }
}
