/**
 * watchdog-admin — access administration from the server shell (E4.5).
 *
 * The UI is the normal way to admit people. This exists for the moments it
 * cannot be: the very first administrator of a fresh installation, a lost
 * mailbox, or mail that is not configured yet. Root access to the server is the
 * authority here, which is why it lives in a shell tool and nowhere reachable
 * over HTTP.
 *
 * In the container:  docker exec watchdog node dist/watchdog-admin.cjs <command>
 * On the VM:         sudo watchdogctl <command>          (wraps the line above)
 * In development:    node --import tsx scripts/watchdog_admin.ts <command>
 */
import { sqlite } from '../backend/watchdog_api/db/client';
import { AdmissionRepository } from '../backend/watchdog_api/db/repositories/admission';
import { appendAudit } from '../backend/watchdog_api/db/repositories/audit';
import {
  AdmissionService, AdmissionError, OPERATOR_ACTOR, operatorInvitation,
} from '../backend/watchdog_api/identity/admission';
import { SignInService, signInPepper } from '../backend/watchdog_api/identity/sign_in';
import { parseGrants, readAuthConfig } from '../backend/watchdog_api/identity';
import { MailService, loadAccessMessages } from '../backend/watchdog_api/mail';
import { secretStore } from '../backend/watchdog_api/secrets';

const USAGE = `watchdog-admin — access administration from the server shell

  grant EMAIL ROLES [--note TEXT]
      Give an address access now (ROLES comma-separated, e.g. developer or
      researcher,responder). Replaces UI-managed roles for that address.
  signin-link EMAIL
      Print a one-time sign-in link, valid 15 minutes. For when mail is not
      configured or a mailbox is unreachable. The address still needs access
      to see anything beyond the application form.
  invite EMAIL ROLES [--days N] [--note TEXT]
      Print an invitation link bound to EMAIL.
  open-link ROLES [--uses N] [--days N] [--note TEXT]
      Print an invitation link anyone may use (never admin or developer).
  people
      List who has access and who is waiting.

Roles: viewer researcher responder institutional law_enforcement admin developer`;

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

function base(): { url: string; note: string | null } {
  const mail = new MailService(loadAccessMessages().messages);
  const url = mail.publicUrl();
  return url ? { url, note: null } : {
    url: 'http://127.0.0.1:8080',
    note: 'WATCHDOG_PUBLIC_URL is not set, so this link assumes the IAP tunnel on port 8080. ' +
      'Replace the start of it if you reach the installation another way.',
  };
}

async function main(argv: string[]): Promise<number> {
  const [command, ...args] = argv;
  if (!command || command === 'help' || command === '--help') { console.log(USAGE); return 0; }

  const config = readAuthConfig();
  if (config.mode !== 'accounts') {
    console.error('This installation is in local mode (no sign-in). Set WATCHDOG_AUTH=accounts first ' +
      '(on the VM: sudo watchdogctl enable-accounts YOUR_EMAIL).');
    return 2;
  }
  const repo = new AdmissionRepository(sqlite);
  const admission = new AdmissionService(repo, parseGrants(process.env.WATCHDOG_GRANTS),
    (...event) => appendAudit(sqlite, ...event));

  try {
    switch (command) {
      case 'grant': {
        const [email, roles] = args;
        const id = admission.operatorGrant(email, (roles ?? '').split(',').filter(Boolean), flag(args, 'note') ?? null);
        console.log(`Granted ${roles} to ${email} (grant ${id}). Takes effect on their next request.`);
        return 0;
      }
      case 'signin-link': {
        const key = await secretStore.resolve('env:SESSION_SIGNING_KEY');
        if (!key.isPresent) { console.error('SESSION_SIGNING_KEY is not set.'); return 2; }
        const signIn = new SignInService(repo, new MailService(loadAccessMessages().messages), key.use(signInPepper));
        const { token, expiresAt, email } = signIn.createOperatorLink(args[0]);
        const b = base();
        console.log(`One-time sign-in link for ${email}, valid until ${expiresAt}:\n\n  ${b.url}/login#signin=${token}\n`);
        if (b.note) console.log(b.note);
        return 0;
      }
      case 'invite':
      case 'open-link': {
        const email = command === 'invite' ? args.shift() : undefined;
        const roles = (args[0] ?? '').split(',').filter(Boolean);
        const { invitation, token } = operatorInvitation(admission, {
          kind: command === 'invite' ? 'email' : 'open_link', email, roles, note: flag(args, 'note'),
          expiresInDays: flag(args, 'days') === undefined ? undefined : Number(flag(args, 'days')),
          maxUses: flag(args, 'uses') === undefined ? undefined : Number(flag(args, 'uses')),
        });
        const b = base();
        console.log(`${command === 'invite' ? `Invitation for ${email}` : 'Open link'} (${invitation.roles.join(', ')}), ` +
          `valid until ${invitation.expiresAt}${invitation.kind === 'open_link' ? `, ${invitation.maxUses} use(s)` : ''}:\n\n` +
          `  ${b.url}/join#t=${token}\n`);
        if (b.note) console.log(b.note);
        return 0;
      }
      case 'people': {
        const members = admission.members(OPERATOR_ACTOR);
        console.log('Access:');
        for (const m of members) {
          const from = m.sources.map(s => s.kind === 'environment' ? 'environment' : s.source).join('+');
          console.log(`  ${m.email.padEnd(36)} ${m.roles.join(',').padEnd(28)} ${m.active ? '' : '[blocked] '}${from}`);
        }
        const waiting = admission.applications(OPERATOR_ACTOR).filter(a => a.status === 'pending');
        console.log(`\nWaiting for a decision: ${waiting.length}`);
        for (const a of waiting) console.log(`  ${a.email}  ${a.submitted_at}  ${a.reason.slice(0, 80).replace(/\s+/g, ' ')}`);
        return 0;
      }
      default:
        console.error(`Unknown command '${command}'.\n\n${USAGE}`);
        return 2;
    }
  } catch (e) {
    if (e instanceof AdmissionError) { console.error(e.message); return 1; }
    throw e;
  }
}

main(process.argv.slice(2)).then(code => { process.exitCode = code; });
