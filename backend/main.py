from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
import base64
import numpy as np
import cv2
import json
import random
import asyncio

app = FastAPI()

# 1. CORS - Odblokowujemy wszystko dla Tailscale
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

print("🚀 Serwer AI (Tailscale Edition) startuje...")

@app.websocket("/ws/analyze")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    print(f"✅ Klient połączony: {websocket.client}")

    try:
        while True:
            # Czekamy na dane (React wysyła Base64 String)
            data = await websocket.receive_text()

            # --- DIAGNOSTYKA (Opcjonalne, odkomentuj jak dalej nie działa) ---
            print(f"📨 Odebrano {len(data)} znaków. Początek: {data[:30]}...") 

            # 1. Czyszczenie nagłówka (React wysyła "data:image/jpeg;base64,.....")
            if "base64," in data:
                # Bierzemy tylko to co jest PO przecinku
                data = data.split("base64,")[1]
            
            # 2. Dekodowanie
            try:
                image_bytes = base64.b64decode(data)
                np_arr = np.frombuffer(image_bytes, np.uint8)
                frame = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)

                if frame is None:
                    print("⚠️ Błąd: Pusta klatka po dekodowaniu CV2")
                    continue
                
                # --- TU BYŁA ANALIZA AI ---
                # (Na razie symulacja, żeby wykluczyć błędy modelu)
                
                # Symulujemy pracę modelu (ważne dla płynności)
                # await asyncio.sleep(0.05)

                response = {
                    "emotion": random.choice(['Szczęście 😄', 'Zaskoczenie 😲', 'Neutralny 😐']),
                    "age": random.randint(20, 40),
                    "gender": "Kobieta" if random.random() > 0.5 else "Mężczyzna"
                }

                await websocket.send_json(response)

            except Exception as e:
                print(f"⚠️ Błąd przetwarzania klatki: {e}")
                # NIE ZRYWAMY POŁĄCZENIA! Idziemy do następnej klatki.
                continue

    except WebSocketDisconnect:
        print("🔴 Klient rozłączył się poprawnie (Disconnect).")
    except Exception as e:
        print(f"🔥 BŁĄD KRYTYCZNY POŁĄCZENIA: {e}")

if __name__ == "__main__":
    # Host 0.0.0.0 jest KLUCZOWY dla Tailscale
    uvicorn.run(app, host="0.0.0.0", port=8000)