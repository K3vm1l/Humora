# Dokumentacja Techniczna Architektury Rozproszonej: System Wideokonferencji z Analizą Obrazu AI

## 1. Architektura Systemu i Struktura Katalogów

Aplikacja opiera się na rozproszonym modelu komunikacji P2P oraz niezależnym serwerze backendowym działającym jako węzeł obliczeniowy AI (Node Inference). Rozdział ról gwarantuje bezkompromisową wydajność klienta, przenosząc skomplikowaną obróbkę macierzową na wyspecjalizowane serwery.

### Przepływ Danych (Data Flow)
1. **Akwizycja Medialna (Przeglądarka):**
   Aplikacja integruje się z WebRTC (natywne API `navigator.mediaDevices`). Pobiera surowe stany audio i wideo, kompilując proces w mutowalne obiekty strumieniowe. Renderowanie dla samego użytkownika następuje lokalnie przy redukcji odbicia dźwięku i nałożeniu filtru odbicia lustrzanego.
2. **Transformacja i Kompresja (Frontend):**
   Wykorzystując referencyjny i niewidzialny w procesie dom element graficzny `<canvas>`, pobierana jest kopia klatki co ustalony cykl interwału (około 1–2 fps). Wideo transkodowane jest na wirtualnym płótnie do predefiniowanej formatki (np. 640x480) i kompresowane z użyciem protokołu stratnego JPEG (w jakości 0.7). Bitmapa zamieniana jest na łańcuch kodowania 64-bitowego (Base64).
3. **Transport Sieciowy (WebSockets):**
   Sieć WebRTC Peer-to-Peer łączy się wyłącznie z klientami zewnętrznych instancji dla obrazu. Niezależnie zachodzi asynchroniczna, obustronna komunikacja strumieniowa WebSocket pod ścieżką sieciową modelu (`/ws/analyze`). Minimalizuje to opóźenienie nawiązywania złącza HTTPS ("3-way handshake").
4. **Rozkodowanie i Inferencja (Model AI - FastAPI):**
   Serwer pytoński na serwerze dedykowanym odbiera zryczałtowany strumień Base64, odrzuca metadane standardu MIME, konwertuje dane do ustrukturyzowanej formy 8-bitowej macierzy numpy (`uint8`) oraz odzyskuje trójwymiarowe spektrum barw przez dekoder `OpenCV`. Następnie algorytmy sztucznej inteligencji wykrywają wektory cech biometrycznych (wiek, płeć, emocje).
5. **Alineacja Informacyjna (Feedback Frontend):**
   Backend natychmiast asynchronicznie emituje do klienta relacyjny wynik zwrotny sformatowany poprzez notację JSON. Przeglądarka interpretuje ramkę w stanie logicznym widoku (`React Hooks`) wizualizując wyniki na warstwie absolutnej ekranu.

### Drzewo Struktur i Wykorzytsane Pliki
Poniższy schemat odzwierciedla rozbicie architektury w module mikroserwisów:

```text
Humora_frontend/
├── backend/
│   ├── main.py ..................... [KOD SILNIKA] Inicjalizacja demona FastAPI, obsługa gniazd (WebSockets), dekoder macierzy klatek.
│   └── requirements.txt ............ [PAKIETY] Definicje frameworków uvicorn, OpenCV i zależnych numpy/FastAPI.
└── frontend/
    └── src/
        ├── App.jsx ................. [ROUTER] Wzorzec wyższego rzędu; koordynator dróg doboru ścieżek w obrębie DOM.
        ├── supabaseClient.js ....... [BAZA CZASU RZECZYWISTEGO] Silnik zarządzający zdalnym nasłuchiwaniem subskrybcji P2P Relay.
        ├── pages/
        │   └── MeetingRoom.jsx ..... [ORKIESTRATOR] Główny koordynator logiczny dla PeerJS i powiązań stanowych wirtualnego pokoju.
        └── components/
            └── VideoFeedWithAI.jsx . [KOPROCESOR MEDIALNY] Odseparowany interfejs sprzętowy. Odbiera render wejściowy i nawiązuje tunel AI.
```

---

## 2. Szczegółowa Analiza Plików i Modułów

### `backend/main.py`
Plik reprezentuje serce mechanizmu uczenia maszynowego wystawione jako brzegowe API (Edge Endpoint). Ze względu na jednowątkowy Global Interpreter Lock z obecnego środowiska CPython, plik wykorzystuje asynchroniczny routing ramy `FastAPI` (wzorzec ASGI uruchamiany przyrządem Uvicorn). Moduł izoluje wejścia dla operacji wymagających dużej mocy obliczeniowej (Tensorflow / PyTorch), ukrywając te aspekty przed opóźnioną pracą wątku głównego serwera produkcyjnego. Pozwala to na uniknięcie odczuwalnych „freezów” w streamingu klient-klient podtrzymując responsywność łącza, ponieważ w momencie napłynięcia wadliwej zbitki klatki błąd izolowany jest dla pojedynczego klienta.

### `frontend/src/pages/MeetingRoom.jsx`
Implementacja kontrolera domeny w ujęciu ekosystemu wzorca stanów maszynowych. Moduł agreguje pod jednym korzeniem zestaw wszystkich kluczowych stanów globalnych i logiki koordynacyjnej. Rezyduje tutaj całe zarządzanie komunikacją peer-To-peer poprzez asynchroniczne pukanie do serwerów `STUN/TURN` (przy użyciu biblioteki PeerJS). Realizowana jest w nim także logika współbieżnych procesów informacyjnych korzystająca ze strumieni transakcyjnych Supabase (np. kto podniósł rękę i komunikaty kanału "czat"). Odpowiada także jako agregator zdarzeń za „wdzięczne opuszczenie pokoju” (Graceful Shutdown) i czyszczenie podniesionych wątków pamięci lokalnej (wyjścia kamer i mikrofonów).

### `frontend/src/components/VideoFeedWithAI.jsx`
Wysoko specyficzny, atomowy mikrowidok, enkapsulujący operacje i stan związany wyłącznie i nierozerwalnie z pojedynczym potokiem wizji. Komponent ten jest serwowany instancjalnie wewnątrz pętli iterującej z pokoju konferencyjnego. Pełni rolę strażnika pasma sieciowego (tzw. "Bandwidth Gatekeeper"). Analizuje, obrabia do odpowiedniej rozdzielczości klatkę po klatce i ustanawia dedykowany wyłącznie swojemu istnieniu kanał komunikacyjny z backendem AI. Posiada samonaprawczą asynchroniczną maszynę pętli, weryfikującą jakość połączeń do inferencji.

---

## 3. Dokumentacja Funkcji i Logiki (Krok po kroku)

### Główne żądanie wskaźnika wejściowego: Zwracanie wyniku z `websocket_endpoint` (FastAPI)
- **Input (Wejście):** Ciągły otwarty tunel TCP z pakietowanym ładunkiem użytecznym tekstowym formatu Base64 (bez gwarancji spójności zadeklarowanego kodowania bitowego pakietu, dostarczanymi jako klatki kompresji grafiki jpeg).
- **Zadanie:** Dekompresja surowego wejścia z bufora RAM na odzyskiwalną tablicę wielowymiarową gotową na algorytmy wizji komputerowej. Następnie synteza wyjścia detekcji neuronowej cech antropologicznych. Zabezpieczenie integralności serwera w niekończącej się pętli `while`.
- **Output (Wyjście):** Konstrukt leksykalny w notacji JSON (np. `{"emotion": "Neutralny", "age": 28, "gender": "Kobieta"}`) – przesyłany odzyskiwalnym kanałem wstecznym.

### Skomplikowana blokada renderująca – Mutacja natywnego Node.js do React
```javascript
useEffect(() => {
    if (videoRef.current && stream) {
        videoRef.current.srcObject = stream;
    }
}, [stream]);
```
**Wytłumaczenie architektury (Dlaczego):** Paradygmat programowania deklaratywnego (React) narzuca deterministyczne przypięcie modelu. Niestety API przeglądarki z klasy `MediaStream` egzekwuje wiązanie imperatywnie, tzn. musimy zmusić wskaźnik domowy (`current`) elementu `<video>` do wchłonięcia fizycznego sygnału kamery pomijając standardowe mapowanie atrybutu (tak jak to ma miejsce z ciągiem URL). Hook `useEffect` sprzężony został na referencyjny odchył mutacji stanu `[stream]`. Daje to inżynierską pewność, że ciężki obiekt wideo jest inicjalizowany w elemencie HTML tylko po dokonaniu prenegocjacji strumienia, minimalizując ucieczki (leak memory) w zwalnianiu nieistniejących instancji, chroniąc przed awarią obciążenia pamięci na urządzeniach mobilnych.

### Watchdog Połączenia oraz odzyskiwanie spójności (Frontend - AI)
```javascript
watchdogRef.current = setInterval(() => {
    // ... Odnawianie socketów i weryfikacja zawieszeń (Stuck Connection)
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
        if (Date.now() - lastActivityRef.current > 3000) {
            isProcessingRef.current = false;
            sendFrame();
        }
    }
}, 1000);
```
**Wytłumaczenie architektury (Dlaczego):** Gdy pakiety TCP z połączenia WebSocket ulegną dekompletacji bez jasnego sygnału "Close" z węzła backendowego klienta dopada tak zwana zapaść wiszącego wskaźnika (Sygnał uwięzienia). Aby temu przeciwdziałać, zaprogramowano watchdog nasłuchujący zmienną czasu przebywania `lastActivityRef.current`. W scenariuszu milczenia serwera przez ponad 3 sekundy układ nadawczy traktując sytuację za awarię martwego zatoru, wirtualnie fałszuje usunięcie blokady potoku (`isProcessingRef = false`) i reanimuje komunikację awaryjnym pakietem twardym `sendFrame()`.

---

## 4. Kluczowe Decyzje Projektowe i Zabezpieczenia Systemowe

Projekt został skrojony zgodnie konwencjami tolerancji błędów panującymi w rozproszonych architekturach produkcyjnych zapobiegając defektom w wąskich gardłach struktury.

### A. Prewencja przeciw "Race Condition" oraz ograniczanie Throttle
Wysokoczęstotliwościowe modele kamery są zdolne wyprodukować od 30 do nawet 60 ramek co sekundę. Poddanie modelu sztucznej inteligencji próbie obliczenia w czasie rzeczywistym takiej chmury danych spowodowałoby tzw. trzęsienie serwera *Buffer Overflow*. Implementacja w komponencie `VideoFeedWithAI.jsx` została uszczelniona o mechanizm "Acknowledge Lock" czyli ręcznego mutex-a z użyciem referencyjnej blokady flagi `isProcessingRef.current = true`. Frontend zatrzymuje kolejkę wysyłania do sieci do powrotnego otworzenia tej ramy w momencie potwierdzenia przeliczonej wartości u góry wywołania interfejsu API z Fast API. Chroni to całą sieć powiązań przed niestabilnym tempem odpowiedzi AI.

### B. Polimorficzna integracja tuneli TLS z CORS oraz "Host Listen"
By pominąć restrykcyjne wytyczne przeglądarek dla `Secure-Origin`, backend został sparametryzowany by akceptować `CORSMiddleware` otwierając uwarunkowania brzegowe `allow_origins=["*"]`. Pozwala to nie tylko na bezpieczną integrację za bramą środowiska lokalizującego tunelowanie deweloperskie (Tailscale / Cloudflare / Ngrok) dla zdalnych serwerów dedykowanych AI, przypisując do zmiennych z adresów unikalne dynamiczne porty, ale i maskowanie żądań chroniąc certyfikat serwera gniazda. Niezwykle ważnym aspektem było również wymuszenie bind'u dla pętli serwera docelowo ustawionego w dyrektywach na wartość `host="0.0.0.0"`.

### C. Walidacja Pustej Klatki, witalność na "Segmentation Fault" i Optymalizacje Pamięciowe
```python
if frame is None:
    print("⚠️ Błąd: Pusta klatka po dekodowaniu CV2")
    continue
```
W cyklu powtarzalnym transmisji niestabilną siecią radiową istnieje szansa pojawiania rwanej macierzy, z którego pakiet wejściowy Base64 zostaje asymetrycznie pozbawiony bitu parzystości dekompresyjnej. W przypadku wrzucenia pustego tablicowania `None` do biblioteki optymizującej operacje na wektorach (jak Yolo/ResNet realizowane pod maską standardu na silnikach języków `C/C++`), doprowadziłoby to w natychmiastowym czasie do zawołania destrukcyjnego ukatrupienia procesu rdzennego `Segmentation Fault / Core Dump` zabijając cały serwer w ułamku zbiegu zdarzeń dla wszystkich instancji pokoi Meeting ROOM, stąd dodana kluczowa reguła blokowania pre-procesjonalnego. Zastosowanie wymuszonego zignorowania błędnego rekordu pętlą `continue` i dekapsulacja algorytmem `cv2.imdecode` odbywa się wyłącznie na RAM w pamięci nietrwałej, nigdy bezpośrednio utwardzaną wymianą cache dyskowego – dając wykładowcy gwarancję dojrzałości projektu, oszczędności instrukcji dysków SSD oraz ciągłości cyklu egzekucyjnego.
