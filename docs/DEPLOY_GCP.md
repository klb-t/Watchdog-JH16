# Deploying WatchDog to Google Cloud Run

For the current owner-only Compute Engine VM installation, use
[DEPLOY_GCP_VM.md](DEPLOY_GCP_VM.md). The older Cloud Run path below is separate; it does
not implement the pending closed admission/invitation UI.

Written for someone who has not used GCP before. Every command is copy-pasteable;
where a step needs a decision, the decision is stated rather than assumed.

Costs depend on the Google Cloud resources retained and used, as well as external API
providers. Scaling the service to zero does not make storage and other resources free.

---

## Before you start: what this deployment is, and is not

**Is:** a durable single-user research instance. Runs, observations, approvals and archived
raw responses survive restarts. Google sign-in is the front door.

**Is not:** horizontally scalable. The database is SQLite on one mounted volume, so the
service is pinned to `--max-instances=1` — a second instance would be a second writer.
Lifting that needs the Postgres backend, which is deliberately unbuilt and recorded under
`## Blocked` in `docs/spec/07_EPICS_AND_TASKS.md`. For one researcher this limit is invisible.

Two startup checks will refuse to boot rather than deploy something misleading:

| Check | Refuses when | Waiver |
|---|---|---|
| Authentication | `NODE_ENV=production` with no sign-in configured | `WATCHDOG_ALLOW_OPEN_INSTANCE=true` |
| Durability | production with storage that dies on restart | `WATCHDOG_ALLOW_EPHEMERAL_STORAGE=true` |

Both waivers exist for legitimate throwaway demos. Neither is reachable by forgetting a variable.

---

## 0. Install the CLI and pick a project

```bash
# macOS: brew install --cask google-cloud-sdk
# Linux: https://cloud.google.com/sdk/docs/install
gcloud auth login
gcloud projects create watchdog-jh16-<something-unique>   # or use an existing project
export PROJECT_ID=watchdog-jh16-<something-unique>
gcloud config set project "$PROJECT_ID"
```

Billing must be enabled on the project, even though the expected cost is near zero:
Console → Billing → Link a billing account.

---

## 1. Deploy the infrastructure and the service

```bash
export PROJECT_ID=...          # from step 0
export REGION=europe-west4     # pick one near you
./scripts/deploy_cloudrun.sh
```

The script enables the APIs, creates a service account, creates a versioned GCS bucket for
the blob store, creates three **empty** secrets, grants the service account access to them,
and deploys. It prints every command it runs.

It deploys with `--no-allow-unauthenticated`, so nothing is publicly reachable yet. That is
deliberate: the instance should not be on the open internet before sign-in works.

---

## 2. Put values into the secrets

Nothing puts a key on a command line as an argument, so none of these reach your shell
history in a form that is stored.

```bash
# Signs session cookies. Generate it; do not invent one.
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))" \
  | tr -d '\n' | gcloud secrets versions add SESSION_SIGNING_KEY --data-file=-

# Optional, and metered. Skip either one and the matching feature reports itself
# as blocked on the Setup page with the exact variable to set.
printf %s 'sk-or-v1-...' | gcloud secrets versions add OPENROUTER_API_KEY --data-file=-
printf %s '...'          | gcloud secrets versions add SERPAPI_API_KEY   --data-file=-
```

---

## 3. Set up Google sign-in

1. Console → **APIs & Services → OAuth consent screen**. Choose **External**, fill in the
   app name and your email, and add yourself under **Test users**. You do not need to submit
   for verification while you are the only user.
2. Console → **APIs & Services → Credentials → Create credentials → OAuth client ID**.
   Application type **Web application**.
3. Under **Authorised JavaScript origins**, add your Cloud Run URL — find it with:

   ```bash
   gcloud run services describe watchdog --region "$REGION" --format 'value(status.url)'
   ```

4. Copy the **Client ID** (it ends in `.apps.googleusercontent.com`). It is not a secret.
5. Redeploy with the client id and your grant list:

   ```bash
   gcloud run services update watchdog --region "$REGION" \
     --update-env-vars "GOOGLE_OAUTH_CLIENT_ID=<client-id>,WATCHDOG_GRANTS={\"you@gmail.com\":\"developer\"}"
   ```

   `WATCHDOG_GRANTS` maps an email address, or an `@domain` suffix, to one of
   `viewer | researcher | responder | institutional | law_enforcement | admin | developer | dev`. There is no wildcard: an instance that grants a role
   to every Google account is one Google account away from being open, and that is not a
   state this can reach by accident.

   Keep an owner bootstrap grant with `developer` (or compatibility alias `dev`).
   That profile can approve admission requests, combine roles and revoke access at
   **Settings → Installation access**. An `admin` can prepare and revoke invitation
   links, but cannot assign profiles. Existing admin-only installations remain valid;
   their operator must add a developer bootstrap grant before approving new users.
   Invitation links bind to the verified email and only submit an admission request.
   Their acceptance never supplies application access automatically.

6. Now open the front door — Google sign-in becomes the gate:

   ```bash
   gcloud run services update watchdog --region "$REGION" --allow-unauthenticated
   ```

---

## 4. Check it

Open the service URL, sign in, and go to **Settings**. An account without a grant sees
only the admission form, where it can explain its intended use. The owner approves its
profiles in **Installation access**, after which the account can activate its session.
Every provider shows one of:

- **ready** — credentialled and usable;
- **blocked** — built, waiting on exactly one named environment variable;
- **planned** — no adapter exists yet.

`blocked` and `planned` are different on purpose. `blocked` means one variable away;
`planned` means there is nothing to switch on.

The offline slice works regardless of any provider:

```bash
npm run demo:jh16     # locally, no credentials, no network
```

---

## Which role can do what

| | viewer | researcher | admin | dev |
|---|:--:|:--:|:--:|:--:|
| View runs, download exports | ● | ● | ● | ● |
| Start runs, approve methods and narratives | | ● | ● | ● |
| Approve providers, manage principals | | | ● | ● |
| Diagnostics surface | | | | ● |

Approving a *provider* is not a researcher's power: it changes which instrument the whole
installation measures with.

---

## Claiming the runs from before sign-in existed

Every row written before authentication is owned by the constant principal `local-user`.
After signing in once as an admin:

```bash
curl -X POST https://<your-url>/api/auth/principals/migrate-local-user \
  -H 'Content-Type: application/json' -b 'watchdog_session=<your cookie>' -d '{}'
```

This is admin-only and explicit. An automatic claim on first sign-in would hand everything
the instance had to whoever found the URL first. `local-user` itself is kept afterwards, so
an old run still resolves to a principal that explains what it was.

---

## Running the container locally first

Worth doing before touching GCP — it catches most mistakes in a minute:

```bash
docker build -t watchdog .
docker run --rm -p 8080:8080 \
  -e NODE_ENV=production \
  -e WATCHDOG_ALLOW_OPEN_INSTANCE=true \
  -e WATCHDOG_ALLOW_EPHEMERAL_STORAGE=true \
  watchdog
```

Both waivers are set here precisely because this *is* a throwaway container. Do not carry
that command to a real deployment.

---

## Troubleshooting

**"Refusing to start: NODE_ENV=production with no authentication configured"**
Working as intended. Set `GOOGLE_OAUTH_CLIENT_ID`, `WATCHDOG_GRANTS` and
`SESSION_SIGNING_KEY`, or set `WATCHDOG_ALLOW_OPEN_INSTANCE=true` if you mean it.

**"Refusing to start: … would not survive a restart"**
`STORE_BACKEND=gcs` with `GCS_BUCKET`, and `DB_PATH` under `/mnt/watchdog`. The deploy
script sets both; this appears if they were edited apart.

**Sign-in succeeds but shows an access request instead of the workspace**
The verified address has no current installation grant. Submit the explanation, then have
an owner with `developer`/`dev` approve its profiles. Bootstrap `WATCHDOG_GRANTS` still
supports exact addresses and exact `@domain` suffixes. Persisted revocation overrides a
bootstrap grant and invalidates existing sessions on their next request. A revoked account
cannot regain access merely by signing in again.

**Sign-in fails with "audience does not match this deployment"**
`GOOGLE_OAUTH_CLIENT_ID` is not the client id the browser used. Usually a second OAuth
client, or a copied id from another project.

**A provider says "set but empty"**
The secret exists with an empty version. `set but empty` is reported separately from `absent`
on purpose: they send you to different places.

**Logs**

```bash
gcloud run services logs read watchdog --region "$REGION" --limit 100
```

Credentials are redacted from every diagnostic sink by key *and* by value, so an upstream
error that interpolated your API key into its message is still safe to read.
