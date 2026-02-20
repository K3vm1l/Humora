# 🤖 Humora AI - System Wideokonferencji z Analizą Emocji w Czasie Rzeczywistym

![Status](https://img.shields.io/badge/Status-Complete-success)
![React](https://img.shields.io/badge/Frontend-React-61dafb)
![Tailwind](https://img.shields.io/badge/Styling-TailwindCSS-38b2ac)
![PeerJS](https://img.shields.io/badge/Networking-PeerJS-red)
![FastAPI](https://img.shields.io/badge/Backend-FastAPI-009688)

Aplikacja do wideokonferencji, która nie tylko pozwala na rozmowę wideo w modelu rozproszonym P2P, ale również wykorzystuje Sztuczną Inteligencję do zaawansowanej analizy emocji każdego uczestnika w czasie rzeczywistym.

## 🚀 Kluczowe Funkcje

- **P2P Video Calls:** Stabilne połączenia wideo i audio napędzane przez serwery STUN/TURN i bibliotekę PeerJS.
- **Indywidualna Analiza AI:** Każdy uczestnik posiada własny potok (pipeline) analizy danych wejściowych wysyłając spersonalizowane klatki. Wyniki (emocje, wiek, płeć) są estymowane i asynchronicznie odsyłane na frontend.
- **Wizualny Raport AI:** Wbudowany generator zrzutów ekranu i raportów graficznych na wirtualnym Canvasie (.JPG) połączony z dynamicznym odwzorowaniem kolorystycznym emocji i statystyką z sesji (funkcja działa w 100% bezpiecznie w chmurze przeglądarki usera).
- **Architektura Hybrydowa:** Frontend przystosowany do serwowania z chmury (Vercel) łączący się z niezależnym backendowym modułem inferencji (np. za pomocą bezpiecznego tunelu Cloudflare Tunnels).
- **Narzędzia Pokoju:** Wbudowany zoptymalizowany Czat Tekstowy, dedykowany Timer trwania rozmowy na żywo i funkcja "Podnieś Rękę" do lepszej moderacji spotkania.
- **Modern UI:** Interfejs zaprojektowany zgodnie z nurtem Glassmorphism, wyposażony w responsywny layout, animacyjne wykresy `recharts` sprzężone z danymi AI oraz aktywne cząsteczki tle (Particles.js).

## 🏗️ Architektura Systemu

Projekt wykorzystuje zwinne i nowoczesne podejście do rozproszonych systemów AI opartych o konwencję Klient-Serwer Edge:

1. **Frontend (React.js):** Odpowiada za zarządzanie stanem WebRTC, renderowanie DOM oraz izolację zasobożernych koprocesorów strumieni poprzez komponenty takie jak np. `VideoFeedWithAI`.
2. **Backend AI (FastAPI/OpenCV):** Jednowątkowy, bezstanowy demon przetwarzający spakowane zdjęcia, obrabiający uczyńienia na tablicach Tensorowych i odsyłający format JSON z powrotem.
3. **Komunikacja Tunelowa:** Dane binarne obrazu przesyłane są w protokołach kompresji stratnej (base64/jpeg) bezpośrednio przez kanały WebSockets, omijając negocjacje certyfikatowe TLS na rzecz ekstremalnej redukcji opóźnień (LATENCY).

## 🛠️ Technologie

- **Frontend:** React, Tailwind CSS, Vite, Recharts, Framer Motion
- **Networking/Real-time:** PeerJS (WebRTC), WebSockets, Supabase (Sygnalizacja Relay)
- **AI/Backend:** Python, FastAPI, Uvicorn, OpenCV, modele Deep Learning (np. TensorFlow)

---

## 📦 Instalacja i Uruchomienie

### Frontend

1. Sklonuj repozytorium:
   ```bash
   git clone https://github.com/K3vm1l/Humora.git
   ```

2. Zainstaluj zależności:
   ```bash
   cd Humora_frontend
   cd frontend
   npm install
   ```

3. Uruchom aplikację:
   ```bash
   npm run dev
   ```

### Backend (Moduł AI - Node Inference)

Upewnij się, że masz poprawnie zainstalowanego i wyeksportowanego do PATH Pythona 3.9+.

1. Zainstaluj wymagane pakiety binarne i biblioteki:
   ```bash
   pip install fastapi uvicorn opencv-python tensorflow numpy
   ```

2. Uruchom serwer na nasłuchu wszystkich interfejsów ruterowych:
   ```bash
   uvicorn main:app --host 0.0.0.0 --port 8000
   ```

---

## 🌐 Deployment (Serwer & Tunele)

Aplikacja kliencka jest idealnie przystosowana do hostingu Edge na platformie **Vercel** lub **Netlify**. 
Aby swobodnie połączyć publicznie wystawiony Frontend dla swoich znajomych z własnym lokalnym serwerem AI uruchomionym np. na domowym PC z potężnym GPU, rekomendowane jest zestawienie bramy **Cloudflare Tunnels**. Pozwoli to ominąć kłopoty z udostępnianiem portów (Port Forwarding):

   ```bash
   cloudflared tunnel --url http://localhost:8000
   ```
Utworzony w ten sposób dynamiczny link wklejamy w formularzu ekranu początkowego aplikacji (*Lobby*).

## 👨‍💻 Autorzy

**Kamil Szydłowski (K3vm1l)**

Projekt zaprogramowany i zaprojektowany z głęboką uwagą na detale, podyktowany miłością do użytecznych narzędzi z zakresu sztucznej inteligencji, inżynierii wydajności webowej oraz architektury rozproszonej.
