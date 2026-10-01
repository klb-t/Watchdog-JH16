# Dostęp do instalacji

Tożsamość i dopuszczenie są osobne. Zweryfikowany adres bez grantu widzi logowanie i własny wniosek, a nie dane warsztatu. Wszystkie prywatne routery pozostają za globalną bramką, a poszczególne funkcje nadal sprawdzają zdolności i własność.

## Tryby i przejście istniejącej instalacji

| Konfiguracja | Zachowanie |
|---|---|
| `WATCHDOG_AUTH` niewypełnione, bez Google client ID | Historyczny lokalny właściciel; produkcja wymaga jawnego wyjątku. Wyłącznie prywatna instalacja |
| `WATCHDOG_AUTH` niewypełnione, `GOOGLE_OAUTH_CLIENT_ID` ustawione | Dotychczasowy Google OIDC i wnioski/zaproszenia request-only |
| `WATCHDOG_AUTH=accounts` | Kod e-mail, opcjonalny Google, nowe zaproszenia i wnioski, panel Ludzie i dostęp, CLI |

Accounts wymaga `SESSION_SIGNING_KEY` (minimum 32 znaki). `WATCHDOG_GRANTS` jest mapą dokładny adres lub `@domena` → rola; dokładny adres ma pierwszeństwo. Nie ma domyślnego dostępu ani automatycznego administratora z pierwszego logowania. Bootstrap właściciela używa `developer`. `admin` zachowuje stare zdolności, a nowy `access_admin` pozwala na ograniczoną delegację bez nadawania zdolności, których sam nie posiada.

Przed przełączeniem istniejącej instalacji wykonaj backup według [runbooka](DEPLOY_GCP_VM.md). Migracja 023 jest addytywna; nie zmienia 001–022 ani starych wniosków, tokenów i historii. Zweryfikowany adres łączy istniejący principal Google, zachowując jego własność. Cookies poprzedniego trybu wymagają ponownego zalogowania. Dane `local-user` nie stają się automatycznie własnością nowego konta; istniejący przegląd własności pozostaje oddzielnym narzędziem.

Trwałe wpisy `installation_grants` zachowują pierwszeństwo przed bootstrapem; odwołanego dostępu nie przywraca ponowne logowanie. Zarządza nimi dotychczasowy ekran `/settings/access` z `principal.manage` i ochroną ostatniego zarządzającego. Nowy panel pokazuje powód braku możliwości edycji; `watchdog-admin grant` przy takim adresie odmawia bez zapisu. Nowe źródła grantów pozostają osobno widoczne w audycie.

## Accounts: wejście, zaproszenia i odebranie dostępu

- Kod jest jednorazowy, ma 8 symboli, wygasa po 10 minutach; limity są w walidowanym `config/access/policy.json`. Kod i token są przechowywane jako skróty. Brak SMTP daje jawny błąd, nie fikcyjny sukces.
- Google używa weryfikowanego tokenu i adresu. Adres podany osobno przez klienta nie nadaje tożsamości. Zmiana adresu przy już połączonej tożsamości jest odrzucana.
- Nowe zaproszenie adresowe może nadać dopuszczalne role wyłącznie zweryfikowanemu odbiorcy. Przekazanie linku innej osobie nie zużywa go.
- Link otwarty jest osobnym typem: maksymalnie 50 użyć i 30 dni, atomowe użycie, możliwość odwołania; bez zdolności administracji, delegacji i diagnostyki.
- Stare zaproszenia nadal tylko składają wniosek. Nie zamieniają się w grant przy aktualizacji.
- Aktywne role są sprawdzane przy każdym żądaniu. Cofnięcie grantu, blokada konta oraz wylogowanie wszystkich sesji są osobnymi zdarzeniami; generacja sesji unieważnia stare cookies.

Panel `/access` wymaga `principal.view`; zmiany wymagają dodatkowych zdolności i kontroli zakresu. Operacyjne granty z konfiguracji nie są edytowane w nowym panelu. Zmiana nazwy profilu nie zmienia tożsamości.

## Mail i operator

Ustaw `SMTP_URL`, `MAIL_FROM` i `WATCHDOG_PUBLIC_URL`. Treści PL/EN oraz UI mają wersjonowaną konfigurację w `config/access/`. Status „sent” oznacza przyjęcie przez SMTP, nie potwierdzenie dostarczenia do skrzynki. Mutacje wymagają tego samego origin i JSON; odpowiedzi auth nie są cache’owane.

Na VM: `sudo watchdogctl enable-accounts owner@example.test`, `sudo watchdogctl set-mail`, `sudo watchdogctl people`. Na istniejących danych najpierw sprawdź legacy override właściciela. Polecenia `grant`, `invite`, `open-link`, `signin-link` uruchamiają w kontenerze `dist/watchdog-admin.cjs`. `signin-link` daje jednorazowe wejście na 15 minut, lecz samo nie nadaje ról. Traktuj jego wynik jak hasło; nie umieszczaj w logach/publicznych artefaktach. CLI jest uprawnieniem operatora powłoki, nie endpointem HTTP.

## Dowody i granice

Pełny gate 604/604 obejmuje stary OIDC, nowy protokół, test wypełnionej migracji, lokalny rzeczywisty SMTP testowy i przeglądarkę na 390 px. Dodatkowo sprawdzono produkcyjny bundle CLI na izolowanej bazie. Dowody: [katalog replay](history/EXPERIMENTS.md). Nie sprawdzono zewnętrznej poczty, rzeczywistego klienta OAuth ani gotowej publicznej VM. Kontrakt czasowo ograniczonego offline pozostaje osobny; revocation online nie jest zdalnym usunięciem już pobranego archiwum offline.
