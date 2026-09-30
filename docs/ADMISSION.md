# Dostęp do prywatnej instalacji

W instalacji z OIDC osoba bez sesji widzi wyłącznie logowanie. Zweryfikowane konto Google
bez przyznanych profili może podać cel korzystania i sprawdzić własny wniosek; nie ma dostępu
do danych warsztatu. Publiczne `/api/auth/config` opisuje konfigurację logowania bez listy
adresów. Pozostałe API wymaga przyjętego użytkownika oraz uprawnień właściwej funkcji.

## Konfiguracja właściciela

Skonfiguruj `GOOGLE_OAUTH_CLIENT_ID`, `SESSION_SIGNING_KEY` i `WATCHDOG_GRANTS` zgodnie
z [runbookiem](DEPLOY_GCP.md). Właściciel zarządzający profilami potrzebuje `developer`
lub kompatybilnego `dev`, np. wpisu `"owner@example.test":"developer"` w prywatnej
konfiguracji grantów. `admin` ma uprawnienia operacyjne i `principal.invite`; przypisywanie
profili wymaga osobnego `principal.manage`. Pierwsze logowanie nie nadaje automatycznie
uprawnień właściciela. System blokuje usunięcie ostatniego aktywnego zarządzającego dostępem.

Lokalny tryb właściciela pozostaje dostępny do pracy i za prywatnym tunelem instalatora VM.
Sam [instalator VM](DEPLOY_GCP_VM.md) nie konfiguruje konta Google ani nie publikuje aplikacji.
Bez OIDC uruchomienie produkcyjne wymaga istniejącego jawnego wyjątku operatora; nie używaj
takiej konfiguracji jako publicznego mechanizmu przyjmowania użytkowników.

## Wniosek, zaproszenie i profile

1. Zaloguj się kontem Google. Serwer weryfikuje podpis, odbiorcę, wystawcę, ważność i
   zweryfikowany email; adres przesłany osobno przez klienta nie ustala tożsamości.
2. Bez profili opisz cel korzystania. Wniosek zostaje zapisany i widoczny tylko dla jego
   autora oraz uprawnionej administracji.
3. Właściciel otwiera **Dostęp** w narzędziach konta, wybiera adres i profile. Profile łączą
   zdolności, a nie tworzą jednej hierarchii ról.
4. Przyjęta osoba wybiera **Enter workspace**. Aktywacja wykorzystuje już zweryfikowaną
   sesję i nie wymaga ponownego podawania adresu ani tokenu Google.

Administrator operacyjny może przygotować odnośnik zaproszenia dla konkretnego emaila.
Zaproszenie jest jednorazowe, wygasa po siedmiu dniach i można je odwołać. Samo przyjęcie
zaproszenia składa wniosek; nie nadaje profili ani uprawnień. Odnośnik jest pokazywany tylko
przy tworzeniu, a baza przechowuje skrót tokenu. Aplikacja nie wysyła wiadomości email.
Po otwarciu odnośnika klient usuwa token z adresu i dalszej historii nawigacji.

## Odebranie dostępu i ślad operacji

Każde żądanie sesji OIDC sprawdza aktualne granty oraz aktywność konta. Zmiana profili
działa w istniejącej sesji; odwołanie dostępu unieważnia ją przy następnym żądaniu.
Utrwalone odwołanie ma pierwszeństwo przed grantem startowym z konfiguracji. Ponowne
logowanie nie przywraca odebranych uprawnień. Odwołanie zaproszenia i odwołanie dostępu
użytkownika są osobnymi operacjami.

Migration 020 zapisuje wnioski, granty, zaproszenia i niezmienialny dziennik administracji.
Odpowiedzi auth mają `Cache-Control: no-store`. Mutacje wymagają JSON i przechodzą tę samą
kontrolę źródła żądania co pozostałe prywatne operacje. Przeglądarkowe dane referencyjne
offline nadal podlegają własnemu ograniczonemu czasowo kontraktowi; nie są bezterminową
sesją ani dostępem do pozostałego warsztatu.

## Zakres sprawdzenia

Testy obejmują rzeczywiste HTTP, podpisane testowe JWT, nieprzyjętych użytkowników,
powiązanie zaproszenia z adresem, zmiany aktywnych sesji, blokadę obcych źródeł żądań oraz
przepływ w produkcyjnym kliencie. Nie wymagają zewnętrznego konta Google. Konfiguracja
konkretnego klienta OAuth i domeny wdrożenia wymaga sprawdzenia na tej instalacji.
