# Katalog dowodów i odtwarzanie WatchDoga

Ten katalog rozdziela badanie naukowe, demonstrację programu i test integracji. Obejmuje wszystkie odnalezione pakiety repo oraz wyniki obecnego odbioru; nie jest eksportem każdej rozmowy. Dokładne źródłowe commity: [manifest 120 commitów](../audit/2026-10-01/git-inventory.json), publiczne PR/CI: [snapshot API](../audit/2026-10-01/github-evidence.json). Brak zachowanego surowego wyniku jest oznaczony, nie uzupełniony wygenerowanymi danymi.

| Pakiet | Źródło / zachowane dowody | Replay i granica |
|---|---|---|
| Dawne fale produktu | Handoffy w tym katalogu, [ASTRA_PROGRESS](../ASTRA_PROGRESS.md), manifest Git | Checkout dokładnego SHA; lockfile i testy z tego SHA. Historyczne liczby testów nie są dzisiejszym wynikiem |
| RESEARCH E5.7d | `93f98ed`, integracja `ca5645c`; [checkpoint](../work_packages/RESEARCH_CHECKPOINT_2026-09-30.md), [pakiet](../work_packages/RESEARCH.md) | Scientific/integration/e2e `paper_comparison(s)` w pełnym gate: claim/review/freeze/fresh attempt/ZIP. Syntetyczne dane, nie replikacja dowolnej pracy |
| CLINICAL E6.4a/b, E6.5a | `0b013b5`, integracja `ca5645c`; [audyt](../work_packages/CLINICAL_AUDIT_2026-09-30.md), [pakiet](../work_packages/CLINICAL.md) | `demo_clinical.ts`; nowy surowy `clinical-case-a.json` zawiera recipe, hash, archive, replay i revocation probe. Wyłącznie fikcyjne przypadki |
| OPERATIONS | `92ae68b`, integracja `ca5645c`; [pakiet](../work_packages/OPERATIONS.md) | `operations_backup.test.ts`, `operations_update.test.ts`, `gcp_vm.test.ts`; rzeczywiste lokalne archiwa i izolowany filesystem, polecenia hosta zastąpione kontrolowanymi atrapami. Nie VM |
| Claude: konta/nawigacja/HTTPS | `9dea9aa`; [oryginalny handoff](CLAUDE_HANDOFF_2026-10-01_TO_GPT.md), [macierze](../consolidation/admission.md) | Historyczne 424/424 jest deklaracją autora; brak runów Actions tej gałęzi w audycie. Zintegrowany kod ma nowy własny gate |
| Baza przed konsolidacją | `31b813f`, logs `baseline-failed.txt` i `baseline-recovered.txt` | 525 pass / 27 braków Chromium → 552/552 po naprawie runtime. Żaden test nie wyłączony |
| Wspólna konsolidacja E4.7/E7.7/E3.17 | [receipt](evidence/2026-10-01/receipt.json), `source-sha256.json`, `consolidated-gate.txt` | 604/604 + typecheck/build. Oryginalne 552 i 52 nowe. Nowy odbiór lokalny; bez przypisywania historycznego CI do nowego kodu |
| JH16 self-check | `jh16.txt`, pełny `jh16-run.tar.gz`, fixture `faithful_2014-06-20` | 32 obserwacje, 16 Pi/Hi, Pearson 0.8162 i Spearman 0.9993. Dane publikacji; nie niezależna replikacja |
| Bundle operatora | `cli.json` | grant/people/signin-link na jednorazowej bazie i adresie fixture. Wynik sekretnego linku celowo nie zachowany; bez wysyłki maila |
| GPT G1–G3 | [protokóły](../PARALLEL_RESEARCH_GPT.md) | PROPOSED / NOT RUN; nie dopisano wyników ani procesów w tle |

## Odtworzenie obecnego checkpointu

Odebrany kod: `00a5b789fb8b35ada8ef7e73b1fcb7290258841d`; [protokół publikacji](evidence/2026-10-01/publication.json). Zachowaj checkout i wybierz commit zawierający receipt. Nie uruchamiaj starego eksperymentu z przypadkowym nowszym lockfile.

```bash
npm ci
npx playwright install --with-deps chromium
npm run clean && npm run test:all
npm run demo:jh16
node --import tsx scripts/demo_clinical.ts fixture:case-a available > /tmp/clinical-replay.json
cmp /tmp/clinical-replay.json docs/history/evidence/2026-10-01/clinical-case-a.json
```

Środowisko odbioru: Node 24.19.0; dokładne npm/platforma/przeglądarka w receipt. `npm ci` potrzebuje bibliotek budowy SQLite i dostępu do pakietów. W tej sesji node-gyp nie potrafił rozpakować nagłówków; pobrano oficjalne `node-v24.19.0-headers.tar.gz`, rozpakowano z filtrem bez zmiany właściciela i wskazano katalog przez `npm_config_nodedir`. Instalator przeglądarki zwracał uszkodzony ZIP; użyto tego samego Chrome Headless Shell 151.0.7922.34 z oficjalnego Chrome for Testing, sprawdzono CRC i umieszczono w oczekiwanym cache Playwright build 1234. Nie wymieniono testów ani wersji przeglądarki.

`source-sha256.json` przypina wszystkie pliki kodu, testów, konfiguracji i lockfile z odbioru. Dokumentacja może otrzymać kolejny liniowy commit bez ponownego przypisywania mu testów. Sprawdź hashe:

```bash
python3 - <<'PYCODE'
import hashlib, json
from pathlib import Path
root = Path('docs/history/evidence/2026-10-01')
for item in json.loads((root/'source-sha256.json').read_text()):
    assert hashlib.sha256(Path(item['path']).read_bytes()).hexdigest() == item['sha256'], item['path']
for item in json.loads((root/'receipt.json').read_text())['evidence']:
    assert hashlib.sha256((root/item['path']).read_bytes()).hexdigest() == item['sha256'], item['path']
print('source and evidence hashes match')
PYCODE
```

Clinical report powinien odtworzyć się bajtowo dla tej samej recipe. JH16 zapisuje pełny run, bazę, raw, manifest, eksporty i wykresy; archiwum pozwala obejrzeć dokładny odbiór. Nowy run ma nowe UUID i czasy, dlatego jego cały manifest nie musi mieć identycznego hasha. Porównuj deterministyczne wartości i przypięte wejścia; nie nazywaj zmiennych otoczek dowodem różnicy naukowej. Skrypt JH16 drukuje historyczne etykiety `pre-registered`; w tym fixture to progi programu, a nie nowa prerejestracja empiryczna.

## Zachowane niepowodzenia

`navigation-intermediate.txt` zawiera błąd starego dokładnego selektora nazwy po dodaniu znacznika advanced; naprawą jest jawna dostępna nazwa, nie usunięcie asercji. `operations-intermediate.txt` zachowuje dwie nieaktualne asercje z bocznej gałęzi: domyślny ref i lokalizację wydzielonego modułu. Odbiór końcowy testuje zachowane main i rzeczywistą komendę. Jedna wcześniejsza budowa zostawiła stary index z poprzednim assetem; clean build rozwiązał problem, a końcowa komenda zawiera clean. Zdarzenia odróżniamy od awarii wdrożonej instalacji, której nie obserwowano.

Nie zachowano pełnych surowych artefaktów wszystkich dawnych 120 commitów ani kompletnych transkryptów; źródłowy kod i datowane deklaracje pozostają dostępne. Usunięty lub nigdy niezapisany plik nie staje się odtwarzalny przez sam opis. Nowe prace obowiązuje [kontrakt historii](../HISTORY_POLICY.md).

Dawny PR #1 deklaruje również publiczną akwizycję (572 activity assertions/38 receipts i odświeżenie MDMA). Runtime database nie była dołączona do Git; surowej bazy nie odzyskano w tym odbiorze. To zachowana historyczna deklaracja, nie samowystarczalny dataset ani powtórzony pomiar. Ponowna akwizycja dziś byłaby nowym runem, nie odtworzeniem dawnych odpowiedzi.
