import { Router, Request, Response, NextFunction } from 'express';
import { ROLES, can, openLinkAllowsRole, grantableRoles } from '../../../shared/authorization';
import { AdmissionService, AdmissionError, InvitationView, normalizeEmail, INVITATION_LIMITS } from '../identity/admission';
import { MailService, MailDeliveryError } from '../mail';
import { actorOf, admissionRoute } from './auth_routes';

/**
 * People and access (E4.5): members, applications and invitations.
 *
 * Reads need `principal.view` or `access.admit`; every change is checked again
 * inside `AdmissionService`, which re-derives the actor's rights from the
 * database rather than trusting the request. The capability check here is the
 * first gate, not the only one.
 *
 * An invitation's token is returned exactly once, at creation (or on
 * rotation). The server keeps only its hash, so it cannot show the link again
 * or email it later on its own — sending requires the administrator's browser
 * to hand the token back, which is also the proof that the link being sent is
 * the current one.
 */

function linkFor(base: string, token: string): string {
  // Fragment, not query: browsers never send it to a server, so the token stays
  // out of access logs, proxy logs and Referer headers.
  return `${base}/join#t=${token}`;
}

/** The origin the administrator's browser is on, used only for drafts they see themselves. */
function clientBase(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.origin : null;
  } catch {
    return null;
  }
}

function requireViewer(req: Request, res: Response, next: NextFunction) {
  if (!req.principal) return res.status(401).json({ error: { code: 'unauthenticated' } });
  const roles = req.principal.roles;
  if (!can(roles, 'principal.view') && !can(roles, 'access.admit')) {
    return res.status(403).json({ error: { code: 'forbidden', message: 'Requires principal.view or access.admit.' } });
  }
  next();
}

export function buildAccessRouter(admission: AdmissionService, mail: MailService): Router {
  const router = Router();
  router.use(requireViewer);
  router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });

  const inviterName = (req: Request) => req.principal?.email ?? 'WatchDog';

  const draftFor = (req: Request, invitation: InvitationView, token: string, language: unknown, base: string | null) => {
    const link = base ? linkFor(base, token) : null;
    const text = link ? mail.invitationDraft({
      kind: invitation.kind, email: invitation.email, roles: invitation.roles, note: invitation.note,
      inviter: inviterName(req), link, expiresAt: invitation.expiresAt, maxUses: invitation.maxUses, language,
    }) : null;
    return { link, draft: text };
  };

  router.get('/overview', admissionRoute(async (req, res) => {
    const actor = actorOf(req);
    const availability = await mail.availability();
    res.json({
      members: admission.members(actor),
      applications: admission.applications(actor).map(a => ({
        id: a.id, email: a.email, display_name: a.display_name, affiliation: a.affiliation, reason: a.reason,
        requested_roles: JSON.parse(a.requested_roles_json), status: a.status, submitted_at: a.submitted_at,
        decided_at: a.decided_at, decided_by: a.decided_by, decision_note: a.decision_note,
      })),
      invitations: admission.invitations(actor),
      roles: ROLES,
      grantable_roles: grantableRoles(req.principal!.roles),
      open_link_roles: grantableRoles(req.principal!.roles).filter(openLinkAllowsRole),
      limits: INVITATION_LIMITS,
      mail: { available: availability.available, remediation: availability.remediation,
        public_url: availability.publicUrl, from: availability.from },
      languages: Object.keys(mail.messages.languages),
      default_language: mail.messages.default_language,
    });
  }));

  router.post('/invitations', admissionRoute((req, res) => {
    const { invitation, token } = admission.createInvitation(actorOf(req), {
      kind: req.body?.kind, email: req.body?.email, roles: req.body?.roles, note: req.body?.note,
      expiresInDays: req.body?.expires_in_days, maxUses: req.body?.max_uses, accessExpiresAt: req.body?.access_expires_at,
    });
    const base = mail.publicUrl() ?? clientBase(req.body?.link_base);
    res.status(201).json({ invitation, token, ...draftFor(req, invitation, token, req.body?.language, base) });
  }));

  router.post('/invitations/:id/draft', admissionRoute((req, res) => {
    const row = admission.verifyInvitationToken(actorOf(req), req.params.id, req.body?.token);
    const invitation = admission.invitationView(row);
    const base = mail.publicUrl() ?? clientBase(req.body?.link_base);
    res.json({ invitation, ...draftFor(req, invitation, req.body.token, req.body?.language, base) });
  }));

  /**
   * Sends the invitation by email. Only with a configured transport *and* a
   * configured public URL — the link in a server-sent message must never come
   * from request headers. Without them this is a 409 naming what to set, and
   * the invitation stays a draft the administrator can share themselves.
   */
  router.post('/invitations/:id/send', admissionRoute(async (req, res) => {
    const actor = actorOf(req);
    const row = admission.verifyInvitationToken(actor, req.params.id, req.body?.token);
    const availability = await mail.availability();
    if (!availability.available) {
      throw new AdmissionError('mail_unavailable', 409, `Mail is not configured. ${availability.remediation}`);
    }
    if (!availability.publicUrl) {
      throw new AdmissionError('public_url_missing', 409,
        'Set WATCHDOG_PUBLIC_URL (the https address people open) before the server can email links.');
    }
    const invitation = admission.invitationView(row);
    const to = invitation.kind === 'email' ? invitation.email! : normalizeEmail(req.body?.to);
    const { draft } = draftFor(req, invitation, req.body.token, req.body?.language, availability.publicUrl);
    try {
      const receipt = await mail.send({ to, subject: draft!.subject, text: draft!.body });
      const view = admission.recordDelivery(actor, invitation.id, 'sent',
        `Accepted by the mail server for ${to}${receipt.messageId ? ` (${receipt.messageId})` : ''}.`);
      res.json({ invitation: view, sent_to: to });
    } catch (e) {
      if (!(e instanceof MailDeliveryError)) throw e;
      admission.recordDelivery(actor, invitation.id, 'send_failed', e.message);
      throw new AdmissionError('mail_delivery_failed', 502, `The mail server refused the message: ${e.message}`);
    }
  }));

  /** The administrator copied or shared the link themselves. Recorded as exactly that. */
  router.post('/invitations/:id/shared', admissionRoute((req, res) => {
    const via = typeof req.body?.via === 'string' ? req.body.via.slice(0, 40) : 'link';
    res.json({ invitation: admission.recordDelivery(actorOf(req), req.params.id, 'link_shared',
      `Link handed over by the administrator (${via}); delivery not observed by the server.`) });
  }));

  router.post('/invitations/:id/rotate', admissionRoute((req, res) => {
    const { invitation, token } = admission.rotateInvitation(actorOf(req), req.params.id);
    const base = mail.publicUrl() ?? clientBase(req.body?.link_base);
    res.json({ invitation, token, ...draftFor(req, invitation, token, req.body?.language, base) });
  }));

  router.post('/invitations/:id/revoke', admissionRoute((req, res) => {
    res.json({ invitation: admission.revokeInvitation(actorOf(req), req.params.id) });
  }));

  router.post('/applications/:id/approve', admissionRoute((req, res) => {
    res.json({ application: admission.approveApplication(actorOf(req), req.params.id, {
      roles: req.body?.roles, note: req.body?.note, accessExpiresAt: req.body?.access_expires_at }) });
  }));

  router.post('/applications/:id/deny', admissionRoute((req, res) => {
    res.json({ application: admission.denyApplication(actorOf(req), req.params.id, { note: req.body?.note }) });
  }));

  router.post('/members/roles', admissionRoute((req, res) => {
    res.json({ member: admission.setRoles(actorOf(req), req.body?.email, {
      roles: req.body?.roles, note: req.body?.note, accessExpiresAt: req.body?.access_expires_at }) });
  }));

  router.post('/members/revoke', admissionRoute((req, res) => {
    res.json(admission.revoke(actorOf(req), req.body?.email, { reason: req.body?.reason, block: req.body?.block }));
  }));

  router.post('/members/unblock', admissionRoute((req, res) => {
    admission.unblock(actorOf(req), req.body?.email);
    res.json({ unblocked: true });
  }));

  router.get('/members/history', admissionRoute((req, res) => {
    res.json({ grants: admission.grantHistory(actorOf(req), req.query.email).map(g => ({
      id: g.id, roles: JSON.parse(g.roles_json), source: g.source, granted_by: g.granted_by, granted_at: g.granted_at,
      expires_at: g.expires_at, note: g.note, revoked_at: g.revoked_at, revoked_by: g.revoked_by,
      revoke_reason: g.revoke_reason,
    })) });
  }));

  return router;
}
