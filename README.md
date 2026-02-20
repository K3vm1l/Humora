# 🤖 Humora_AI - System Wideokonferencji z Analizą Emocji w Czasie Rzeczywistym

![Status](https://img.shields.io/badge/Status-Complete-success)
![React](https://img.shields.io/badge/Frontend-React-61dafb)
![Tailwind](https://img.shields.io/badge/Styling-TailwindCSS-38b2ac)
![PeerJS](https://img.shields.io/badge/Networking-PeerJS-red)
![FastAPI](https://img.shields.io/badge/Backend-FastAPI-009688)

Aplikacja do wideokonferencji, która nie tylko pozwala na rozmowę wideo w modelu P2P, ale wykorzystuje Sztuczną Inteligencję do analizy emocji każdego uczestnika w czasie rzeczywistym.

## 🚀 Kluczowe Funkcje
- **P2P Video Calls:** Stabilne połączenia wideo i audio dzięki bibliotece PeerJS.
- **Indywidualna Analiza AI:** Każdy uczestnik posiada własny potok (pipeline) analizy danych. Wyniki (emocje, wiek, płeć) są wyświetlane na dedykowanych wykresach pod każdym strumieniem wideo.
- **Architektura Hybrydowa:** Frontend serwowany z chmury (Vercel) łączący się z lokalnym modułem AI poprzez bezpieczne tunele (Cloudflare Tunnels).
- **Interaktywne Lobby:** Możliwość wyboru lokalnego lub zewnętrznego serwera AI.
- **Funkcja "Podnieś Rękę":** Sygnalizacja wizualna dla lepszej moderacji spotkania.
- **Modern UI:** Interfejs oparty na Glassmorphismie, z dynamicznym, animowanym tłem (Particles.js) i responsywnym layoutem.

## 🏗️ Architektura Systemu

Projekt wykorzystuje nowoczesne podejście do rozproszonych systemów AI:
1. **Frontend (React):** Odpowiada za renderowanie interfejsu, zarządzanie stanem PeerJS oraz izolację komponentów `VideoFeedWithAI`.
2. **Backend AI (FastAPI/OpenCV):** Moduł przetwarzający klatki wideo, wykonujący predykcje i odsyłający wyniki przez WebSocket.
3. **Komunikacja:** Dane binarne obrazu przesyłane są przez WebSockety, co zapewnia minimalne opóźnienia.



## 🛠️ Technologie
- **Frontend:** React, Tailwind CSS, Framer Motion, Recharts.
- **Real-time:** PeerJS (WebRTC), WebSockets.
- **AI/ML:** Python, FastAPI, OpenCV, TensorFlow/Keras.
- **Background:** React-tsparticles.

## 📦 Instalacja i Uruchomienie

### Frontend
1. Sklonuj repozytorium:
   ```bash
   git clone https://github.com/K3vm1l/Humora.git
  
Zainstaluj zależności:
Bash
cd Humora_frontend
cd frontend
npm install

Uruchom aplikację:
Bash
npm run dev
Backend (Moduł AI)
Upewnij się, że masz zainstalowanego Pythona 3.9+.

Zainstaluj wymagane biblioteki:
Bash
pip install fastapi uvicorn opencv-python tensorflow numpy

Uruchom serwer:
Bash
uvicorn main:app --host 0.0.0.0 --port 8000

🌐 Deployment
Aplikacja jest przystosowana do hostingu na platformie Vercel. Aby połączyć ją z lokalnym serwerem AI, zaleca się użycie Cloudflare Tunnels:
Bash
cloudflared tunnel --url http://localhost:8000

👨‍💻 Autorzy

K3vm1l / Kamil Szydłowski


Projekt zrealizowany z pasją do AI i nowoczesnych technologii webowych.