# WatchDog

Odtwarzalny warsztat pozyskiwania danych, analizy i badań z jawnym pochodzeniem. JH16 i substancje psychoaktywne są pierwszym zastosowaniem ogólnego silnika.

**Stan:** połączono RESEARCH/CLINICAL/OPERATIONS oraz wcześniej pominięte konta/mail, nawigację PL/EN i HTTPS. Wspólny lokalny odbiór: **613/613 testów**, typecheck i produkcyjny build. Historyczne CI `ca5645c`: 552/552 w obu bramkach oraz start i trwałość kontenera. Fikcyjny rdzeń kliniczny ma CLI; nie ma produkcyjnego przypadku/API/UI. Brak potwierdzonej instalacji na rzeczywistej VM.

**Przekazanie:** [GPT → Claude](docs/HANDOFF_2026-10-01_TO_CLAUDE.md). Claude przejmuje główny workflow po domkniętej konsolidacji. [Raport](docs/REPORT_GPT_2026-10.md) wskazuje dokładne SHA, konflikty i granice.

```bash
npm ci
npx playwright install --with-deps chromium
npm run demo:jh16
npm run clean && npm run test:all
npm run dev
```

Demo JH16 nie potrzebuje klucza. To self-check na liczbach z publikacji, nie niezależna replikacja. Testy przeglądarkowe wymagają Chromium z Playwright.

Działające zakresy: dane/wykresy/mapy, przegląd i aprobaty metod, pamięć źródeł, harmonogramy, projekty, wyszukiwanie, ekstrakcja JSON/CSV, wybrane operacje publikacji i zamrożone porównania skalarne. Nie oznacza to dowolnej autonomicznej replikacji, żywych Trends ani walidacji klinicznej.

[Historia i odtwarzanie](docs/history/EXPERIMENTS.md) · [liniowy rozwój main](docs/HISTORY_POLICY.md) · [Indeks dokumentacji](docs/README.md) · [rejestr zadań](docs/spec/07_EPICS_AND_TASKS.md) · [prywatna VM](docs/DEPLOY_GCP_VM.md) · [dostęp](docs/ADMISSION.md). Cloud Run pozostaje zablokowany do poprawnego rozwiązania trwałej bazy. Aktualne instrukcje agentów: [AGENTS](AGENTS.md), [CLAUDE](CLAUDE.md).

## Licensing

WatchDog is **source-available**, not OSI open-source. Noncommercial use is licensed under the PolyForm Noncommercial License 1.0.0; see `LICENSE`.

Commercial use requires a separate written license; see `COMMERCIAL_LICENSE.md`.
