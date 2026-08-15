# ADR 001: Architecture and Tech Stack Adaptation to AI Studio

## Context
The original WatchDog specification dictates a Python 3.11+ / FastAPI / Pydantic backend stack. However, the current target environment (Google AI Studio) provides a native Node.js / TypeScript environment with React for the frontend.

## Decision
**Adapt the implementation to the native AI Studio environment using TypeScript, Node.js, and Zod.**
Do not force Python into this sandbox. 

Treat Python 3.11+ / FastAPI / Pydantic in the specification as the preferred/reference production backend stack, not a non-negotiable architectural constraint. 

## Non-negotiable Constraints Applied to this Adaptation:

1.  **Preserve the architecture, not the language.**
    The strict separation of concerns (`API -> services -> domain -> adapters -> repositories/storage -> workers -> analyzers/exporters`) must remain exactly as specified in the original architecture documents.
2.  **Keep contracts language-neutral.**
    Versioned JSON Schema / OpenAPI / manifest schemas must be used for all important boundaries so that implementations can later be moved between TypeScript and Python without changing semantics.
3.  **Do not hard-code Node.js assumptions into the domain model.**
    `SourceAdapter`, `Analyzer/AnalysisEngine`, `Transform`, `Exporter`, storage, and job interfaces must remain replaceable and agnostic to the runtime.
4.  **Prepare explicitly for a Python scientific worker/service later.**
    The system must be able to delegate analysis jobs through a stable serialized job/result contract to an external Python process/service without redesigning the application.
5.  **Scientific semantics are non-negotiable.**
    Changing implementation language does NOT permit changing JH16 formulas, query definitions, statistical methods, missing-data semantics, provenance requirements, hashes, manifests, or reproducibility rules.
6.  **Never casually reimplement scientific algorithms merely because a JavaScript library exists.**
    For deterministic methods implemented in TypeScript, they must be validated against frozen golden fixtures/reference results. More advanced statistical, Bayesian, meta-analytic and time-series functionality may later be implemented by the Python scientific engine.
7.  **Storage and provenance formats must remain implementation-independent.**
    Raw fetch archives, observations, datasets, series, transform DAGs, analysis specs/results and research manifests must not contain language-specific serialized objects.
8.  **The development flight recorder/debugging contract remains fully mandatory.**
    TRACE instrumentation must cover the TypeScript implementation from the first phase exactly as specified in `14_DEBUGGING_AND_TRACEABILITY.md`.

## Consequences
- **Backend:** We will use a TypeScript backend (e.g., Express + Zod + tsx) running within the AI Studio sandbox.
- **Reporting:** When reporting progress, we will distinguish between the *architectural contract*, the *current TypeScript implementation*, and the *future/optional Python scientific backend*.
- **Development Velocity:** This allows immediate progress within the provided environment without fighting the sandbox, while keeping the door open for heavy scientific lifting in Python later.
