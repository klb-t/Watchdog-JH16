# Koordynacja po przekazaniu GPT → Claude

Claude otrzymuje główną integrację, kolejkę i globalny stan. Właściciel zlecił GPT dokończenie przerwanego porządkowania 2.10; jego zakres obejmuje publikację gotowych checkpointów, archiwum, prezentację repo i aktualne przekazanie. [Handoff](HANDOFF_2026-10-02_TO_CLAUDE.md) i [ledger](spec/07_EPICS_AND_TASKS.md) opisują odbiór i zależności. Nie potwierdzono odbioru przez inną sesję Claude’a.

| Właściciel | Zakres | Punkt wyjścia |
|---|---|---|
| Claude — integrator | Główny workflow, otwarty backlog, ewentualny odbiór rzeczywistej instalacji | Ukończona konsolidacja E4.7/E7.7/E3.17; najpierw refetch i receipt |
| GPT — domknięte przekazanie | Audyt, kod konsolidacji, regresje, dokumentacja, historia i odtwarzanie | 613/613, typecheck/build; `2c0e013` i ponowny odbiór opisany w handoffie |
| GPT — ukończone badania | G1/G2/G3 z PARALLEL_RESEARCH_GPT.md, osobna gałąź i artefakty | `7346f0a`; 43 hashe sprawdzone, replay G1/G2/G3 identyczny; bez zmian produktu |

Każdy nowy claim ma task ID, owner, base/head, konkretne ścieżki, czas, kryterium i kolejny checkpoint. Claim nie jest atomową blokadą. Stary timestamp nie pozwala nadpisać czyjejś pracy: sprawdź wszystkie refy i zachowaj rozbieżności.

Przed falą: fetch wszystkich remote refs; ahead/behind względem main; odczyt niezintegrowanych zmian. Przed odbiorem: test dokładnego połączonego kodu, sprawdzenie zdalnego SHA i rozdzielenie local/CI/container/VM. Dokumentacyjne commity używają `[skip ci]`; nie uruchamiaj płatnych lub zbędnych workflow.

RESEARCH, CLINICAL i OPERATIONS są odebrane przez #9. Dawne instrukcje startowe i przydziały nie zlecają ich ponownej implementacji. [Pełny historyczny zapis koordynacji](history/WORK_COORDINATION_2026-09-30.md) zachowuje role, claimy, ścieżki i naprawione blokery.

Publiczna dokumentacja zawiera dowody z repo i syntetycznych testów. Prywatne rozmowy, klucze i materiały innych projektów nie są wejściem do publicznego commitu. Publikacja checkpointu nie potwierdza, że inny wątek go przeczytał lub zaczął działać.

Nowe przyrosty main są liniowe według [HISTORY_POLICY](HISTORY_POLICY.md). Publikacja nie jest deklaracją odbioru przez działający proces Claude’a.

Trwałe refy sprawdzone 3.10: produkt `a0e061f`, badania `9c562d8d`, archiwum oryginałów `a683082c`. Źródłowe `2c0e013`/`7346f0a` mają identyczne drzewa, lecz inne metadane commitów. Nie ma anotowanych tagów ani potwierdzenia odbioru przez inną sesję Claude’a.
