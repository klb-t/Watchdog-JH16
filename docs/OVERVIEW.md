# WatchDog — project overview

WatchDog is a working research prototype that connects source material, extracted data, reviewed methods, execution and inspectable results. Its first application is monitoring psychoactive-substance signals; Jankowski & Hoffmann 2016 (JH16) is the initial numerical benchmark.

## The problem and the implemented flow

A result becomes difficult to assess when its source, transformations, dataset version or analysis settings disappear. WatchDog stores these connections and exports them with the result.

The implemented flow is: import or acquire source material; inspect its provenance; test an extraction profile where needed; define typed columns and missing values; review the exact analysis specification; execute deterministic code; inspect figures and results; export a package that can verify its own saved inputs and outputs.

Language models can propose specifications and text. Numerical results come from deterministic code operating on stored inputs. Changes to finalized artifacts create new versions; approvals bind to the exact content being reviewed.

## What exists today

| Area | Implemented capability | Boundary |
|---|---|---|
| Sources and collection | Source catalog, selected public adapters, recurring owned jobs, immutable acquisition receipts, version comparison and a watched-source reading queue | A catalog entry is not an implemented adapter; availability and credentials are explicit |
| Data and analysis | JSON/CSV import, tested copying/conversion, typed missingness, descriptive statistics, Pearson/Spearman, 2D/3D figures, maps and SVG/data export | Advanced methods and arbitrary generated extensions remain in the backlog |
| Research workspace | Owned versioned projects, literal search, source-linked paper operations, reviewed frozen scalar comparisons and portable verification | A scalar comparison does not replicate an entire publication |
| Access and operation | Email-code and Google sign-in, addressed/open invitations, access control, two navigation profiles, CLI, backup and isolated restore, optional HTTPS deployment code | Current live-VM, external SMTP/OAuth and certificate acceptance are outstanding |
| Field and clinical work | Source-linked field references and offline inspection; fictional clinical constraints and replay through a CLI | No real clinical validation or production clinical case API/UI is claimed |

The local application acceptance at product checkpoint `a0e061f` (original source `2c0e013`) is **613 passing tests, zero failed/skipped/cancelled**, including typechecking, a production build and browser flows with mobile layouts. Earlier GitHub Actions acceptance at `ca5645c` also exercised a real container and persistence. These are different checkpoints; [progress and evidence](PROGRESS.md) preserve that distinction.

## Demonstration

The keyless JH16 demo recomputes the paper's published values from its published inputs. It demonstrates a reproducible pipeline on those inputs. Fresh independent acquisition would be a separate study.


## Next product increments

The [canonical queue](spec/07_EPICS_AND_TASKS.md) covers general executable replication, confirmation partitions and comparison families, additional analysis methods, isolated extensions, remaining field/clinical integration and durable cloud storage. The completed synthetic G1–G3 research pilots stay on a separate branch with protocols, raw results, counterexamples and offline replay. They inform future design without silently becoming product features or scientific approvals.

## Repository and license

The main branch contains accepted product increments. Original source history and experiment packages remain accessible through archived refs and the [history catalog](history/EXPERIMENTS.md). [Current technical handoff](HANDOFF_2026-10-02_TO_CLAUDE.md) and [documentation index](README.md) provide the engineering details.

WatchDog is source-available under PolyForm Noncommercial 1.0.0. Commercial use requires a separate written license; see [LICENSE](../LICENSE) and [commercial licensing](../COMMERCIAL_LICENSE.md).
