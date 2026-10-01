# E7.7 — konsolidacja nawigacji

Bazy: main `31b813f`, Claude `c5275db`/`9dea9aa`. **Ukończono E7.7.** Macierz zachowuje kontrakt porównania.

| Cecha | Main | Claude | Docelowo |
|---|---|---|---|
| Siedem sekcji | workspace-navigation.json | ui/navigation.json | Jeden walidowany model, wariant grupowania jako profil |
| JH16/metody/runy | Prace i replikacje | Projekty/Analiza | Main domyślnie, alternatywne grupowanie zachowane |
| Projekty i wyszukiwanie | Realne `/projects`, `/search` | `/projects` to landing redirect | **Realna strona ma pierwszeństwo.** Nie kopiować przekierowania na tę ścieżkę |
| Narzędzia konta | Settings/access/diagnostics poza siedmioma grupami | Grupa settings | Zachować istniejące trasy i kontrolę zdolności |
| Języki | Polskie etykiety + angielskie nazwy pomocnicze | PL i EN | Równe klucze i jawny wybór języka |
| Ctrl/Cmd+K | Brak | Jest | Przenieść; tylko dostępne widoki, obsługa klawiatury i focus |
| Breadcrumb | Tylko aktywna grupa/widok | Obszar › Widok | Przenieść bez zmiany deep linków |
| Widoki zaawansowane | Bez osobnego znacznika | advanced | Metadana profilu; nie nowy poziom praw |
| Landingi obszarów | Nie ma | Pierwszy dostępny widok | Tylko wolne ścieżki; bez przejmowania istniejących stron |
| Walidacja | 7 unikalnych grup, href, capabilities, prefix tests | Pokrycie routed views i menu | Suma obu zestawów testów + nowe projekty/search |
| Ikony | Jawne identyfikatory i mapa | Jawna mapa | Zachować walidację, brak importu całej biblioteki |

Źródła: main `shared/workspace_navigation.ts`, `config/workspace-navigation.json`, `src/components/Layout.tsx`, `src/App.tsx`, `tests/unit/workspace_navigation.test.ts`, `tests/e2e/workspace_navigation.test.ts`; Claude `shared/navigation.ts`, `src/lib/navigation.tsx`, `config/ui/navigation.json`, `tests/unit/navigation.test.ts`, historyczna spec 14.

Odbiór: suma wszystkich starych tras zachowana; każda strona ma wejście lub jawny kontekst; menu niczego nie oferuje poza uprawnieniami, API nadal sprawdza uprawnienia; oba profile mają te same osiągalne funkcje. Browser: 390 px, deep link/reload, palette Escape/Enter/focus, zero poziomego przepełnienia i zachowane kontrole formularzy. Testy obecności siedmiu nazw nie dowodzą kompletności przepływu.

## Wynik konsolidacji

Rejestr tras i zdolności pozostaje w `config/workspace-navigation.json`. Walidowany `config/workspace-preferences.json` dodaje PL/EN, profile `main` i `claude`, znaczniki advanced oraz bezkolizyjne landingi. Preferencje są zapisywane lokalnie; domyślnie obowiązuje układ main. Profile grupują te same funkcje; `/projects` i `/search` nadal są prawdziwymi stronami.

`WorkspaceControls` zapewnia palette Ctrl/Cmd+K, strzałki, Enter, Escape i powrót focusu. Breadcrumb i nazwy dostępne dla czytników ekranu pozostają stabilne. `workspace_preferences.test.ts` weryfikuje równoważność dla wszystkich ról i odrzuca niepełny profil; test produkcyjnego klienta sprawdza przełączanie, reload, rzeczywiste projekty, search i 390 px. Ten zakres dotyczy języka nawigacji i kont; nie twierdzi, że przetłumaczono wszystkie historyczne ekrany produktu.
