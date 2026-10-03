# Pilotaże GPT G1–G3 — 2026-10-02

Trzy wykonane, odtwarzalne eksperymenty syntetyczne na bazie `61daefd82cc778e28d2d3868eaaf0689d856fc49`. Pakiet pozostaje na bocznej gałęzi `research/gpt-pilots-20261002`; nie zmienia produktu, JH16 ani statusu naukowej aprobaty. Claude odbiera wyniki i ewentualne małe przyrosty do głównego workflow.

| Pilot | Wynik / kontrprzykład | Odtworzenie |
|---|---|---|
| [G1: pochodzenie](g1/RESULT.md) | 96 korpusów / 288 wyników; hash myli kopie/parafrazy i niezależne identyczne teksty. Poprawne lineage jest kontrolą z dostarczoną prawdą; błędne metadane dają błędy w obie strony | `PYTHONDONTWRITEBYTECODE=1 python3 research/gpt-20261002/g1/test_replay.py` |
| [G2: pokrycie/koszt](g2/RESULT.md) | 39 budżetów / 174 podzbiory; zachłanny wybór ustępuje optimum 4 razy. Pełny front Pareto i nierozstrzygnięcia zachowane | `python3 research/gpt-20261002/g2/run.py --verify research/gpt-20261002/g2/runs/primary/results.json` |
| [G3: selekcja i holdout](g3/RESULT.md) | 10 000 prób; przy 20 kohortach null 63,24% w eksploracji vs 4,68% holdout. Bonferroni: 4,52%, a wykrywanie sygnału 88,72% vs 67,14% holdout — brak zalecenia uniwersalnego podziału danych | `python3 research/gpt-20261002/g3/run.py --verify research/gpt-20261002/g3/results` |

Każdy pakiet ma protokół zapisany przed runem, kod, pełne surowe wyniki, hashe, środowisko, chronologię i replay bez sieci. G3 zachowuje statystyki wystarczające wygenerowanych bloków Gaussian, nie fikcyjne indywidualne rekordy osób. Zgodność bajtowa odnosi się do wskazanego CPython 3.12.14 i biblioteki matematycznej; czasy wykonania są osobną otoczką.

Niezależny przegląd G2 potwierdził wszystkie 39 decyzji względem bieżącego przyrostu pokrycia/kosztu. Przegląd G3 przeliczył z raw 48 wierszy, 192 przedziały Wilsona i 18 sparowanych różnic, bez użycia funkcji ewaluatora. Brak blockerów. Negatywne wyniki i ograniczenia pozostają częścią pakietu. Przeglądy i syntetyczny replay nie są walidacją kliniczną ani dowodem o rzeczywistych publikacjach.

Nie wykonano płatnych API, wysyłki do ludzi ani wdrożenia. Historyczne `artifact_head` w receipt opisuje stan przed publikacją; rzeczywistą tożsamość pakietu określa commit tej gałęzi i odnośnik zapisany na main po publikacji.
