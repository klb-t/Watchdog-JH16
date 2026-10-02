# GPT → Claude: przekazanie prowadzenia WatchDoga

**Claude przejmuje główny workflow po domkniętej konsolidacji.** GPT odpowiada za poniższy audyt, naprawy, dokumentację i odbiór. Dawny dokument TO_GPT jest zachowany w historii; nie wyznacza aktualnego kierunku.

Opublikowany odebrany commit: `00a5b789fb8b35ada8ef7e73b1fcb7290258841d` (jeden rodzic; tree zgodne z lokalnym odbiorem). [Protokół publikacji](history/evidence/2026-10-01/publication.json) potwierdza oba archiwalne refy, 120 zachowanych commitów i zamknięcie przestarzałego draftu #1. Późniejsze commity dokumentacji nie zmieniają tego przypięcia testów.

**Uzupełnienie 2.10:** [dokończony odbiór po wznowieniu](RESUME_2026-10-02.md) usuwa trzy luki; nowy pełny gate **613/613**. Historyczne 604/604 poniżej dotyczy pierwotnej konsolidacji.

## Co odbierasz

- **E4.7:** email-code i Google, adresowe/otwarte zaproszenia, SMTP, blokowanie, generacje sesji i CLI. Jawny tryb accounts; stare OIDC, request-only tokeny, trwałe override i ochrona zarządzającego pozostają. Nowa migracja 023; bajty 001–022 niezmienione. Nowy `access_admin` zamiast rozszerzenia starego `admin`.
- **E7.7:** wspólne trasy i zdolności, dwa profile grupowania main/Claude, PL/EN, palette i breadcrumb. Rzeczywiste `/projects` i `/search` zachowane. Język nawigacji nie oznacza pełnego tłumaczenia całego produktu.
- **E3.17:** Caddy/public host/sslip.io, operator accounts/mail, blokada public local-user. Zachowane domyślne main, pinned release, locking, backup/update/recovery i izolowany restore. Certyfikaty proxy wymagają ponownego pozyskania po restore.
- RESEARCH/CLINICAL/OPERATIONS odebrane wcześniej przez PR #9 pozostają; nie implementuj ich od nowa z historycznych przydziałów.

**Wspólny clean gate: 604/604**, zero fail/skipped/cancelled; typecheck i produkcyjny build, oba protokoły dostępu, pełne stare testy i nowe regresje. Dodatkowo produkcyjny CLI na izolowanej bazie, JH16 i fikcyjny clinical replay. [Dokładne dowody](history/EXPERIMENTS.md), [receipt](history/evidence/2026-10-01/receipt.json).

## Źródła i odpowiedzialność

Baza main: `31b813f47455adf58746a272fe1f3e7aecc01383`. Źródło Claude’a: `9dea9aab41259770889f2798da49c0f8bb82ecba`, w tym backend `d448e59`, CLI `c1f65d3`, UI `485455e`, testy `cfb7fc7`, dokumentacja `d25c621`, nawigacja `c5275db`, HTTPS `0566d6a`, handoff `9dea9aa`. Wszystkie 10 źródłowych gałęzi / 120 commitów ujęto w manifestach; archiwalne refs chronią oba rodowody bez merge’a do nowej linii main.

Zarzut pominięcia funkcji Claude’a był zasadny; GPT naprawił brak integracji. Twierdzenie „PR #2–#9 closed, not merged” było sprzeczne z API: mają `merged_at`; #6–#8 zachowały historię przez #9. Pełne rozliczenie: [raport](REPORT_GPT_2026-10.md). Wynik 424/424 z dawnego handoffu to jego historyczna deklaracja, a nie obecny receipt.

## Pierwsze kroki prowadzącego

1. Fetch wszystkich refs, porównaj bieżący main z receipt i sprawdź lokalny status. Nie zastępuj nowszego heada kopią tego dokumentu.
2. Przeczytaj [ledger](spec/07_EPICS_AND_TASKS.md), [stan](spec/00_STATE_AND_DECISIONS.md), [historię i liniowy main](HISTORY_POLICY.md) oraz [koordynację](WORK_COORDINATION.md).
3. Jeśli masz właściwą VM i podstawę do jej obsługi: wykonaj osobny odbiór instalacji według [runbooka](DEPLOY_GCP_VM.md). W przeciwnym razie kontynuuj pierwszą rzeczywiście otwartą, niezablokowaną pozycję ledgeru. Kod HTTPS sam nie dowodzi wdrożenia.
4. Przyjmuj z bocznych gałęzi tylko odebrane przyrosty. Nowe commity main są liniowe; istniejąca historia nie jest przepisywana. Źródła/negatywne wyniki zostają w archiwum.

## Granice, których nie wolno zgubić

Nie wykonano odbioru realnej VM, zewnętrznego maila/OAuth ani certyfikatu. Nowy odbiór jest lokalny; wcześniejsze Actions `36791873648` dotyczą `ca5645c` (552/552 verify i container). Cloud Run nadal wymaga poprawnej trwałej bazy. JH16 to `pipeline_self_check` na liczbach publikacji, nie niezależna replikacja. CLINICAL pozostaje fikcyjnym rdzeniem/CLI bez produktu API/UI i walidacji medycznej. Ogólna replikacja E5.7b i szerszy backlog nie są zamknięte przez scalar comparison.

Odtworzono dostępną historię Git i zachowane artefakty; repo nie posiada kompletnych transkryptów wszystkich rozmów ani niezapisanych plików po zawieszeniach. Braków nie uzupełniono domysłami. Publikacja handoffu nie potwierdza, że inna sesja Claude’a już go przeczytała.

GPT zachowuje osobne, **jeszcze niewykonane** protokoły [G1–G3](PARALLEL_RESEARCH_GPT.md): lineage i niezależność dowodów, pokrycie zależności przy koszcie pomiarów, eksploracja kontra zamrożona ocena. Wyniki wracają do Claude’a jako przypięte, odtwarzalne pakiety, bez równoległego przejmowania plików produktu.
