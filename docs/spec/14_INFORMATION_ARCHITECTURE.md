# 14 — Information architecture: seven areas, nested views

**Provenance.** Supplied by the owner on 2026-09-24: his own recollection of the product,
confronted with Astra's implementation, then checked by another model against the archived
conversations. Binding as an owner directive (D21). The full original note is preserved
below the summary.

## Summary (binding)

The engine is not simplified; the user's mental model is. Nothing is deleted: every
existing page, route, API, capability and workflow stays. What changes is how people
reach them — seven areas instead of a flat list mixing goals, workflow stages, domain
objects, implementation tools and diagnostics.

| Area | Answers | Existing views placed here |
|---|---|---|
| Dashboard | "What is happening, where should I go?" | Cele (`/`) |
| Data & Sources | "Find or add data" | Sources, Source access |
| Analysis | "Compute or draw something" | Workbench, Methods (Analyzers), Method review, Run history, Diagnostics (advanced) |
| Automation | "Make it happen regularly" | Automation |
| Research Projects | "I work on a specific study" | Study (JH16), Evidence review |
| AI Research | "Here is a paper, analyse / replicate it" | Research (paper & extraction workshop) |
| Knowledge Base | "Everything we know about X" | Substance memory, Responder |
| Settings (user menu) | — | Setup, People & access |

Rules:
- The navigation is data (`config/ui/navigation.json`), filtered by capability; an area
  appears when at least one of its views is available to the viewer.
- Every routed page belongs to exactly one area (a test enforces it). A page that does not
  fit is kept and placed provisionally — never removed for lack of a menu slot.
- Paths stay as they were in this first step (routing + navigation + composition refactor,
  not a rewrite); area landings (`/data`, `/analysis`, …) resolve to the first view.
- Runs remain first-class immutable objects; globally they are advanced history inside
  Analysis, contextually they belong to a project, analysis or automation.
- Roles and use-cases are presets over the same components (responder = a Knowledge Base
  preset), not separate applications.

Next steps recorded in the ledger (E7.x): a real Research Project container aggregating
existing objects (the JH16 project tree), Knowledge Base as a general explorer over the
shared model with Responder as a preset, a reviewer/publication projection of a project
(Article · Methods · Results · Sensitivity · Atlas · Provenance), contextual diagnostics
panels on runs, a dashboard that answers "what is happening", and presets for landing
pages and layouts.

---

## Original note (verbatim)

> WatchDog — UI / Information Architecture consolidation
>
> **Cel.** Uporządkować interfejs WatchDoga zgodnie z pierwotną koncepcją produktu. To NIE jest zadanie polegające na usuwaniu istniejących funkcji, ekranów, backendów, routes, modeli danych ani workflow. Zakładaj, że praktycznie wszystko, co obecnie istnieje, powstało z jakiegoś powodu i będzie potrzebne. Problemem jest przede wszystkim to, że kolejne moduły implementacyjne, etapy workflow i narzędzia pomocnicze zaczęły być eksponowane jako równorzędne pozycje głównej nawigacji. Należy więc: zachować istniejącą funkcjonalność; zachować routes/API/capabilities tam, gdzie nie ma technicznego powodu ich zmieniać; zachować historię runów, provenance, diagnostics, method review, evidence review itd.; przeorganizować sposób, w jaki użytkownik do tego dociera; scalać rzeczy w większe obszary funkcjonalne; używać nested views, tabs, panels, drawers, workflow steps i contextual navigation zamiast tworzyć osobną pozycję głównego menu dla każdego komponentu. Nie upraszczaj silnika. Upraszczaj jego mental model dla użytkownika.
>
> **Źródłowa koncepcja.** Ponowne przeszukanie archiwalnych rozmów Anthropic dotyczących WatchDoga potwierdziło, że pierwotny projekt miał relatywnie niewiele głównych powierzchni UI mimo bardzo szerokiego zakresu funkcjonalnego. Powtarzały się: dashboard, dane / źródła, analiza, wykresy i mapy, baza danych, automatyczne/cykliczne pobieranie danych, konfiguracja metodologii, replikacja prac naukowych, użycie LLM do analizy treści/metodologii publikacji, konfigurowalne presety dla różnych use-case'ów, wyszukiwanie wiedzy o substancjach, objawach, interakcjach itd. W jednej ze starszych struktur frontend był grupowany jako "dashboard / analysis / data / ...", a nie według każdego technicznego subsystemu. Inna rozmowa opisywała centralną bazę danych, do której wpadają źródła, a z której wychodzą: dashboardy, wykresy, mapy, raporty, analizy naukowe, zastosowania responderowe, replikacje, automatyczne monitorowanie. Jeszcze inna zakładała model: źródła → metodologia/analysis → ustawienia cyklicznego pobierania → Run → wyniki/replikacja oraz możliwość przekazania publikacji LLM-owi do analizy jej metodologii. Istotna zasada: «preset powinien być danymi/konfiguracją, nie osobnym kodem ani osobnym produktem.» To powinno dotyczyć również organizacji UI.
>
> **Docelowe obszary.** (1) **Dashboard** — stan systemu, ostatnie i aktywne projekty, ostatnie runy, aktywne automatyzacje, anomalie/alerty/sygnały, stan danych i źródeł, ostatnio odświeżone datasety, szybkie wejścia; odpowiada „Co się dzieje i gdzie powinienem teraz wejść?”. (2) **Data & Sources** — źródła, providerzy, adaptery, datasety, import, ręczne fetchowanie, konfiguracja źródeł, provenance, jakość, missingness, wymiary geography/language/source, lineage, raw/normalized observations, source history, dataset inspection; nested views (Sources, Datasets, Acquisition history, Provenance, Quality), ale globalnie jeden obszar. (3) **Analysis / Workbench** — wybierz dane → przekształć → wybierz metodę → ustaw parametry → uruchom → oceń diagnostykę → wizualizuj → zapisz; obecny Workbench, Analyzers/method registry, korelacje, statystyka opisowa, Pearson/Spearman/Kendall, regresja, bootstrap, permutacje, influence/leave-one-out, sensitivity, szeregi czasowe, lag/cross-correlation, geospatial, testy hipotez, PCA, metody przyczynowe tam gdzie uzasadnione, wykresy, mapy, tabele, diagnostyka. Analyzers, Diagnostics i Results nie są osobnymi pozycjami głównej nawigacji; wynik należy do konkretnej analizy/runu/projektu. (4) **Automation / Scheduled Operations** — cykliczne pobieranie, populowanie bazy, monitorowanie sygnałów, regularne analizy, odświeżanie wyników, okresowe artefakty, zadania projektu, przygotowanie materiałów do publikacji; te same AnalysisSpec i profile co ręcznie; jednorazowa analiza łatwo zamieniana w cykliczną. (5) **Research Projects** — kontener agregujący istniejące elementy (np. JH16 Replication / Update: pytania, publikacja źródłowa, źródła, metodologia, MethodSpecs, datasety, runy, wariant faithful i enhanced, sensitivity, evidence, figures, maps, tables, notes, provenance, draft paper, tasks, scheduled operations); Study, Research, Runs, RunDetails, EvidenceReview, MethodReview, Results stają się widokami/etapami projektu. Run pozostaje immutable obiektem; globalna historia runów może istnieć dla power-usera. (6) **AI Research / Replication** — upload paper/DOI/tekst → analiza metodologii → propozycja wykonywalnego planu → review → deterministic execution; identyfikacja danych i braków, mapowanie na primitives, propozycja MethodSpec i adapterów, human review, porównanie z publikacją, rozszerzenia, sensitivity, artefakty, draft; LLM nie trafia do numerical path; jeden spójny workflow, nie ekran na etap. (7) **Knowledge Base / Search** — explorer po substancjach, aliasach, slangu, pigułkach, składach, metabolitach, receptorach, objawach, działaniach niepożądanych, układach narządów, interakcjach, drogach podania, dawkach, trip reportach, sygnałach geograficznych, trendach, publikacjach, autorach, datasetach, evidence, relacjach i współwystępowaniu; nie tylko "SubstanceMemory". **Responder** = preset / role-oriented view Knowledge Base (ratownik: identyfikacja, skład, interakcje, objawy, działania pilne, provenance/confidence; policja/analityk: popularność, geografia, slang, sentyment, trendy, szlaki).
>
> **Settings / Setup / Administration** — pozostają, ale w Settings, user menu, sekcji admin lub konfiguracji kontekstowej.
>
> **Nie usuwaj zakresu.** MethodReview → panel w Analysis/Project; EvidenceReview → etap projektu/replikacji; Diagnostics → panel kontekstowy + advanced view; Analyzers → registry w Analysis; Results → widok runu/analizy/projektu; Runs → historia kontekstowa + global advanced; Responder → preset Knowledge Base; SubstanceMemory → część Knowledge Base; Study → Research Projects; Research → Projects + AI Research. Jeżeli ekran nie pasuje, najpierw go zachowaj, potem ustal miejsce. Nie stosuj „nie pasuje do menu → delete”.
>
> **Publication / Reviewer View.** Model z gałęzi Groka: Article · Methods · Results · Sensitivity · Atlas · Provenance — nie jako globalne ekrany, lecz jako projection pojedynczego Research Project / immutable run; obok Workbench view dla wykonującego badanie; czystszy, jak interaktywny paper; dla współautorów, reviewerów, naukowców z zewnątrz, publicznego udostępniania.
>
> **Presets zamiast produktów.** Różne role ≠ osobne aplikacje; Scientist, Responder, Police/analyst, JH16 replication, Substance surveillance — profile/presets/capabilities/configuration/saved layouts/workflows konfigurujące istniejące komponenty.
>
> **Nested IA zamiast flat menu.** Płaska nawigacja mieszała cele, etapy workflow, obiekty domenowe, narzędzia implementacyjne i widoki diagnostyczne. Przykład: Research Projects → JH16 Update → Overview, Source paper, Data, Method, Runs → Run 2026-09-24 → Results, Diagnostics, Provenance; Sensitivity, Figures, Evidence, Publication.
>
> **Zasada implementacyjna.** Najpierw routing + navigation + composition refactor, nie rewrite: re-use komponentów, nested routes, shared layouts, contextual tabs, drawers/panels, breadcrumbs, command palette, capability-aware navigation. Techniczne scalanie duplikatów dopiero później; nie mieszać z agresywnym cleanupem.
>
> **Kryterium powodzenia.** „chcę zobaczyć, co się dzieje” → Dashboard; „znaleźć / dodać dane” → Data; „coś policzyć / narysować” → Analysis; „żeby robiło się regularnie” → Automation; „pracuję nad konkretnym paperem/badaniem” → Projects; „wrzucam publikację” → AI Research; „wszystko, co wiemy o X” → Knowledge Base — a nie „czy mam szukać w Study, Research, EvidenceReview, MethodReview, RunDetails czy Workbench?”.
