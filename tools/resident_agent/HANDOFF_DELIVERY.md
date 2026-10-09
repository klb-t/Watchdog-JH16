# Verified private handoff delivery — 2026-10-09

## The corrected gap

The previous Cloud Shell bootstrap sent an owner task and references to large exports,
but did not deliver the already prepared private reconstruction or its supporting
conversation package. A link in a ChatGPT answer was not a transfer to the VM.

`handoff.py start` now delivers the prepared package before calling `cloud.py`,
which installs/authenticates the resident agent and queues its task. The existing
queue, review helper and VM installer are reused, not replaced with competing daemons.

The public branch contains the mechanism and synthetic tests only. The owner's
source content, private Drive file ID and pinned archive digest are supplied through
the private delivery and the owner's one-paste launcher, not committed here.

## Execution order

1. Read the specified private Drive ZIP using the owner's existing gcloud credentials;
   request Drive authorization only if required. No sharing permissions are changed.
2. Verify the exact SHA-256, manifest schema, complete archive membership, sizes,
   per-file hashes, safe paths and regular-file types in Cloud Shell.
3. Resolve the actual target VM state and account home. Start/resume an existing
   stopped/suspended VM; do not delete, resize, reset, or create one.
4. Copy the package and verifier to an owner-only staging directory through SSH/IAP.
5. Repeat validation on the VM. Install the package in a versioned private directory
   under `~/devbox-agent/private/handoffs/<full-sha256>/`. Retain the original ZIP.
6. Write a transport receipt and workspace handoff index. Preserve prior owner
   instructions, back up AGENTS.md and append a bounded reference to the handoff.
7. Only after successful remote acceptance call the existing resident bootstrap.
   Its new task explicitly points to the verified full handoff, not absent attachments.
8. The existing bootstrap authenticates Codex as necessary, starts the per-user queue,
   launches the separate large-export transfer, and opens the owner's `agent>` console.

A failed package verification cannot queue the new onboarding task. This does not
stop an already-running, unrelated or older agent job. The package is verified and
installed; the transport receipt explicitly does NOT claim that an LLM has read it.
The receiving agent is instructed to record semantic acceptance separately.

## Preservation and scope

Existing settings.json and OWNER_TASK.md remain unchanged. A managed block is appended
to existing AGENTS.md without replacing the owner's other instructions; the original
is backed up. Earlier handoff versions are retained. Repeating the same delivery
reuses identical verified contents. A modified prior package is left intact and
raises an error rather than being overwritten. Task IDs remain content-derived by
the existing queue; already completed tasks are not replayed blindly.

The delivery does not reinstall the desktop stack, migrate the WatchDog database,
change firewall/IAM, grant unrestricted sudo, expose an administrator web endpoint,
or buy resources/API credits. The requested host work is delegated within the
existing agent permissions; actual privileged operations can still require owner approval.

## Prepared private payload acceptance

The real delivery ZIP was checked locally as well as the synthetic test fixtures:
24 total files, including the transport manifest. All 20 members of the earlier
prepared-materials archive were retained byte-for-byte. This includes the full
source reconstruction, 47 typed positions, four complete conversation objects,
readable transcripts, source manifests and the existing owner task. Three additional
context/task documents and the new transport manifest make the handoff explicit.

The 47 positions are not 47 automatically approved product requirements. The
reconstruction remains partial: cheap-model classification and full-corpus Astra
extraction have not been run by this handoff correction. The agent receives the
already completed work and the explicit outstanding work, not a false claim of
full OpenAI/Claude-history coverage. Large exports are fetched separately.

## Validation

47 isolated tests passed locally: the prior 24 resident tests plus 23 handoff tests.
Command: `python3 -W error::ResourceWarning -m unittest discover -s tests -p 'test_resident*.py' -v`.
Python compilation and `bash -n tools/resident_agent/install_vm.sh` passed.

Handoff tests cover exact contents, outer/inner checksums, missing/unlisted files,
duplicate names, path traversal, symlinks, expansion bounds, source-reference
validation, preservation, repeated delivery, retained versions and private modes.
A local transport simulation copies files and runs the real VM-side verifier in a
separate Python process. The final bootstrap call is reached only after its receipt
exists. A corrupted transferred ZIP prevents that bootstrap call entirely.

Not live-tested: SSH/IAP to the owner's VM, Google authorization in Cloud Shell,
Codex authentication/inference, user-systemd startup, desktop GUI or host operations.
The private Drive upload was separately confirmed and its metadata showed shared=false.
Product-wide CI was not run. These isolated changes use [skip ci] to preserve quota.

Published code/test payload at `1f0d73303d513dd9721744f756153ec500b6d1cf`.
Verified Git blob hashes against the locally tested files:
- handoff.py: `04c486b7cf24f8728540110ef65af89121beca4c`
- test_resident_handoff.py: `764b6c2ccef1327acb7bb4098bc6da9028c75fc9`

## Resume

Use the owner's latest one-paste launcher, not the older task-only snippet. On a
host-side block, inspect `state/handoff-receipt.json`, `workspace/HANDOFF_INDEX.md`,
and the existing queue state. Do not infer that copying succeeded from a Drive link
or that the agent read the source from a transport-only receipt.
