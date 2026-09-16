# Target Repository and Component Tree

```text
watchdog/
├── README.md
├── LICENSE
├── Makefile
├── docker-compose.yml
├── .env.example
├── .gitignore
├── .dockerignore
├── config/
│   ├── core/{application,authentication,features}.json
│   ├── ui/
│   │   ├── theme.json
│   │   ├── components.json
│   │   ├── navigation.json
│   │   └── dashboards/{default,researcher,medical}.json
│   ├── sources/                 # registry entries: SERP, Trends, PubChem, literature, forums, institutional, lab, manual...
│   ├── presets/{jh16-faithful,jh16-enhanced,jh16-longitudinal}.json
│   └── export/formats.json
├── schemas/
│   ├── application.schema.json
│   ├── ui-navigation.schema.json
│   ├── analysis-preset.schema.json
│   ├── source.schema.json
│   └── run-manifest.schema.json
├── backend/
│   ├── Dockerfile
│   ├── pyproject.toml
│   ├── alembic.ini
│   ├── alembic/
│   └── watchdog_api/
│       ├── main.py
│       ├── config/{loader,models,canonicalize}.py
│       ├── auth/{oauth,deps,permissions,sessions}.py
│       ├── routes/{auth,access,runs,data,schedules,analysis,sources,summary,exports,settings}.py
│       ├── domain/{runs,substances,observations,evidence,errors}.py
│       ├── services/
│       │   ├── acquisition.py
│       │   ├── normalization.py
│       │   ├── run_orchestrator.py
│       │   ├── manifests.py
│       │   ├── schedules.py
│       │   ├── exports.py
│       │   ├── summaries.py
│       │   ├── audit.py
│       │   └── analytics/{jh16,correlations,trends}.py
│       ├── sources/{base,registry,serp,google_trends,pubchem,literature,community,lab,institutional,manual}.py
│       ├── storage/{object_store,s3,parquet,artifact_paths}.py
│       ├── db/{base,schema}.py + models/ + repositories/
│       └── utils/{hashing,time,idmap}.py
├── worker/
│   ├── Dockerfile
│   └── watchdog_worker/{main,scheduler,tasks,job_backend}.py
├── frontend/
│   ├── Dockerfile
│   ├── package.json
│   ├── app/
│   │   ├── dashboard/page.tsx
│   │   ├── data/page.tsx
│   │   ├── schedules/page.tsx
│   │   ├── analysis/page.tsx
│   │   ├── sources/page.tsx
│   │   ├── summary/page.tsx
│   │   ├── settings/page.tsx
│   │   ├── runs/[id]/page.tsx
│   │   ├── login/page.tsx
│   │   └── access/{request,admin}/page.tsx
│   ├── components/
│   │   ├── config-renderer/
│   │   ├── forms/{EnginePicker,HarmPatternInput,TrendsParams,JHOptions}.tsx
│   │   ├── charts/{TrendChart,ScatterPlot}.tsx
│   │   ├── tables/{JHMetricsTable,CorrelationsTable}.tsx
│   │   └── provenance/
│   └── lib/{api,types,config}.ts
├── tests/
│   ├── fixtures/{jh16,providers}/
│   ├── unit/
│   ├── integration/
│   ├── contract/
│   ├── scientific/
│   └── e2e/
├── infra/{postgres,minio,nginx}/
└── docs/{architecture,scientific-method,provenance,api,operations}.md
```

## Dependency direction
Allowed:
`routes -> services -> domain/repositories/adapters`
`worker -> services`
`adapters -> providers`
`repositories -> DB/storage`
`frontend -> HTTP API`

Avoid routes doing SQL, frontend calling provider APIs, analytics calling provider SDKs, source adapters calculating scientific metrics, or LLM code mutating analytical results.


## Research-workbench modules to include
The exact physical tree may differ, but responsibilities must exist and remain separated:
```text
backend/watchdog_api/services/
  datasets/
  transforms/
  series/
  analysis_registry/
  visualizations/
  literature/
  research_projects/
  paper/
  community_semantics/
  evidence_graph/
  geography/
backend/watchdog_api/storage/
  raw_content_addressed/
  parquet/
  object_store/
frontend/app/
  data/explorer/
  data/series-builder/
  analysis/workbench/
  analysis/correlation-lab/
  analysis/visualizations/
  research/projects/
  research/paper/
config/
  sources/
  transforms/
  analysis/
  visualizations/
  research/
```
Do not duplicate business logic between JH16-specific pages and the generic workbench. Presets compose generic contracts.
