# Resident owner agent: bootstrap and source-review queue

Status: implementation and 24 isolated tests; NOT accepted on a real VM. No model inference, GCP operation or live Codex authentication was performed during development. This does not replace the product, desktop installers, scientific pipeline, or deployment gates.

## Entry point

From an authenticated Google Cloud Shell and this checkout:

```
python3 tools/resident_agent/cloud.py --project PROJECT --zone ZONE --instance INSTANCE --task-file /private/owner-task.md --source claude=DRIVE_FILE_ID --source openai=DRIVE_FILE_ID
```

Owner/project/source IDs and private instructions are runtime inputs, not bundled in this public repository. Uses existing IAP access; no firewall/IAM changes are made. Device authentication remains the owner's action. Drive access is optional and checked only after the resident agent is installed.

## Runtime

Files live in `~/devbox-agent`; `~/agent` opens a plain-language task console. Tasks execute serially using `codex exec` under workspace-write sandbox, approval policy never, and network access. Privilege-requiring operations are BLOCKED, not auto-approved. No public admin endpoint, remote-control pairing, desktop installation or avatar is claimed by this bootstrap. Native Codex TUI is a separate interface; coordinate writers before using it alongside queued jobs.

The user systemd service runs as the existing Linux user. A named `loginctl enable-linger` is attempted for persistence. Where unavailable, the fallback is a detached worker with NO reboot-persistence claim. Settings and owner instruction files are not reset. Helper releases are content-addressed; active workers are not forcibly restarted during an update. Restart after active work finishes to load a changed worker module.

Pending jobs survive restart. Jobs found running after interruption become needs-review and are NOT silently replayed. `completed` means Codex exited successfully, NOT that deployment or all acceptance criteria passed. Inspect the response and evidence. Max job time defaults to two hours, source-review calls to 300 per invocation; caches support explicit continuation without replaying successful model calls. No inference is performed by an idle queue service.

The installer requests a bounded three-hour keep-awake window through an already installed watchdogctl, if available. The persistent task heartbeat is OFF until the actual idle consumer is inspected and tested; file creation alone is not proof of protection. This integration is an onboarding task, not a completed live guarantee. No hibernation is promised.

## Exports and analysis

Private Drive originals are downloaded using Cloud Shell's authenticated gcloud account. Long-lived Google credentials are not copied to the VM. Transfer uses bounded retries, Range handling, size/MD5 checks and a SHA-256 check after SCP. VM filenames include content hashes; previous versions are retained. Detached Cloud Shell transfer survives browser disconnects, NOT termination of the Cloud Shell VM. Re-running reuses its private local cache where still present. SCP itself is not byte-resumable.

Source parsing preserves original ZIP files, complete conversation objects, ChatGPT branches, message IDs and available attachment/tool extracts. Broad selection includes agent mentions plus pitching/avatar synonyms. Missing or unsupported inputs are explicit. Claude project-document archives are transferred but not interpreted as conversation archives; original attachment bytes absent from the export remain a gap.

`review.py` discovers actual models through Codex app-server model/list. The small-family selector is a heuristic, not a claim about exact price; it is configurable. The deep selector requires an available Astra model and its highest returned reasoning effort. Unavailable models are not silently replaced. Review uses a separate local, private CODEX_HOME with tool integrations disabled, a file-backed owner auth copy, a read-only sandbox, complete chunking, structured outputs, message-ID and literal-quote validation, and content-addressed receipts. Real CLI capability/configuration acceptance remains untested; no unconditional security or account-availability guarantee is made.

Mixed/uncertain conversations are retained. No negative decision is made from an incomplete set of chunks. Cross-conversation reconciliation, exclusions audit and final specification are distinct tasks for the owner agent, not fabricated by concatenating extraction outputs. The public-facing pitching agent must have a separate restricted tool/permission profile from this administrator.

## Validation

```
python3 -m unittest discover -s tests -p test_resident_agent.py -v
bash -n tools/resident_agent/install_vm.sh
python3 -m py_compile tools/resident_agent/*.py
```

Development result: 24/24 isolated tests passed, including a real subprocess with a fake Codex executable, state preservation, interrupted-job handling, all-branch archive retention, attachment-only matches, no silent model substitution, full chunk retention, HTTP Range recovery and checksum rejection. These are NOT real provider, systemd, SSH, Drive or VM deployment tests. Product-wide CI was not run for this additive bootstrap; keep the PR draft until VM acceptance and review.
