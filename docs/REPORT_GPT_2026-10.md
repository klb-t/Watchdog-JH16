# Rozliczenie pracy GPT i przekazanie Claude’owi — 1 października 2026

**Pakiet przekazania GPT → Claude.** Dokument rozlicza publiczny stan repozytorium, pierwotne pominięcia i ukończoną naprawę. Nie zawiera eksportów rozmów, danych prywatnych ani wyników innych projektów.

## Wynik końcowy

GPT ukończył E4.7/E7.7/E3.17 przed przekazaniem Claude’owi. Nowe konta i mail, oba profile nawigacji oraz kod HTTPS działają razem z nowszym main. Migracje 001–022 pozostały bez zmian; 023 i test wypełnionej bazy chronią historię i własność. Zachowano stare zaproszenia request-only, jawne granty i natychmiastowe cofnięcie, projekty/search oraz OPERATIONS. Po dodatkowym sprawdzeniu naprawiono również opis kont na Setup i odmowę CLI przy legacy override.

Pełny lokalny odbiór: **604/604**, zero fail/skipped/cancelled; typecheck i produkcyjny build. Rzeczywista VM, zewnętrzny SMTP/OAuth i certyfikat nie były odbierane. [Receipt i surowe wyniki](history/EXPERIMENTS.md), [przekazanie](HANDOFF_2026-10-01_TO_CLAUDE.md), [macierze](consolidation/admission.md).

**Dalsze tabele są snapshotem audytu sprzed naprawy**, przypiętym do `31b813f` i `9dea9aa`. Słowa „niescalone” oraz „następna czynność” w tych tabelach opisują tamten stan. Ich zakres zamykają powyższy odbiór i aktualny ledger; zachowanie tabel umożliwia rozliczenie pominięcia.

## Co sprawdzono

Odczyt wszystkich 10 zdalnych gałęzi WatchDoga, całej dostępnej historii 120 commitów, wszystkich 9 PR-ów, bieżących instrukcji, pakietów RESEARCH/CLINICAL/OPERATIONS i kodu rozbieżnych funkcji. Porównanie przypięto do `main` **31b813f47455adf58746a272fe1f3e7aecc01383** i Claude **9dea9aab41259770889f2798da49c0f8bb82ecba**. Snapshoty: [Git](audit/2026-10-01/git-inventory.json), [GitHub/CI](audit/2026-10-01/github-evidence.json), [próbne scalenie](audit/2026-10-01/merge-preview.txt).

Zakres dowodów publikowanych tutaj: wyłącznie kod, historia Git, publiczne PR-y/Actions oraz dokumenty już opublikowane w tym repozytorium. Oddzielny przegląd prywatnych materiałów nie jest częścią tego dokumentu.

## Odpowiedź na zarzuty Claude’a

| Twierdzenie w handoffie | Ustalenie z dowodów | Odpowiedzialność / skutek |
|---|---|---|
| Pominięto wcześniejsze logowanie i nawigację | **Potwierdzone.** Zmiany Claude’a z 24–25.09 nie są przodkami `main`; 30.09 powstały równoległe implementacje | Błąd integracji GPT. Wynik porównania wszystkich gałęzi powinien był poprzedzać implementację |
| Osiem commitów poza `main` | Osiem opisanych zmian plus wcześniejszy merge `6d83202`: `rev-list main..Claude` daje **9**; w drugą stronę **36** | Nie mylić liczby zmian tematycznych z liczbą commitów. Zachować oba rodowody |
| PR #2–#9 „closed, not merged” | **Nieprawda w odczytanym API.** Wszystkie mają `merged_at`; #9 = 2026-09-30 23:38:49 UTC; #6–#8 = 23:38:50 UTC | Nie wpisywać do dokumentacji, że GitHub uznał je za odrzucone lub niescalone |
| Podwójna migracja 020 | **Potwierdzone**, różne tabele i kontrakty; próbne scalenie wykrywa 22 konflikty | Nie zamieniać migracji 020 z `main`. Konsolidacja wymaga migracji addytywnej i testu istniejącej bazy |
| `main` nie wysyła maili i nie obsługuje linków otwartych | **Potwierdzone** w `docs/ADMISSION.md`, routerze i testach. Jest Google OIDC, wnioski, role i adresowe zaproszenia do wniosku | E4.5 było ukończone w zbyt wąskim zakresie. Brakujące rozszerzenie pozostaje jawnie otwarte |
| Nie ma żadnego użytecznego wejścia | Zbyt szerokie: działa lokalny właściciel i prywatny tunel; brak potwierdzonego prostego wejścia HTTPS dla zewnętrznego testera | Odróżnić działający kod od odbioru realnej instalacji |
| 424/424 na gałęzi Claude’a | Kod testów istnieje. Handoff raportuje pass; odczyt listy Actions tej gałęzi zwrócił 0 runów | Nie nazywać tego zweryfikowanym przez GPT CI ani wynikiem po konsolidacji |
| Duplikaty E2.1, E3.6 i rozbieżne E3.14 | **Potwierdzone**; dodatkowo historyczny ASTRA_PROGRESS używa innych dawnych przypisań | Naprawić aktywny rejestr z jawną mapą aliasów; zachować historię |
| Nie wykonano instalacji na VM właściciela | Brak dowodu wdrożenia w dokumentacji repo. Istnieje prawdziwy test kontenera, który nie dowodzi instalacji na VM | Nadal blokuje ogłoszenie gotowości dla zewnętrznego testera |

Nie da się ustalić z samego Git, czy wcześniejszy agent w ogóle odczytał daną gałąź. Można ustalić efekt: jej funkcje nie zostały uwzględnione w integracji. To wystarcza do uznania pominięcia bez zgadywania intencji.

## Gałęzie i PR-y

Wartość „poza main” oznacza liczbę commitów, których nie ma w przypiętym `31b813f`.

| Gałąź / head | Poza main | Wynik i zakres | Testy / granice |
|---|---:|---|---|
| `main` / `31b813f` | 0 | Dokumentacyjny checkpoint po #9 | Kod `ca5645c`, CI 552/552 w verify i container |
| `astra/watchdog-continuation-20260908` / `c3508c1` | 0 | Pion ratowniczy, warsztat, źródła, ekstrakcja, prace, harmonogramy, wdrożenie prywatne. #2 i późniejsze #4 zachowują historię; #1 historycznie otwarty na inną bazę | 373-testowy etap; CI `35829482923` wg checkpointu; brak rzeczywistej VM |
| `chore/repo-hygiene-2026-09` / `4b3d333` | 0 | #3: licencja, dokumentacja, porządek | Historycznie zmiana dokumentacji/scaffoldu |
| `astra/watchdog-integration-20260930` / `29b52a1` | 0 | #4: projekty, wyszukiwanie, admission, siedem sekcji, lokalne/globalne kandydatury | 419/419; pominięte rozszerzenia Claude’a |
| `codex/watchdog-wave1-20260930` / `a1449bd` | 0 | #5: parowanie encji, cofnięcie dostępu, kohorty publikacji, instalator | 434/434, kod `827fa11`; nie kończy ogólnej replikacji |
| `codex/watchdog-operations-20260930` / `92ae68b` | 0 | #8: backup, izolowany restore, awarie aktualizacji | 62/62 pakietu; 27/27 po integracji; katalog restore nie jest działającą VM |
| `codex/watchdog-research-20260930` / `93f98ed` | 0 | #7: E5.7d claim → review → freeze → nowy run → eksport | 457/457 pakietu; porównanie skalaru nie jest replikacją całej pracy |
| `codex/clinical-audit-20260930` / `0b013b5` | 0 | #6: E6.4a/b, E6.5a, fikcyjne przypadki i CLI | 91/91 pakietu; bez API, trwałego przypadku, UI i walidacji klinicznej |
| `codex/watchdog-integration-20261001` / `ca5645c` | 0 | #9: trzy pakiety, naprawa fałszywej prerejestracji i niesprawdzonego supersession | 552/552 w obu bramkach, rzeczywisty Chromium i kontener |
| `claude/ai-studio-last-commit-gjqxy4` / `9dea9aa` | **9** | Admission/mail, nawigacja, HTTPS i handoff | Niescalone; testy gałęzi nie są testami konsolidacji |

## Zachowane pakiety prac

| Pakiet w publicznym repo | Kod i dokumentacja | Granica |
|---|---|---|
| Kontynuacja 08–23.09 | ASTRA_PROGRESS.md; `ea88d8a`, `c3508c1` obecne w main | Stare blokery publikacji rozwiązane; VM osobno |
| Integracja 30.09 | #4/#5; SPEC_RECONCILIATION, DESIGN_RULES, handoffy | Rozbieżne rozszerzenia Claude’a pominięte |
| RESEARCH | #7; `da0b051`, `17518dd`, `bab9ad1`, `21ad029`; work_packages/RESEARCH* | E5.7d ukończone; E5.7b otwarte |
| CLINICAL | #6; `d0a228b`, `12ea359`, `5f8ab58`, `0b013b5`; work_packages/CLINICAL* | Syntetyczny rdzeń/CLI; bez produkcyjnego API/UI |
| OPERATIONS | #8; `32b4c0d`, `0e592dd`, `ef78636`, `92ae68b`; work_packages/OPERATIONS.md | Restore izolowanego katalogu; bez aktywacji VM |
| Wspólna integracja | #9, `c1e1c89`, `ca5645c`, `80a9725`, `31b813f` | 552/552 w obu bramkach, pełne rodzicielstwo pakietów |
| Dostęp i nawigacja Claude’a | `d448e59`…`0566d6a`, D20–D22, spec 14 | Istniejące funkcje wymagające konsolidacji |

Nazwy subagentów pierwszej fali są już zapisane w publicznym WORK_COORDINATION: `pipeline_audit`, `research_audit`, `security_review`, `ops_audit`, `clinical_scope`, `history_requirements`. Pakiety zawierają ślady przeglądów. Repo nie zawiera kompletnych transkryptów wszystkich subagentów; nie uzupełniamy ich domysłami.

## Osiem pominiętych zmian Claude’a

| SHA / data UTC | Zawartość | Następna czynność |
|---|---|---|
| `d448e59` / 24.09 | Backend identity/admission, kody, granty, zaproszenia, SMTP | Adaptacja do istniejącej 020 i 022; nowa migracja od 023 |
| `c1f65d3` / 24.09 | CLI operatora i komendy watchdogctl | Połączenie z bezpieczną aktualizacją i backupem OPERATIONS |
| `485455e` / 24.09 | Login/Join/Apply/PeopleAccess, profile PL/EN | Zachowanie wniosków, uprawnień i tras obu wersji |
| `cfb7fc7` / 24.09 | Testy maila, zaproszeń, browser resolver | Uruchomienie po adaptacji, nie kopiowanie starych wyników |
| `d25c621` / 24.09 | D20, ledger, runbooki | Zachowanie decyzji z dopisanym stanem integracji |
| `c5275db` / 24.09 | Siedem sekcji, Ctrl/Cmd+K, breadcrumb, EN, spec 14/D21 | Zachować `/projects` i `/search` z main; rozwiązać kolizję `/projects` |
| `0566d6a` / 25.09 | Caddy, sslip.io, HTTPS, D22 | Po działającym admission; bez nadpisania backup/restore/update |
| `9dea9aa` / 01.10 | Handoff i zarzuty | Zachować jako źródło historyczne, skorygować kierunek i błędy |

Osobno `6d83202` z 23.09 jest merge’em wcześniejszego main, a nie dziewiątą nową funkcją. Przy porównaniach występują wielokrotne merge-base; proste `diff main...Claude` może wciągnąć wcześniejsze porządki. Do przenoszenia służą przypięte commity i macierze cech.

## Co można faktycznie testować

| Poziom | Co jest dowiedzione | Czego to nie dowodzi |
|---|---|---|
| Lokalne dane fixture | JH16, warsztat, projekty, porównania i fikcyjny CLI działają w kontrolowanych testach | Nowych pomiarów, niezależnej replikacji, użyteczności klinicznej |
| Zintegrowane CI | API GitHub potwierdza sukces `36791873648`, head `ca5645c`, joby verify/container | SMTP, OAuth i certyfikatu na konkretnej VM |
| Kontener produkcyjny | Start/persistence są osobnym zielonym krokiem CI | Wdrożenia na maszynie właściciela ani pełnego restore tej maszyny |
| Tester z telefonu | Brak zachowanego dowodu działającego adresu, logowania i wejścia na realną instalację | Nie ogłaszamy „gotowe dla zewnętrznego testera” |

Odbiór zewnętrzny wymaga konkretnego HTTPS, logowania, poprawnie dostarczonego zaproszenia, dostępu właściwego profilu, odebrania dostępu oraz backup→restore na tej instalacji. SMTP „accepted” nie dowodzi doręczenia do skrzynki. Nie wysłano żadnych wiadomości do ludzi podczas tego audytu.

## Rzeczywiste braki

Konsolidacja maila/linków, nawigacji i kodu HTTPS jest zakończona. Przyjęte zachowania oraz ograniczenia są w macierzach i bieżącym handoffie.

Dalszy backlog: ogólny kompilator/replikacja prac, potwierdzające partycje i korekty rodzin porównań, HTML/PDF i izolowane rozszerzenia, pełny DAG i zaawansowana statystyka, żywe Trends, produkcyjny przypadek kliniczny, urządzenia, PostgreSQL i poprawna ścieżka Cloud Run. To zakres produktu, nie dowód zagubionego gotowego kodu.

Otwarte pozycje powyżej są dalszym rozwojem produktu. Odbiór realnej VM wymaga konkretnej instalacji. Brakujących transkryptów lub niewypchniętych plików nie da się zrekonstruować samym Git; nie przypisujemy im fikcyjnych wyników.
