# Security, Privacy and RBAC

## Auth
Google OIDC MVP; email external identity. Unknown users request access; admin approves. Never trust frontend email/role claims.

## Capabilities
Examples: `runs.read`, `runs.create`, `runs.cancel.own`, `runs.cancel.any`, `sources.read`, `sources.configure`, `schedules.read`, `schedules.manage.own`, `schedules.manage.any`, `analysis.run`, `exports.create`, `summaries.create`, `users.manage`, `audit.read`, `medical.evidence.read`.
Roles map to capabilities in policy config/DB.

## Secrets
Secret store/environment only; never git; never return after save; never manifest/log; redact sensitive query params; `.env.example` names only.

## Privacy
MVP should need no patient PII. Later user-generated reports require separate DPIA/privacy review, minimization, retention, lawful basis/source terms and anonymization/pseudonymization as appropriate.

## Medical safety
Medical view exposes source/evidence grade/date, distinguishes measured fact/prediction/generated text, surfaces uncertainty, performs no autonomous diagnosis/treatment. Clinical protocol data requires authoritative versioned sources and separate review.

## Audit
Role changes, source credential changes, schedules, cancellation, config changes, access decisions, privileged exports, manifest supersession.

## Web security
CSRF as appropriate, secure/httpOnly/sameSite cookies, strict CORS, CSP where practical, validation, authorized downloads, path traversal prevention, SSRF prevention, rate limits. Configurable source URL must never become arbitrary SSRF; adapters define allowed endpoints.

## Supply chain
Locked deps, CI vulnerability scan, deliberate container pins, optional SBOM, environment/dependency fingerprint in manifest.
