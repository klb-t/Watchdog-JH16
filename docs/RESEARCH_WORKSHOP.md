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

Provide independently checked expected records as JSON strings or null. A passing exact
output comparison on a nonempty fixture is required to activate that exact candidate hash.
Tests, including failures, persist with raw input, expected output, actual output and hashes.
Later execution copies values deterministically without calling a model. History and JSON
exports remain available after reload, including the raw source and cell provenance.

JSON numbers remain lexical strings, preserving large integers, negative zero, trailing zeros
and exponent notation without floating-point conversion. Explicit null and an absent optional
field have different provenance. JSON spans use UTF-16 offsets into the archived source;
CSV provenance records row and column. Blank CSV records and quoted newlines are preserved.
Duplicate JSON keys, duplicate CSV headers, non-scalar fields and malformed row widths fail.
Numeric parsing, units and scientific analysis remain separate explicit operations.

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

## Verification and remaining scope

Integration tests exercise the owned AssistantService and real protocol adapters using
clearly fictional HTTP responses, plus real SQLite, HTTP routes and leased workers. They
cover source spans, failed/duplicate attempts, cancellation, lease recovery, budget routing,
bounded scheduling, ownership transfer, exact lexical copying and persistent trial history.
The Chromium flow uses the real built client/server for goal search, paper intake, a manual
parser, test/activation/execution, export, reload and mobile width. No paid account is used.

This is the connected intake/assessment/substitution/extraction stage. General paper-to-
executable-method compilation, automatic arbitrary replication, discovery/confirmation
partitions, comparison-family correction, hypothesis prioritization, project evidence graphs,
paper drafting and sandboxed generated modules remain open. Existing JH16 and workbench
execution are available independently; their results are not implied by a paper assessment.
