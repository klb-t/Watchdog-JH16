# WatchDog — pakiet dla Claude Code

**Data:** 2026-08-16 · **Wersja:** v6 · Jedyny plik po polsku, reszta jest dla agenta.

## Co to jest

Nie kolejna paczka do AI Studio. To pakiet do wrzucenia **do repo**, w którym pracuje Claude
Code. Różnica jest istotna: `CLAUDE.md` w korzeniu repo Claude Code czyta automatycznie na
starcie każdej sesji. Nie musisz nic wklejać ani przypominać. Otwierasz sesję, agent już wie,
gdzie jest projekt i co ma robić.

## Jak użyć

1. Rozpakuj do korzenia repo WatchDog. `CLAUDE.md` ma trafić obok `package.json`.
2. `git add . && git commit -m "spec: agent contract v6"`
3. Odpal Claude Code w repo, wklej `PROMPT_CLAUDE_CODE.txt`.
4. Pierwsza odpowiedź ma być raportem rozbieżności między specyfikacją a repo. **Nie kodem.**
   Jak zacznie od kodu — przerwij i powtórz prompt.

## Co zdecydowałem za Ciebie

Prosiłeś o decyzje, więc podejmuję. Każda ma uzasadnienie w `docs/spec/00_STATE_AND_DECISIONS.md`,
gdzie jest też napisane, co odrzuciłem i dlaczego — żebyś mógł to zakwestionować w konkretnym
punkcie, a nie od zera.

**TypeScript, nie Python.** Z MHT wynika fakt, którego nie było w żadnym wcześniejszym źródle:
repo już istnieje, agent AI Studio zrobił trzy przebiegi, pliki nazywają się `registry.ts`,
`serp.ts`. v3 zakładał FastAPI — to była specyfikacja pisana obok kodu, który już powstawał.
Przepisywanie na Pythona wyrzuciłoby trzy przebiegi pracy za korzyść, która pojawia się dopiero
przy Grangerze i VAR. Warstwa liczenia jest za protokołem, więc pythonowy executor doklei się
później bez ruszania reszty.

**SQLite i katalog na dysku zamiast Postgresa i MinIO w E1.** Bo E1 ma się odpalać przez
`npm install && npm test` bez infrastruktury. Poprzednie podejście umarło na infrastrukturze
przed pierwszą działającą funkcją. Wszystko siedzi za interfejsami repozytoriów, więc podmiana
na Postgresa w E3 jest mechaniczna — i jest test, który to sprawdza.

**Firebase: nie.** Zapytałeś w tamtej rozmowie i odpowiedź zniknęła w wirtualizacji snapshotu,
więc odpowiadam tutaj. Nie jako warstwa danych — rdzeniem tego systemu są niemutowalne,
adresowane treścią, hashowane manifesty, a model dokumentowy Firestore z tym walczy i wprowadza
lock-in, którego cała abstrakcja providerów ma unikać. Firebase Hosting pod frontend i Firebase
Auth jako jedna implementacja `IdentityProvider` w E4 — proszę bardzo, to są liście za
interfejsami.

**Kryzys replikacyjny wchodzi do schematu już w E1.** To był Twój pomysł z tamtej rozmowy i
jest lepszy, niż wygląda: JH2016 to już jest replikacja, tylko nienazwana. Cztery tabele,
słownik werdyktów (`reproduced` / `deviates` / `not_computable` / `method_unclear` — bez
`failed`, celowo) i JH2016 jako cel replikacji numer jeden. Kosztuje dziś prawie nic,
a bez tego późniejsze dołożenie tego byłoby przeprojektowaniem.

Z v5 przeniosłem bez zmian: odroczenie auth do E4, `Capability`/`Provider`/`Credential`,
`PROVIDER_DISCONTINUITY`, kompilator metod emitujący `MethodSpec` a nie kod, bramkę
zatwierdzania wymuszaną w backendzie i wiązaną z hashem. Z v3 zostawiłem model danych, katalog
źródeł, kontrakt diagnostyczny i zakres.

## Czego pilnujesz Ty, a czego agent

Agent nie pyta o nazewnictwo, układ plików, biblioteki, kolejność zadań ani zgodę na kolejny
krok. Ledger odpowiada na to sam.

Pyta tylko o: pieniądze i klucze API, prawdziwe dane osobowe lub medyczne, zmianę metodologii
w zablokowanym presecie, propozycję przepisania istniejącego kodu, oraz konflikt specyfikacji,
którego nie rozstrzyga precedencja.

Jeden twardy przerywnik: jeśli E0.3 znajdzie klucz w historii gita, agent ma stanąć i
powiedzieć. To jedyny przypadek, w którym ma Cię zawołać niezależnie od wszystkiego.

## Dwie rzeczy do sprawdzenia po Twojej stronie

**Czy tamte siedem plików z przerwanego przebiegu jest w repo.** Nie wiem tego z MHT i agent
też nie będzie wiedział — dlatego E0.1 to inwentaryzacja, a nie budowanie. Jak masz to sprawdzone,
dopisz do `00_STATE_AND_DECISIONS.md` §4, Q1.

**Progi tolerancji dla JH2016 jako celu replikacji.** To jedyna rzecz, której nie mogę ustawić
za Ciebie, bo ustawiona po zobaczeniu wyniku przestaje być progiem. E1.20 tego potrzebuje.
Uprzedzam od razu: liczniki wyników Google w 2026 to nie są liczniki z 2016 i werdykt
`deviates` jest tu spodziewany. To jest wynik, nie porażka — i nie wolno tego stroić, aż wyjdzie
`reproduced`.

## Czego świadomie nie ma

Generyczny workbench, pipeline artykułu, semantyka forumowa, geografia, alerty. Wszystko to
jest w v3 i wszystko jest odłożone do E5. E1 jest wąskie celowo — jego wartością jest to, że
zostanie **skończone**. Rozszerzanie E1 to dokładnie ten mechanizm, który zatrzymał poprzednie
dwa podejścia.
