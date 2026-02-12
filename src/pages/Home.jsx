import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'

export default function Home() {
    const [roomId, setRoomId] = useState('')
    const navigate = useNavigate()

    const handleJoin = () => {
        if (roomId) navigate(`/room/${roomId}`)
    }

    return (
        <div>
            <h1>Strona Główna</h1>
            <input
                type="text"
                placeholder="ID pokoju"
                value={roomId}
                onChange={(e) => setRoomId(e.target.value)}
            />
            <button onClick={handleJoin}>Dołącz</button>
        </div>
    )
}
