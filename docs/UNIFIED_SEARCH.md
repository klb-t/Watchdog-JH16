# Unified metadata search

`GET /api/search` and `/search` search stored names, identifiers and metadata across
the existing reference catalogue and the signed-in principal's work. The profile in
`config/search.json` provides labels, query and response limits, a version and a
content hash. The default response contains 50 results; explicit pages support up
to 200. A result is a pointer to an existing record, never a generated scientific
answer or an inferred person index.

| Kind | Scope and gate |
|---|---|
| Substances, symptoms, molecular targets, appearance samples, market labels, interactions | `responder.lookup` sees approved field mappings and the existing public-source catalogue, including unapproved imported molecular measurement provenance; `evidence.review` can also discover proposed field mappings. A name result does not approve a measurement or clinical claim. Each supporting source's evidence tier and approval state remains separate. |
| Datasets | `workbench.view`; owned proposals additionally require `dataset.review`. Another owner's dataset appears only as a currently approved, explicitly shared aggregate. Revocation removes it on the next read. |
| Papers | `method.propose`; only the principal's saved documents and discoveries. Titles, identifiers, source, language, geography and discovery authors are searchable metadata. Source text and abstracts are excluded. |
| Runs | `run.view`; only the principal's runs. Type, identifier and status are searchable. Private configuration and outputs are excluded. |
| Schedules | `run.create`; only the principal's schedules. Stored hash, request kind, recurrence, next occurrence and substance name inputs retain their meaning. |
| Sources | `run.view`; the actual adapter registry with current credential-dependent availability, including explicit fixture, planned and blocked states. Registration does not establish availability. |

Capability bundles remain independent. Developer or administrator access does not
override ownership of private papers, runs, datasets or schedules. Unauthorized
explicit kind filters return 403; anonymous search returns 401. Unknown filters,
repeated query parameters and invalid pagination return 400. Responses are
`Cache-Control: no-store`.
If the configured maximum offset prevents another page, the response and UI
explicitly report that boundary while retaining the exact total. A narrower
metadata query can make the remaining records reachable.

Matching is a literal, case-insensitive substring after Unicode NFKC normalization.
Percent signs, underscores and SQL syntax have no wildcard or executable meaning.
Results are ordered by kind, normalized label and identifier using explicit code
point comparisons. There is no hidden relevance, credibility or clinical likelihood
score. Supporting source records stay individually attributable.

Links open the owned document, approved dataset, run or reference context. Opening
a saved paper verifies its full body hash in the existing document repository.
Search itself reads paper metadata and returns the stored version hash; it does not
claim to have rehashed the full source text. Appearance query links prefill the
responder form; inspection of the exact approved linked mapping is separate from
running a new lookup.
Molecular targets from ChEMBL activity records open the actual associated
substance memory with the exact target filter. Such records are not silently
treated as curated field mappings or as reviewed clinical recommendations.

## Current boundary

Pagination bounds response size. An exact total still scans the applicable stored
metadata and reference graph, so page size does **not** bound CPU or storage work.
Memory aliases and external identifiers are read in batches rather than once per
source receipt. Requested kinds skip unrelated public substance/target reads;
paper metadata is projected in SQL without transferring or rehashing full texts.
The implementation is appropriate for the present local catalogue. A persisted
search index with revision/approval invalidation and a query-work budget remains
needed before scaling to a large corpus. Such an index must preserve literal-match,
ordering, ownership and revocation behavior rather than truncating exact totals
silently.

The search catalogue deliberately has no people index and does not perform full
text retrieval, inferred entity resolution, or semantic expansion. Clinical claims
retain the responder's evidence exclusions when the exact reference is opened.
No foreign owner's private cells or paper text appear in result snippets.

Validation: `tests/integration/unified_search.test.ts` exercises role/owner gates,
approval and shared-aggregate revocation, source status, literal queries, query
validation, 205-paper pagination beyond old fixed listing windows, stable replay,
and tampered schedule provenance. Deep links are also exercised in the application
browser checks.
