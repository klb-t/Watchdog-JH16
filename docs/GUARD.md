# Strażnik zasad (`npm run guard`)

Deterministyczny skrypt, bez modelu językowego. Dla każdej zasady z [PRINCIPLES.md](PRINCIPLES.md), którą da się sprawdzić mechanicznie, podaje dowód albo jego brak. Nie ocenia nauki, nie zatwierdza wyników i nie zastępuje testów.

| Sprawdzenie | Zasady | Kiedy pada |
|---|---|---|
| `inventory` | P01, P02 | Zniknęła trasa, endpoint API, uprawnienie lub migracja bez wpisu w `config/guard/removals.json` (z powodem i zatwierdzającym); zmieniono bajty istniejącej migracji; pojawiło się coś nowego, czego nie zapisano w `config/guard/inventory.lock.json` |
| `numerical-path` | P05, reguły 2 i 7 | Z modułów liczbowych (`policy.numerical.roots`) da się dojść importami do LLM lub narracji; w ścieżce liczbowej jest `Math.random` |
| `ci-not-skipped` | P07, P13 | Commit po `baseline_commit` ma `[skip ci]` i zmienia cokolwiek poza dokumentacją |
| `browser-launcher` | P07, P10 | Test przeglądarkowy uruchamia Chromium bez wspólnego `resolveChromium()` |
| `no-skipped-tests` | P07, reguła 8 | `test.skip`, `.todo`, `{ skip: true }` w testach |
| `ledger-ids` | P13 | Ten sam identyfikator zadania z dwoma znaczeniami w rejestrze |
| `manual` | P03–P14 | Nigdy nie pada: wypisuje, co trzeba sprawdzić przeglądem |

Raport: konsola i `test-artifacts/guard-report.md` (w CI w artefakcie `browser-evidence`).

## Typowe sytuacje

- **Dodałem stronę/endpoint/uprawnienie/migrację:** `npm run guard -- --update` dopisuje nowe pozycje. Aktualizacja odmawia, jeśli coś zniknęło albo migracja się zmieniła.
- **Coś naprawdę ma zniknąć:** wpis w `config/guard/removals.json`: dokładna pozycja z raportu, powód, kto zatwierdził, data. Bez powodu wpis się nie liczy.
- **Zmiana zakresu reguł** (nowy katalog liczbowy, inna baza commitów): tylko w `config/guard/policy.json`, nie w kodzie.

Kod: `scripts/guard/checks.ts` (czyste funkcje), `scripts/guard/run.ts` (CLI). Testy: `tests/unit/guard.test.ts` — każdy przypadek to wpadka, która rzeczywiście się w projekcie wydarzyła. Sprawdzone wstecz: na historii `31b813f..58a0c93` strażnik wskazuje wszystkie trzy commity z kodem i `[skip ci]` (`00a5b78`, `a0e061f`, `58a0c93`).
