# API and Job Contracts

Use `/api/v1` or equivalent versioned prefix.

## Auth
GET `/auth/login`, GET `/auth/callback`, POST `/auth/logout`, GET `/me`.

## Access admin
POST `/access/requests`, GET `/access/requests`, POST `/access/requests/{id}/approve`, POST `/access/requests/{id}/deny`.

## Sources
GET `/sources`, GET `/sources/{id}`, POST `/sources/{id}/validate-config`, POST `/sources/{id}/test-connection`, PUT `/sources/{id}/settings`.
Credential endpoint accepts secret but never returns it.

## Runs
POST `/runs/acquisition`, POST `/runs/analysis`, GET `/runs`, GET `/runs/{id}`, POST `/runs/{id}/cancel`, GET `/runs/{id}/manifest`, GET `/runs/{id}/artifacts`, GET `/runs/{id}/results`.
Creation should return quickly:
```json
{"run_id":"uuid","status":"QUEUED"}
```

## Presets
GET `/presets`, GET `/presets/{id}`, POST `/presets/{id}/validate-overrides`.
Locked preset overrides must be rejected.

## Schedules
GET/POST `/schedules`; GET/PUT `/schedules/{id}`; delete or auditable disable; POST `/schedules/{id}/trigger`; GET `/schedules/{id}/runs`.

## Analysis discoverability
GET `/analysis/capabilities`, GET `/analysis/{run_id}/results`.

## Exports
POST `/runs/{id}/exports`, GET `/runs/{id}/exports`, GET `/exports/{artifact_id}`.

## Summary
POST `/summaries`, GET `/summaries/{id}`. Inputs reference immutable analytical runs.

## Settings
GET `/settings/effective`, GET `/settings/config-health`, authorized org/user update routes.

## Stable errors
```json
{"error":{"code":"SOURCE_RATE_LIMIT","message":"Human-readable message","request_id":"uuid","details":{}}}
```
No stack traces in production responses.

## Idempotency
Run creation should support idempotency keys where practical. Same actor + same key + equivalent request returns original run.

## OpenAPI
Generate from FastAPI and diff in CI for unintended breaking changes.


## Datasets / transforms / series
GET `/datasets`, GET `/datasets/{id}`, POST `/datasets/import`, POST `/datasets/derive`, GET `/datasets/{id}/lineage`.
GET `/transforms`, POST `/transforms/validate`, POST `/transforms/run`.
POST `/series`, GET `/series`, GET `/series/{id}`, POST `/series/{id}/clone`.

## Generic analysis registry
GET `/analysis/methods`, POST `/analysis/validate`, POST `/analysis/runs`, GET `/analysis/runs/{id}`.
Methods advertise typed input contracts and parameter schemas.

## Figures
GET `/visualizations/types`, POST `/figures`, GET `/figures/{id}`, POST `/figures/{id}/clone`, POST `/figures/{id}/exports`.

## Research projects / literature / paper
GET/POST `/research/projects`, GET/PUT `/research/projects/{id}`.
POST `/research/projects/{id}/inputs`, POST `/research/projects/{id}/freeze-evidence`.
GET/POST `/research/projects/{id}/literature`.
POST `/research/projects/{id}/drafts`, GET `/research/projects/{id}/drafts/{version}`, POST `/research/projects/{id}/validate-draft`.
Refreshing data creates new evidence/draft lineage; never overwrites a frozen version.
