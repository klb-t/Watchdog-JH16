# Chronologia G2

1. Odczytano przypięte pliki CLINICAL z `61daefd82cc778e28d2d3868eaaf0689d856fc49`. Źródłowy archiwalny przypadek ma już pomiar alpha; rozbudowane przypadki są jawnie fikcyjnymi rozszerzeniami.
2. `prepare_inputs.py` zapisał `protocol.json`, `inputs.json` i `freeze.json` **przed pierwszym uruchomieniem** `run.py`. Lokalny czas i hashe znajdują się w freeze. Nie jest to niezależna prerejestracja.
3. Pierwszy przebieg przeszedł wszystkie zadeklarowane kontrole. Zachowany jest w `runs/initial/`, wraz z dokładnymi bajtami początkowego runnera jako `run.py.txt`.
4. Integrator wykrył błąd pakowania: kopie źródłowych `.ts` w katalogu research weszły do globalnego `tsconfig` produktu, a skopiowany selektor odwoływał się do modułów, których nie kopiowano. Kopie przemianowano na `.ts.txt`. `snapshot-packaging.json` mapuje ścieżki zapisane przed wynikami na rzeczywiste pliki archiwalne; ich bajty i SHA-256 pozostały identyczne. Runner otrzymał wyłącznie obsługę tej mapy. Nie zmieniono protokołu, generatora, wejść, algorytmów, parametrów ani wyników pomiarów. `prepare_inputs.py` jest zamrożonym zapisem przygotowania, a nie poleceniem wymaganym do replay; nie uruchamiać go ponownie wewnątrz produktu.
5. Przebieg po poprawce pakowania zapisano w `runs/primary/`. Różnica deterministycznego JSON względem pierwszego przebiegu dotyczy wyłącznie hasha runnera. Dwa ponowne wykonania primary i odtworzenie initial dały identyczne bajty odpowiednich zapisanych wyników; `verification.json` zachowuje polecenia i wyniki.

Protokół v1 nie był zmieniany po obejrzeniu wyników. Ewentualne nowe dane, inne kryterium optymalizacji lub nowe reguły wymagają nowego protokołu. Zmiana technicznego pakowania ma powyższy jawny zapis.
