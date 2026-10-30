# Access package: test on a copy of the owner's data (2026-10-29)

**Data and environment.**
- **Data:** a copy of the owner's backup `watchdog-data-before-5364332…-20261026T194907Z.tar.gz`, extracted locally on the VM. Before the test it held 7 runs and 1 vault entry, all owned by `local-user`.
- **Image:** the test image `watchdog-test:4e7f06b`, built with the full suite (676/676).
- **Container:** started like production (bind mount at `/mnt/watchdog`, read-only root, port 8199), in accounts mode with the owner's Google OAuth client id.
- **Owner sign-in:** an operator link (`watchdog-admin signin-link`). Google refuses origins it does not list, so Google sign-in itself can be checked only on the production origin after deployment.
- **Synthetic data:** none in the runs. The unknown applicant `nieznany@example.org` is a test address; its sign-in link was printed by the operator CLI.

**Result** (`probe_log.txt`; the owner's address is replaced by `<owner-email>`).

| Step | Observed |
|---|---|
| `claim-local-user` | the owner signs in as `local-user` and keeps the 7 runs |
| Invitation from the UI (`kind-bearer`, researcher, 3 uses) | link created |
| Guest opens it on a phone | no sign-in; guest `okaziciel 78c1dba1` with viewer; banner "researcher waiting" |
| Share by link of the owner's JH16 runs | the guest reads 6 runs, all marked shared, no share panel; no horizontal overflow |
| Administrator decides | sees the request with origin "bearer link" and the invitation id (`owner_application.png`); after approval the banner disappears and the guest has viewer + researcher |
| Unknown address signs in | lands on `/apply`; the API answers 403 |
| `/privacy`, `/terms` | readable without sign-in; contact and location taken from settings |
| Revoke the bearer link | the guest's next request answers 401 |

**Not tested live.**
- Google sign-in on the production origin.
- Removing basic auth in Caddy: a preview of the regenerated Caddyfile was refused by the agent's permission policy. The logic was reviewed by reading `aliases.sh`, which writes basic auth only for `auth=basic`.

Script for the owner: `scripts/owner_enable_accounts.sh`.
