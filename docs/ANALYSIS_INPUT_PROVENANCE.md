# Consumed analysis inputs

New legacy JH16 and approved MethodSpec runs record
`watchdog.analysis_inputs/1` in the existing immutable object store, as a
`normalized` artifact owned by their analysis run. This closes A4-WD-002's
source-run disclosure gap after acceptance gates. It does not change formulas,
method approval, missing-value policy, presets or provider budgets.

The source run is checked against the analysis owner before input acquisition.
The existing repository's normalized domain projection is captured once in its
observation-row order, with actual observation and series identifiers. The
executor consumes that detached input. The receipt binds canonical JSON domain
observations, row identities, per-series content hashes, source-run/config-hash
identity and the actual executor/method parameters. A MethodSpec receipt also
retains its exact reviewed definition, approval hash and typed input series.
This is a hash of consumed normalized inputs, not a claim to retain or hash raw
provider response bytes. Source-run configuration/provider credential bags and
arbitrary fetch metadata are not copied. Method parameters are retained exactly
as passed, including unknown fields; this is not a secret-removal filter, and
credentials in that contract must use credential_ref. Existing raw artifact
references remain references.

JH16's required `reference_scores` are passed directly from the captured method
parameters; that executor supplies no replacement reference set. A chart may
use that recorded set. It may not substitute today's global reference file.
The MethodSpec route records the actual typed-series/definition boundary; when
it did not consume a reference-score set, that scatter projection is explicitly
unavailable. Stored Pi/Hi charts remain available.

Receipt bytes are frozen before deterministic execution. After successful
execution, those bytes are put at their content address; one SQLite transaction
registers their artifact, analysis row and results. Validation/duplicate-input
failure produces no result or input artifact. Owner and active-run checks repeat
after awaited storage, before result publication. A successful object write
followed by a failed DB transaction may leave an unregistered content-addressed
object. It is retained, is not exposed as completed output, and is not silently
deleted or retried. Cancellation/failure cannot be overwritten by publication.
Manifest registration and the transition to `COMPLETED` share one transaction
after storage and an active `EXPORTING` check. If cancellation occurs during
that write, its terminal state remains, with no registered completed manifest.
The unregistered object may remain; earlier successfully computed results are
not erased when only the later manifest stage fails. A finalized manifest is
never replaced by re-executing a terminal run.

Manifest, results, JSON/CSV export, charts and all new narrative entrypoints use
one verified historical-input reader. It verifies object bytes, series and
analysis binding, method identity and ownership. Input flags/missing reasons
come from that receipt, not from current source rows. Reopening does not fetch
providers or recompute results. Subsequent source changes do not rewrite the
historical input; source disappearance is separately recorded as unavailable
while the owned snapshot may remain readable. Source availability records
existence, not a claim to revalidate current source contents. A present source
owned by someone else prevents disclosure. The complete source set is checked
after the last awaited read, so a later receipt cannot invalidate an earlier
authorization unnoticed. Narrative provider readiness and artifact storage
repeat those checks before dispatch or publication.
The automatic narrative passes a trusted synchronous product guard to the
existing personal assistant. It runs after catalog discovery and immediately
before its existing budget reservation/model dispatch. A catalog GET may have
already occurred; it does not authorize disclosure of analysis inputs. An
authorization failure creates no model reservation and triggers no automatic
retry. Other assistant callers keep their existing behavior and ledger.

Historical runs are not backfilled. An absent, corrupt or unbound receipt gives
`input_evidence.status = unavailable`, never a fabricated zero missing count.
Stored result values remain readable/exportable. JSON represents unknown
`missing_observations` and `quality_flags` as null. CSV retains its numeric rows
and adds an explicit input-evidence section. Pi/Hi chart data remain available;
`INPUT_EVIDENCE_UNAVAILABLE` is a diagnostic legend code, not a scientific
quality flag. Each chart and its response expose the evidence status, and a
projection requiring unproven reference input is listed as omitted.

Current narrative templates require known input quality. New generation with
unknown evidence returns 409 before provider/ledger use. Previously archived
narratives and finalized manifests remain unchanged and readable. A different
summary strategy using only stored metrics with unknown input quality would
need its own explicit data/rendering contract; it is not implemented by a switch
or silent default. This is a reversible implementation boundary, not a new
scientific or privacy requirement.

Acquisition-only results still expose their actual current acquisition rows,
labelled `not_applicable/current_acquisition_rows` for *analysis* input evidence.
No scientific inference or immutable consumed-input claim is made for that path.

Acceptance tests live in `tests/integration/analysis_inputs.test.ts`; the
positive narrative integration now executes a real local analysis to establish
its input evidence. The public before fixture preserves numeric/missingness
outputs from both existing executors. Gate status is recorded in the B report;
test source alone is not evidence of a passing run.
