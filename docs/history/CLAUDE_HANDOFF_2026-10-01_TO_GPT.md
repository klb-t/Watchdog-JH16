# Przekazanie dowodzenia — notatka dla GPT/Codex (2026-10-01)

Od: Claude (gałąź `claude/ai-studio-last-commit-gjqxy4`).
Do: GPT/Codex — przejmujesz prowadzenie całego repozytorium `klb-t/Watchdog-JH16`.
Polecenie właściciela (Marcin, pracuje z telefonu, nie będzie analizował szczegółów):
zdaj raport ze wszystkiego, co zrobiłeś we wszystkich gałęziach i wątkach; sam znajdź
i napraw to, co poszło źle; uporządkuj i udokumentuj całe repo. Decyzje podejmuj sam,
według filozofii z sekcji 4. Przeczytaj też `CLAUDE.md` — obowiązuje nadal.

---

## 1. Stan gałęzi na 2026-10-01

| Gałąź | Head | Stan |
|---|---|---|
| `main` | `31b813f` | Twoja integracja PR #9 (552/552 w CI). Punkt odniesienia. |
| `claude/ai-studio-last-commit-gjqxy4` | ten commit | **8 commitów, których nie ma w `main`** (sekcja 3). Nigdy nie miała PR. |
| `codex/watchdog-integration-20261001` | `ca5645c` | Scalona do main (PR #9). |
| `codex/watchdog-research-20260930` | `93f98ed` | Scalona przez PR #9. |
| `codex/clinical-audit-20260930` | `0b013b5` | Scalona przez PR #9. |
| `codex/watchdog-operations-20260930` | `92ae68b` | Scalona przez PR #9. |
| `codex/watchdog-wave1-20260930` | `a1449bd` | Scalona (`860c844`). |
| `astra/watchdog-integration-20260930` | `29b52a1` | Scalona (`ac0c728`). |
| `astra/watchdog-continuation-20260908` | `c3508c1` | Scalona; **PR #1 nadal otwarty**. |
| `chore/repo-hygiene-2026-09` | `4b3d333` | Scalona. |

GitHub pokazuje PR #2–#9 jako „closed, not merged”, bo scalanie robiono lokalnie.
Rzeczywiste commity scalające istnieją w `main`. Zapisz to jednoznacznie w dokumentacji,
bo inaczej każdy następny agent pomyśli, że te PR-y odrzucono.

## 2. Raport, którego oczekujemy od Ciebie (najpierw, zanim cokolwiek zmienisz)

Plik `docs/REPORT_GPT_2026-10.md`, po polsku, czytelny na telefonie:

1. Każda gałąź, każdy wątek/subagent, każdy PR: co zrobił, jakie testy przeszły,
   co zostało niedokończone. Daty i SHA.
2. Lista rzeczy zrobionych **dwa razy** przez różnych agentów (sekcja 3 to początek
   listy, nie cała lista).
3. Lista zaniechań: o co właściciel prosił, a czego nie ma (poszukaj w archiwum rozmów,
   do którego masz dostęp).
4. Co jest naprawdę gotowe dla zewnętrznego testera (Marcin, Jankowski), a co tylko
   „przechodzi testy”.

## 3. Co poszło nie tak — wyjaśnienie

### 3.1 Równoległa praca bez czytania cudzej gałęzi
24–25.09 na `claude/ai-studio-last-commit-gjqxy4` powstało pełne logowanie E4.5,
7 obszarów nawigacji (spec 14, D21) i publiczny HTTPS (D22). 30.09 w `main` powstały
**od nowa** te same rzeczy w innej wersji: E4.5 „Closed installation admission” oraz
E5.10 „Seven-section workspace”. Skutek:

- **dwie różne migracje `020_admission`** o tej samej nazwie i innych tabelach — zwykłe
  scalenie jest niemożliwe;
- **dwa różne E3.14** (u Ciebie: domyślna gałąź instalatora; u Claude'a: publiczny HTTPS);
- dwie konfiguracje nawigacji (`config/workspace-navigation.json` i `config/ui/navigation.json`);
- dwa dokumenty decyzji (D20–D22 tylko na gałęzi Claude'a).

Przyczyna: przed rozpoczęciem pracy nie sprawdzono `git branch -r` i nie porównano
z gałęziami, które nie były w `main`. Na przyszłość: przed każdą falą pracy wykonaj
`git fetch --all` i porównaj wszystkie gałęzie z `main` (`git rev-list --count main..X`).

### 3.2 Logowanie w `main` nie spełnia prośby właściciela
Właściciel 23.09 poprosił dosłownie o: ekran logowania, prośbę o dostęp, rozdawanie ról,
**wysyłanie na maila** i **link niepodpisany mailem, żeby ktoś mógł wejść z dowolnego
adresu**. W `main` (`docs/ADMISSION.md`): logowanie tylko przez Google (wymaga
skonfigurowania klienta OAuth), „Aplikacja nie wysyła wiadomości email”, brak linków
otwartych, brak publicznego adresu. Bez tego Marcin ani Jankowski nie wejdą.

Na gałęzi Claude'a to istnieje i jest przetestowane (424/424 testy na tamtej bazie,
w tym E2E w przeglądarce na telefonie po polsku):
- logowanie jednorazowym kodem z maila (bez Google), limity prób i czasu;
- zaproszenia na konkretny adres (nieprzenaszalne) i **linki otwarte** (1–50 użyć,
  ≤30 dni, nigdy z uprawnieniami administracyjnymi);
- wysyłka przez SMTP (np. Gmail z hasłem aplikacji); nic nie jest oznaczane „wysłane”,
  jeśli serwer SMTP tego nie przyjął;
- panel „Ludzie i dostęp”, wnioski, odbieranie dostępu działające natychmiast,
  wylogowanie wszędzie, jednorazowe linki operatora z konsoli (`watchdogctl signin-link`);
- `deploy_gcp_vm.sh --public --owner EMAIL`: Caddy + certyfikat Let's Encrypt +
  adres `<ip>.sslip.io` bez kupowania domeny; adres otwiera się dopiero po włączeniu
  logowania.

### 3.3 Porządek w rejestrze zadań
W `main` w `docs/spec/07_EPICS_AND_TASKS.md` są **zdublowane identyfikatory**: `E2.1`
(OpenRouter i entity-aligned execution) oraz `E3.6` (harmonogramy i „the flow”).
Do tego kolizja `E3.14` z gałęzią Claude'a. Nadaj nowe, unikalne numery i zostaw
w starym miejscu odsyłacz.

### 3.4 Nikt nie postawił systemu naprawdę
Wszystkie „gotowe” instalacje są sprawdzone tylko w CI i kontenerze. Pierwsza
instalacja na VM właściciela nie odbyła się. Nie pisz „gotowe do testów” bez tego.

## 4. Filozofia decyzji (słowa właściciela, obowiązujące)

1. **Najlepiej wcale nie decydować — zostawiać wszystkie opcje.** Zamiast usuwać jedną
   z dwóch wersji: obie jako opcje (konfiguracja, profil, preset, flaga), domyślna
   wskazana w konfiguracji, nie w kodzie.
2. **Gdzie wielu wersji nie ma sensu ciągnąć** (np. interfejs, schemat bazy, jedna
   migracja), stosuj procedurę **konsolidacji algorytmicznej**:
   1. wypisz szczegółowe cechy każdej wersji w tabeli;
   2. dla każdej cechy wybierz najlepszą realizację;
   3. zachowaj wszystko, co może współistnieć;
   4. dopisz, czego brakuje obu wersjom;
   5. uogólnij to, co jest szczególnym przypadkiem czegoś ogólniejszego;
   6. wyrzuć z kodu decyzje i dane (etykiety, listy, progi, ścieżki, domyślne wartości)
      do wersjonowanej konfiguracji.
   Tabelę i wynik zapisz w `docs/consolidation/<temat>.md`, żeby było widać, skąd wynik.
3. Właściciel nie analizuje. Pytaj go tylko o rzeczy z `CLAUDE.md` §4 (pieniądze,
   prawdziwe dane osobowe/medyczne, zmiana zablokowanej metody naukowej).
4. Nic nie znika: żadna strona, trasa, API, uprawnienie ani gałąź nie jest usuwana
   w ramach porządków. Gałęzie po scaleniu otaguj (`archive/<nazwa>`), nie kasuj.

## 5. Zadania po kolei

### T1. Raport (sekcja 2)

### T2. Logowanie — konsolidacja
Baza: `020_admission` z `main` zostaje (zastosowana w CI i Twoich testach; gałęzi
Claude'a nikt nie wdrożył). Funkcje z gałęzi Claude'a przenieś jako **nowe migracje
(023+)**; nie edytuj żadnej istniejącej migracji. Wynik ma umieć wszystko z obu wersji:
Google **i** kody z maila, zaproszenia na adres **i** linki otwarte, wysyłkę maili,
blokowanie/odblokowanie, wylogowanie wszędzie, ochronę ostatniego administratora
(jest u Ciebie), CLI operatora. Źródła po stronie Claude'a:
`backend/watchdog_api/identity/{admission,sign_in,index,oidc}.ts`,
`backend/watchdog_api/mail/`, `backend/watchdog_api/api/{auth_routes,access_routes,admission_gate,rate_limit}.ts`,
`scripts/watchdog_admin.ts`, `src/pages/{Login,Join,Apply,PeopleAccess}.tsx`,
`config/access/{ui,messages}.json`, testy `tests/{unit,integration}/admission.test.ts`,
`tests/e2e/access_flow.test.ts`, `tests/helpers/smtp.ts`. Decyzja D20 w
`docs/spec/00_STATE_AND_DECISIONS.md` tej gałęzi opisuje reguły bezpieczeństwa.

### T3. Nawigacja — konsolidacja (oba warianty mają 7 obszarów)

| Cecha | `main` (workspace-navigation) | gałąź Claude'a (spec 14) | Proponowany wynik |
|---|---|---|---|
| Obszary | Pulpit, Dane i źródła, Analiza danych, Zbieranie cykliczne, Projekty badawcze, Prace i replikacje, Baza i wyszukiwanie | Pulpit, Dane i źródła, Analiza, Automatyzacja, Projekty badawcze, Analiza publikacji (AI), Baza wiedzy | jeden zestaw w konfiguracji; nazwy do wyboru jako preset |
| JH16 / metoda / runy | w „Prace i replikacje” | JH16 w Projektach; metoda i runy w Analizie | zostaw układ z `main` jako domyślny, drugi jako preset |
| Wyszukiwarka `/search`, projekty `/projects` | są | brak (powstały później) | zachować |
| Ustawienia, diagnostyka, dostęp | menu narzędzi konta | grupa Ustawienia na dole | zachować z `main` |
| Języki etykiet | tylko PL | PL + EN | dodać EN |
| Ctrl/Cmd+K — skok do dowolnego widoku | brak | jest | przenieść |
| Ścieżka „Obszar › Widok” | brak | jest | przenieść |
| Widoki „zaawansowane” (runy, diagnostyka) oznaczone | brak | jest | przenieść |
| Adresy obszarów `/data`, `/analysis`… | brak | są (otwierają 1. dostępny widok) | przenieść |
| Test: każda trasa ma miejsce w menu i żaden wpis nie prowadzi donikąd | ? sprawdź | jest | przenieść |
| Ikony tylko potrzebne w paczce | ? sprawdź | jawna mapa | jedno z dwóch |

Kod Claude'a: `shared/navigation.ts`, `src/lib/navigation.tsx`, `config/ui/navigation.json`,
`tests/unit/navigation.test.ts`, spec `docs/spec/14_INFORMATION_ARCHITECTURE.md`
(z oryginalną notatką o architekturze informacji).

### T4. Publiczny HTTPS bez domeny
Przenieś z gałęzi Claude'a: `deploy/watchdog-proxy.service`, zmiany w
`scripts/{deploy_gcp_vm,gcp_vm_bootstrap,watchdogctl}.sh`, testy w
`tests/integration/gcp_vm.test.ts`, sekcję w `docs/DEPLOY_GCP_VM.md`, decyzję D22.
Twoje E3.14 (domyślnie `main`, blokada Cloud Run) zostaje. Moje E3.14 dostaje nowy numer.

### T5. Porządek i dokumentacja repo
- Jeden indeks dokumentacji (`docs/README.md`): co czytać najpierw, co jest aktualne,
  co historyczne. Stare handoffy i raporty przenieś do `docs/history/` (z odsyłaczami).
- README: stan faktyczny w 1 ekranie telefonu — co działa, jak uruchomić, czego brak.
- Rejestr zadań: unikalne ID, jedna lista „otwarte”, jedna „zablokowane”.
- `docs/spec/00_STATE_AND_DECISIONS.md`: dopisz D20–D22 z gałęzi Claude'a.
- Gałęzie: otaguj scalone, zamknij lub zaktualizuj PR #1, opisz w raporcie.

### T6. Szkic „agenta filozofii” (tylko dokument, bez kodu)
Właściciel kilka razy sam łapał błędy, których nikt nie pilnował. Zbierz z archiwum
rozmów **wszystkie jego korekty** do `docs/PRINCIPLES.md`, każdą jako regułę
sprawdzalną (co sprawdzić, w jakim pliku/teście, kiedy). Przykłady na start:
- nie usuwać funkcji przy porządkach; refaktor zamiast przepisywania;
- etykiety, listy i decyzje w konfiguracji, nie w kodzie;
- nie zgłaszać „zrobione” bez działającego przepływu dla prawdziwego użytkownika;
- nie dublować pracy innej gałęzi — sprawdzić wszystkie gałęzie przed startem;
- brak wartości ≠ zero; żaden LLM w ścieżce liczbowej; brak zmyślonych implementacji;
- telefon jest głównym urządzeniem właściciela: każdy ekran działa na 390 px;
- wiadomości do ludzi wysyłać tylko na wyraźne polecenie.
Ten plik będzie podstawą dla automatycznego strażnika (przegląd każdego PR), którego
Claude zaprojektuje po powrocie do kodowania.

## 6. Zasady wykonania
- `npm run test:all` w całości zielony, łącznie z przeglądarką; nie wyłączaj testów.
- Nie przepisuj `main` historii (bez force push na `main`).
- Commity małe, z numerem zadania.
- Na koniec zostaw `docs/HANDOFF_<data>_TO_CLAUDE.md`: co zrobione, co otwarte, SHA.
