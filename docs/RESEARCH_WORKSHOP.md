# Paper intake and deterministic extraction workshop

Open **Cele → Zaplanuj odtworzenie pracy** or `/research`. The goal search also leads to
substance memory, responder lookup, maps, figures, schedules, source review and diagnostics.
Its ten available actions come from `config/goal-navigation.json` and the account's actual
capabilities. Search is local keyword matching, not an autonomous natural-language planner.

## Add and inspect a paper

Save a title, source/DOI and the supplied text, paste a TXT/Markdown file, or transfer an
owned discovery from the literature queue. Declare full text, excerpt, abstract or identifier
only. The default is excerpt. Language and study geography are independent optional fields.
An identifier alone does not download a paper or imply full-text access. Each content version
is immutable. Discovered versions also retain the discovery hash and archived source receipt;
changed abstracts at the same URL create separate versions. Unchanged imports deduplicate.

**Oceń metodologię w ramach mojego budżetu** queues a real `paper_method` call through the
owner's selected provider, task profile, current prices and budget reservation. It analyses
at most the first 24,000 characters, records the excerpt length and truncation, and retains
the complete submitted text. The UI displays exact source quotations next to interpretations.
The response includes required inputs, proposed operations, missing detail, hypotheses and
possible data substitutes. Every quoted span must exist uniquely in the submitted excerpt;
unmatched or ambiguous quotes fail the attempt. A quotation match verifies the span, not
the model's interpretation, source reliability or replicability of the whole paper.

The output remains a proposal, with `NOT_YET_ESTABLISHED` replicability and execution disabled.
Operations are compared with the existing primitive registry. No new scientific operation,
expert response or empirical number is created by this assessment.

## Missing data and explicit variants

Choose a required input and fill in a substitute, its source or collection plan, the change
in construct/sample and the validation needed. The available kinds and explanations are a
versioned UI profile in `config/research-workbench.json`:

| Variant | Recorded interpretation |
|---|---|
| Original data reuse | Reanalysis; not independent replication |
| Other prior dataset | Exploratory method variant |
| Proxy measure | Exploratory variant requiring construct validation |
| New expert panel | Proposed collection; actual responses still required |
| Synthetic scenario | Simulation; not empirical expert evidence |

Variants pin the exact assessment hash and input identifier. A supplied dataset reference
is not automatically downloaded, validated or bound into an executable MethodSpec. Those
steps, frozen comparisons and independent confirmation are still prerequisites.

## Test a parser and copy values

The **Ekstraktory danych** tab supports JSON and comma-separated CSV. With no LLM key, use
the field-mapping form: name the output fields and their JSON Pointer paths or CSV headers.
Advanced users may import a strict `copy-plan-1` JSON profile. With a configured personal
LLM, **Zaproponuj parser** proposes the same profile from field names and structure. Source
cell values are omitted from that prompt; a key/header can itself contain user-written text.
The plan permits scalar selection only: no arbitrary scripts, constants or transformations.

Enter independently checked expected values in the record form and apply them, or paste
JSON strings/null in the advanced controls. Editing the form invalidates the previously
applied expectations until the new values are applied. A passing exact
output comparison on a nonempty fixture is required to activate that exact candidate hash.
Tests, including failures, persist with raw input, expected output, actual output and hashes.
Later execution copies values deterministically without calling a model. History and JSON
exports remain available after reload, including the raw source and cell provenance. A
readable result table exposes each cell's source location on click; the full technical
record is available separately in its debug disclosure.

JSON numbers remain lexical strings, preserving large integers, negative zero, trailing zeros
and exponent notation without floating-point conversion. Explicit null and an absent optional
field have different provenance. JSON spans use UTF-16 offsets into the archived source;
CSV provenance records row and column. Blank CSV records and quoted newlines are preserved.
Duplicate JSON keys, duplicate CSV headers, non-scalar fields and malformed row widths fail.
Numeric parsing, units and scientific analysis remain separate explicit operations.

## Continue from copied values into statistics

For an execution of an activated parser, open **Przygotuj te dane do analizy**. The form
uses the validated, hashed `config/extraction-dataset-ui.json` wording/choice profile and
maps source fields to named columns with explicit types, units, numeric semantics and an
optional empty-text-as-missing policy. Every field starts as text and evidence starts as
UNKNOWN. Fill the citation, measure, normalization and comparison scope. Language meaning
remains separate from geography. A one-field source gets an explicitly labelled text row
identifier; it is metadata, not a fabricated measurement. The API also permits choosing a
subset or multiple declared mappings of a copied field.

The versioned `decimal-roundtrip-binary64-1` policy accepts finite decimal values only when
their decimal value survives conversion and integers are in the safe range. It rejects
precision loss, underflow, locale guessing and overflow; keep those fields as text. Ordinary
decimals such as 0.1 still use binary floating-point in statistics, not arbitrary-precision
arithmetic. Original lexemes such as `1.00` and `-0` remain in the raw source. Absent fields,
explicit nulls and declared empty-text missingness retain different reasons.

The resulting owned dataset is PROPOSED and opens directly in `/workbench?dataset=…`.
Review its source, mapping, units and context before approval. Existing descriptive/Pearson/
Spearman methods then use the actual mapped values and retain their normal separate method
review. Parser activation and dataset approval do not upgrade the evidence classification.
This is a connection to existing statistics, not automatic compilation of a paper's method.

Datasets pin the execution/candidate hashes, copy plan, original UTF-8 source and field
mappings. Import replays copying and verifies every row; generic dataset JSON import cannot
claim someone else's execution or alter mapped values. Missing HTTPS citations use the real
`urn:sha256:` content identifier. Source dates record execution, not a guessed publication or
retrieval date. The complete source, including unselected fields, accompanies the dataset and
any later sharing/export; both forms expose this before publication.

Research ZIP exports include `extraction/source-copy.json`, `extraction/copied.json`, the
original JSON/CSV and `extraction/replay.cjs`. The standalone `verify.mjs` replays the same
versioned parser and numeric mapping locally, with no installed packages, database, LLM or
network access. It checks exact values and source spans as well as file hashes. Keep the
independently supplied package-manifest hash; internal consistency alone cannot authenticate
a replacement archive. Statistical results remain linked to their exact executor and inputs;
the portable verifier does not itself rerun statistical calculations.

## Reuse a mapping for subsequent files

After creating a source-copy dataset, give its mapping a name and choose **Zapisz mapowanie
jako szablon**. Templates are private, immutable versions tied to that exact activated parser
and originating dataset/execution hashes. Saving the same named snapshot again deduplicates;
another name or mapping creates a new version. They persist in SQLite and follow the supported
local-to-account ownership transfer without changing their content hashes.

For a later execution of the same parser, **Użyj wybranego szablonu** restores column names,
types, units, missingness policy, measure, normalization, language meaning and comparison scope.
Check that these settings still describe the new file. Templates exclude source observations,
citation, evidence classification and approvals. The current file keeps its own source ID and
raw values; a new dataset still needs its existing review. Applying is explicit and makes no
model call. A different parser version or changed review hash is rejected.

The new dataset records the template ID/hash and whether its mapping was subsequently edited.
The backend derives this modification flag from the stored template and actual final mapping;
it cannot be falsified through generic dataset import. The final mapping and raw source remain
inside the publication package for replay. The template's origin reference describes where
settings came from, not evidence that the new source has the same reliability or comparability.

Limits: 2,000,000 source bytes, 10,000 output rows, 30 fields, 64 JSON levels and 100,000 nodes.
Model structure discovery visits at most 500 paths and the first member of each array.
The HTTP JSON body limit is 2 MiB including expected output and encoding, so practical input
size can be lower; oversized requests return 413. A fixture test validates that fixture,
not all future pages. HTML, PDF tables and arbitrary generated adapters are not implemented.

## Repeated reviews and interrupted work

Automation can schedule **Ocena metodologii nowych prac przez LLM** daily or by interval.
Each job attempts at most one to five previously unattempted documents. Including discovered
abstracts is optional; selection is newest eligible document, not a claimed promise score.
This uses the owner's configured LLM budget and requires the server and persistent storage
to stay available. The existing source scan remains a separate keyless scheduled task.

Attempts and jobs are owner-scoped. Cancellation/revocation stops the next checkpoint,
records interrupted attempts and retains any cost reservation. An already transmitted
provider request may finish before the cancellation checkpoint. An expired worker lease
cannot leave a linked assessment permanently RUNNING. Repeating a default request never
automatically repeats an attempted assessment; a failed attempt needs explicit one-off retry.
Scheduled retry of a possibly billed failed request is rejected. Finished outcomes, source
versions and test records remain immutable, including after supported ownership transfer.
Workers claim only their supported job kinds. A public collection CLI leaves queued personal
model/catalog jobs for a worker with the corresponding registered handler.

## Verification and remaining scope

Integration tests exercise the owned AssistantService and real protocol adapters using
clearly fictional HTTP responses, plus real SQLite, HTTP routes and leased workers. They
cover source spans, failed/duplicate attempts, cancellation, lease recovery, budget routing,
bounded scheduling, ownership transfer, exact lexical copying and persistent trial history.
The Chromium flow uses the real built client/server for goal search, paper intake, a manual
parser, test/activation/execution, export, reload and mobile width. No paid account is used.
The source-to-statistics tests exercise numeric precision rejection, distinct missingness,
owner transfer during storage, unit requirements, actual paired analysis and offline export
replay. A second browser flow covers the mapping form, mobile width, exact dataset deep link,
review, analysis, ZIP verification and reload.

This is the connected intake/assessment/substitution/extraction stage. General paper-to-
executable-method compilation, automatic arbitrary replication, discovery/confirmation
partitions, comparison-family correction, hypothesis prioritization, project evidence graphs,
paper drafting and sandboxed generated modules remain open. Existing JH16 and workbench
execution are available independently; their results are not implied by a paper assessment.
