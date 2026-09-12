# Automation and substance memory

The Automation page runs bounded public-data jobs and stores UTC schedules in SQLite.
The production/development server owns the worker; closing the browser does not stop it.
The server and its persistent volume must remain available. Cloud services which suspend
the process or CPU require an always-running worker deployment; a saved schedule alone
does not make an ephemeral deployment a scheduler.

Daily UTC and anchored interval schedules are implemented. Missed occurrences coalesce;
an outstanding job suppresses overlap. Transactions and unique occurrence keys prevent
two workers dispatching the same occurrence. A renewable lease coordinates execution.
Expired running jobs become INTERRUPTED, with no silent replay of possibly completed
effects. Pause cancels queued occurrences; Stop requests cancellation at the next
acquisition checkpoint. Current principal activity and capabilities are checked during
execution. A later run can retry failed collection; existing observations are preserved.

Every job pins the validated, hashed source profile. Each HTTP response is archived before
parsing, including error responses. Receipts identify the exact URL, provider, timestamp,
adapter version, byte count, hash and attribution. Requests have time, byte, page and total
request limits. Shared source leases enforce pacing across worker processes using the same
database. Redirects and arbitrary paper-supplied endpoints are not followed. No paid calls
are made by the public reference/discovery adapters.

## Public adapters

| Provider | Implemented acquisition | Interpretation |
| --- | --- | --- |
| PubChem PUG REST | Compound properties and synonyms | One exact CID; complete InChIKey for subsequent joins |
| ChEMBL | Exact InChIKey molecule lookup and paged Ki/Kd/IC50/EC50 activities | Retains relations, units, target subtype names, assay descriptions, organism, variants, source validity and duplicates |
| Wikidata | Search candidates, verify InChIKey, store labels/claims/Wikipedia links | Multilingual entity reference; language does not identify geography |
| Europe PMC | Bibliographic lookup and paged discovery by first index date | Metadata counts are not SERP Ni, popularity or harm |
| arXiv | Atom metadata discovery by update window with pagination | Descriptive metadata; full text and code are not fetched/executed |

The versioned catalog is `config/automation.json`, with service documentation, attribution,
honest adapter status, default jobs and 20 chemical-name search seeds. Seeds contain no
invented measurements. BindingDB, IUPHAR and DrugBank remain explicit pending adapters.
The original `chemical_reference` source in the legacy JH16 run form remains unavailable:
this acquisition is accessed through Automation, not as a substitute for result counts.

Memory extends the existing `substances`, `aliases`, `external_identifiers`, `targets` and
`assertions` graph. Raw/source property records supplement it, rather than introducing
a second graph of drug relationships. A query name is acquisition context, not an automatic
synonym; class, plant/product, market label and molecule equivalence is not inferred.
Duplicate content is deduplicated; changed source activities remain separate assertions.
Ki/Kd binding records use BINDS_TO only for binding assays. Other assay readouts use MODULATES
without inferring an agonist/antagonist mechanism. Values are not averaged or converted
across measures. Censored values and missing units/organisms remain visible.

The memory UI offers target/assay text, measure and organism filters, original values,
source records and downloaded archived responses. Data are CURATED_SECONDARY/PROPOSED;
successful import is not scientific approval. They are public reference material, available
to responder and evidence-review profiles without a new prompt at every lookup. They are
not injected into the separately curated responder treatment/interaction projection.
Clinical assertions still require that projection's explicit source review.

## Discovery and autonomy

One selector expands substance-focused searches to all disciplines covered by the selected
repositories. That is not a claim to cover every publication worldwide. Repeated windows
deduplicate identical metadata; changed article versions remain separate. Page/request
caps produce visible PARTIAL coverage and continuation coordinates in job results.

The current screener records transparent text hints and concrete blockers: missing verified
input data, executable approved method, and preregistered claims/tolerances. DISCOVERED is
not a feasibility verdict. There is no automatic execution of code from a paper, no guessed
replication verdict, and no fabricated confidence score. Arbitrary paper-to-MethodSpec
compilation and autonomous hypothesis refinement are further stages. The existing numerical
executor and immutable JH16 benchmark remain the numerical path.

Discovered abstracts can now be transferred with their source-receipt lineage into the
[research workshop](RESEARCH_WORKSHOP.md). A separate scheduled paper-review task proposes
methodology and missing inputs through the owner's LLM budget. It does not replace keyless
literature scanning or declare that the discovered paper has been replicated.

For a bounded initial population on a local development instance:

```sh
node --import tsx scripts/populate_public.ts --allow-public-network caffeine naloxone
```

This uses the same durable queue, live adapters, receipts and memory as the UI. A source
failure is recorded, never replaced with fixture data. Unit/integration tests use explicitly
fictional fixtures and do not make external requests.
