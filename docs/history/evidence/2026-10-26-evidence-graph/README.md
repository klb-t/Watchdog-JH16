# Evidence graph: real-data check (2026-10-26)

**Data.** A copy of the audit instance, not the owner's VM:
- JH16: 28 runs from 25–26.10;
- CR2014: runs `7aa42db5` (refused by the provider) and `fcf2ed4a`.

**Code.** The local build before the commit, plus one wording fix for the zero-gap message, made after these screenshots.

**JH16.** 87 nodes, 182 edges, 1 gap.
- The gap is the diagnosis entry "Zmiana sposobu szacowania przez Google od 2014 r.", marked probable, which names no evidence.
- The claim `harm_index_vs_reference_pearson` shows every run that evaluates it, with its verdict: 1 reproduced (the recomputation of the paper's own data), 7 deviates, 5 not_computable.

**CR2014.** 33 nodes, 33 edges, 0 gaps.

**What the first build found.** The table of deviations in both manuscripts had no source. It now cites the dossier.

**Phone (390 px).** No horizontal scrolling of the page; the graph scrolls inside its card.

**Files.**
- `*_graph.json`: the API output.
- `*_desktop.png`, `*_phone.png`: screenshots.
- `graph_probe.cjs`, `graph_probe_log.txt`: the browser probe and its log.
