# GPT → Claude — WatchDog: przekazanie po odzyskaniu pracy

Stan sprawdzony 3.10.2026. Konsolidacja produktu, poprawki dostępu i recovery oraz trzy pilotaże są zakończone i opublikowane. Końcowy porządek dokumentacji jest osobnym przyrostem; nie stanowi odbioru rzeczywistej VM ani aprobaty naukowej. Nie potwierdzono przeczytania tego dokumentu przez inną sesję Claude’a.

## Punkt startowy

Przeczytaj [opis projektu](OVERVIEW.md), [przyrosty](PROGRESS.md), [raport gałęzi](REPORT_GPT_2026-10.md), [stan](spec/00_STATE_AND_DECISIONS.md) i [jedną kolejkę](spec/07_EPICS_AND_TASKS.md). Przed edycją sprawdź status oraz wszystkie aktualne zdalne refy; kod i konkretne dowody mają pierwszeństwo przed starymi claimami.

| Pakiet | Trwały commit | Oryginalny checkpoint |
|---|---|---|
| Poprawki produktu na main | `a0e061f78dfd46fab3c13381e24f5aa5299ccfd1` | `2c0e0135cb80105c400fe1ec1a9953aeb8eaf0a4` |
| G1–G3, research/gpt-pilots-20261002 | `9c562d8d20ea2e129b44062080c138cb2adb1ceb` | `7346f0a0d6d397e6e3e2efcc60d92dfd15dd81b6` |
| Oryginalne commity i instrukcja odzyskania | `a683082ca630e1c6e1e2eb09a7e3ca10e7b4dfb3` | archive/2026-10-02/original-checkpoints |

Publikacja przez API zmieniła metadane commitów, zachowując dokładnie drzewa produktu i badań. Oryginalny `2c0e013` nie jest przodkiem zdalnego main; jego identyczne drzewo jest w `a0e061f`. Oryginalne tożsamości są odtwarzalne z [bundle i instrukcji](https://github.com/klb-t/Watchdog-JH16/tree/a683082ca630e1c6e1e2eb09a7e3ca10e7b4dfb3). Wymagany przodek `61daefd` jest w historii repo. Nie utworzono anotowanych tagów ani nie zmieniono dawnych merge’ów.

## Ukończony produkt

- RESEARCH, CLINICAL i OPERATIONS były scalone przez #9. Nie implementuj ponownie dawnych przydziałów.
- E4.7: konta/email/Google, zaproszenia, role, cofnięcie dostępu i SMTP; jawna błędna konfiguracja OIDC odmawia startu, konflikty legacy grantów są obsłużone.
- E7.7: siedem obszarów, dwa profile grupowania, PL/EN, command palette i breadcrumb; dotychczasowe ekrany i deep links zachowano. Nie oznacza to tłumaczenia każdego ekranu.
- E3.15/E3.17: backup, izolowany restore, locking, update/recovery, instalator i opcjonalny HTTPS. Wszystkie komendy CLI korzystające z bazy respektują recovery marker. Odbiór realnej VM jest nadal otwarty.
- E5.7d: claim/review/freeze, świeży trwały attempt i weryfikowalny pakiet. To zamrożone porównania skalarne; ogólna replikacja publikacji pozostaje otwarta.
- Dane/źródła/projekty: import i ekstrakcja JSON/CSV, jawne missingness, statystyka, wykresy i mapy, immutable revisions, literal search, export i replay.
- CLINICAL: fikcyjne reguły i przypadki, jawne zależności, braki i CLI. Produkcyjne API/UI przypadków oraz walidacja kliniczna pozostają otwarte.

## Odbiór i zachowane dowody

Oryginalne receipts z 1.10 i 2.10 zachowano bez zmian. Odbiór poprawek ma 613/613; zachowany późniejszy pełny log również ma 613/613, typecheck i build dla nazwy pakietu `watchdog-jh16`. [Receipt domknięcia](history/evidence/2026-10-02-completion/receipt.json) wyraźnie opisuje odzyskanie zapisanych logów, a nie nowy przebieg 3.10. Manifest 402 plików sprawdzono względem oryginalnego checkpointu; poza trzema polami nazwy pakietu bajty kodu, zależności i skryptów są identyczne. Nowy manifest przygotowano podczas audytu, nie retroaktywnie w chwili wykonania testów.

[Manifest historii](history/evidence/2026-10-02-completion/history.json) zachowuje 120 dawnych commitów, źródłowe heads i archiwum. [Zapis publikacji](history/evidence/2026-10-02-completion/publication.json) rozdziela oryginalne i trwałe SHA. Dokumentacyjne commity nie dziedziczą CI innych wersji. Nie twierdź, że odzyskano wszystkie transkrypty lub dawną runtime bazę akwizycji z PR #1.

## Badania poza main

[Rejestr G1–G3](PARALLEL_RESEARCH_GPT.md) prowadzi do pełnych protokołów, kodu i raw. Sprawdzono wszystkie 43 pozycje manifestu. Zachowane logi potwierdzają replay: G1 7/7 kontroli, oba G2 identyczne i G3 10 000 identycznych prób. Nie nadpisano pierwotnych wyników.

Zachowaj kontrprzykłady: identyczny hash treści nie jest liczbą niezależnych obserwacji; heurystyka pokrycie/koszt nie daje optimum; holdout nie jest zawsze lepszy od korekty wielokrotności. Są to syntetyczne pilotaże algorytmiczne. Ich zapis nie integruje algorytmów do produktu ani nie zamyka E5.7b/E6.5.

## Kontynuacja

Pierwszy dalszy rozwój produktu: E5.7b, zgodnie z ledgerem — role danych, zamrożone protokoły i rodziny porównań. Realna VM/SMTP/OAuth/HTTPS potrzebują konkretnej instalacji i konfiguracji. Cloud Run pozostaje zablokowany do poprawnego trwałego backendu; PostgreSQL jest planowany. Zachowaj locked JH16, jawne braki, deterministyczną ścieżkę liczbową i niezmienne provenance.

Rutynowa implementacja i integracja są upoważnione. Nowe wydatki, rzeczywiste dane pacjentów, wiadomości do ludzi i aprobaty naukowe wymagają odrębnej podstawy. Zapisuj małe, sprawdzone i opublikowane checkpointy; istotny stan musi być w repo.
