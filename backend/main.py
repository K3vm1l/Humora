from fastapi import FastAPI, WebSocket
import asyncio
import random
import json

app = FastAPI()

print("Serwer Humora AI startuje...")

@app.websocket("/ws/analyze")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    print("--> Klient połączony (React)")
    
    try:
        while True:
            # 1. Czekamy na dane od Reacta (na razie to będzie tekst "ping" lub obrazek)
            data = await websocket.receive_text()
            
            # (Opcjonalnie) Symulujemy czas przetwarzania przez AI (np. 0.1 sekundy)
            # await asyncio.sleep(0.1) 
            
            # 2. Losujemy wyniki (Mock AI)
            fake_response = {
                "emotion": random.choice(['Radość 😃', 'Smutek 😔', 'Złość 😠', 'Neutralny 😐', 'Zaskoczenie 😲']),
                "age": random.randint(18, 60),
                "gender": random.choice(['Kobieta', 'Mężczyzna'])
            }
            
            # 3. Odsyłamy wynik do Reacta
            await websocket.send_json(fake_response)
            
    except Exception as e:
        print(f"<-- Klient rozłączony: {e}")

# Ten blok pozwala uruchomić plik bezpośrednio przez python main.py
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)