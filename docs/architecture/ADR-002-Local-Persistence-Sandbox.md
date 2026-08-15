# ADR 002: Local Persistence Sandbox for AI Studio

## Context
Phase 2 of the WatchDog implementation requires establishing the Research memory and persistence spine, which the specification strictly defines as PostgreSQL/Alembic + MinIO/S3 + Parquet.
However, the Google AI Studio sandbox container environment is optimized for Node.js workloads and does not provide native daemon execution for Docker Compose, PostgreSQL, or MinIO.

## Decision
**We will use SQLite for the local development persistence backend and the local filesystem behind the object-storage abstraction.**
PostgreSQL and S3/MinIO remain the target production backends. The TypeScript contracts and repository layers will be strictly backend-agnostic so that they can be substituted without changing domain or scientific logic.

## Non-negotiable Constraints Applied:

1.  **Deduplication and Fetch History:** Identical raw payloads will deduplicate physically (by SHA-256) into a single content-addressed blob, while logical fetch events remain distinct.
2.  **WORM Semantics:** Finalized manifests and raw blobs are immutable. Code attempting to overwrite them will throw hard constraint violations.
3.  **ORM Abstraction:** Drizzle ORM is used because it naturally abstracts SQLite and PostgreSQL dialects under the same schema definitions and query builders, ensuring the exact same code will run in production against Postgres.
4.  **Object Storage Interface:** All interaction with raw blobs, artifacts, and manifests goes through an `ObjectStore` interface. The implementation in AI Studio is `LocalFileSystemStore`, which can trivially be swapped for an S3/MinIO driver via dependency injection.

## Consequences
- Unblocks Phase 2 and subsequent phases without requiring unsupported container services.
- Maintains strict adherence to WORM and scientific provenance semantics.
- Transitioning to production requires only replacing the Drizzle driver config and injecting the S3 adapter implementation.
