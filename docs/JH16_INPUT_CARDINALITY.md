# JH16 input cardinality correction (A4-WD-003, 2026-10-09)

The legacy `jh16_faithful` analyzer version **1.1.1** requires at most one
observation for each `(entityId, queryRole)` pair for the two consumed roles,
`popularity` and `harm`. This matches the existing reviewed MethodSpec consumer's
cardinality check. Distinct entities and the two different roles remain valid.
No new constraint is imposed on unrelated roles.

Validation counts observations before filtering missing values. Different
present values, equal present values, present/missing pairs and two missing
observations are all ambiguous inputs. The analyzer raises the existing
`Ambiguous JH16 input: multiple counts for one entity and dimension` diagnostic.
It never silently selects first/last, merges, averages or deduplicates rows.
Tuple-safe maps preserve independent entity and role identities.

The orchestrator already validates through the actual analyzer before creating
an analysis record or inserting results. An ambiguous analysis becomes `FAILED`,
with its existing failure evidence and all source observations retained; it has
no successful analysis rows, results or completed manifest. No automatic retry
or source/provider request is introduced. The existing reviewed MethodSpec
route keeps its own already-implemented rejection.

Unique inputs retain their exact metrics, missing/zero behavior, ordering and
correlations. Formulas, statistical functions, scientific reference data and the
locked JH2016 preset are unchanged. Analyzer registration, analysis records and
new successful manifests expose executor version 1.1.1 through existing fields.
This implementation revision deliberately differs from historical 1.1.0 evidence.

## Migration and alternatives

No storage migration runs and no historical records are rewritten. Previously
completed 1.1.0 results/manifests remain historical evidence of that executor;
they do not acquire the new validation claim. A correction uses a separately
identified run against unambiguous inputs. This change does not reinterpret or
remove the source observations needed to investigate an old result.

Explicit first/last/mean or other resolution strategies would require their own
versioned method contract and appropriate scientific approval. None is silently
chosen or exposed as a working switch here. Rejection aligns two existing
consumers and is a reversible implementation correction, not a new owner rule.

The acceptance fixture was captured before edits on `6be9aedf`: direct duplicate
permutations gave Hi 25 and 50, while the actual stored-source analyzer completed
and persisted a manifest. Planned regressions cover both roles and input orders,
equal/missing duplicates, exact unique-input baseline bytes, current MethodSpec
rejection, real store/reopen, retained source rows and executor provenance.
The current verification status is in the root B report; preparing these tests
alone does not constitute a passed gate.

A4-WD-002 remains open: source-run input hashes and missingness/quality disclosure
need a separate immutable-input provenance increment. This cardinality correction
does not claim to repair that manifest/export gap.
