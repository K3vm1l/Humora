import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'

export default function Home() {
    const [roomId, setRoomId] = useState('')
    const navigate = useNavigate()

    const handleJoin = (e) => {
        e.preventDefault()
        if (roomId) navigate(`/lobby/${roomId}`)
    }

    return (
        <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
            <div className="bg-gray-800 rounded-2xl shadow-2xl p-8 w-full max-w-md">
                <div className="text-center mb-8">
                    <h1 className="text-5xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-600 mb-2">
                        Humora
                    </h1>
                    <p className="text-gray-400">
                        AI-Powered Emotion Analytics
                    </p>
                </div>

                <form onSubmit={handleJoin} className="space-y-6">
                    <div>
                        <input
                            type="text"
                            placeholder="Wpisz ID pokoju"
                            value={roomId}
                            onChange={(e) => setRoomId(e.target.value)}
                            className="w-full bg-gray-700 text-white p-3 rounded-lg border border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-400 transition-all"
                        />
                    </div>

                    <button
                        type="submit"
                        className="w-full bg-gradient-to-r from-blue-500 to-purple-600 text-white font-semibold p-3 rounded-lg hover:scale-105 transition-transform duration-200 shadow-lg"
                    >
                        Dołącz
                    </button>
                </form>
            </div>
        </div>
    )
}
