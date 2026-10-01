# Unikalne identyfikatory zadań

Mapa naprawia kolizje zaobserwowane na `31b813f` i `9dea9aa`. Historycznych commitów, raportów i testów nie przepisujemy. Od 1.10 nowe wpisy używają kolumny „kanoniczny”.

| Stary identyfikator i znaczenie | Kanoniczny | Stan |
|---|---|---|
| E2.1 OpenRouter/text.generate, `0612ac1` | E2.1 | Implementacja w main |
| E2.1 entity-aligned execution, `fe674eb` | **E2.2** | Implementacja w main |
| E3.6 readiness / end-to-end flow, `8a768ff` | E3.6 | Implementacja w main |
| E3.6 public schedules/memory, `35deca9` | **E3.16** | Implementacja w main |
| ASTRA_PROGRESS E3.5 acquisition / E3.6 setup | E3.16 acquisition; E3.7 settings; E5.6 setup launch | Historyczne nagłówki nie są nowymi zadaniami |
| E3.14 current VM default / Cloud Run guard, `757c1fb` | E3.14 | Implementacja w main |
| Claude E3.14 public HTTPS, `0566d6a` | **E3.17** | Kod na gałęzi; konsolidacja otwarta |
| E4.5 w main: Google, wniosek, adresowy link do wniosku | E4.5 | Tylko ten węższy zakres ukończony |
| Claude E4.5: mail, kod, linki otwarte, CLI | **E4.7** | Konsolidacja rozszerzeń z E4.5 |
| Main E5.10: siedem sekcji + wyszukiwanie | E5.10 | Ukończone na main |
| Claude E7.1: siedem obszarów | E7.1 (branch-local history) | Zachowane w źródłowej spec 14 |
| Konsolidacja nawigacji obu wersji | **E7.7** | Otwarte; E7.2–E7.6 zarezerwowane przez spec 14 |
| E5 remainder / E6 remainder | **E5.11 / E6.6** | Otwarte; opisy zachowane w rejestrze |

Nowe migracje mają odrębną numerację: 020 admission, 021 projects, 022 comparisons pozostają niezmienione. 023 jest rezerwacją następnej konsolidacji, wymagającą ponownego sprawdzenia zdalnych zmian przed użyciem.
