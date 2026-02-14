import React, { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'

export default function Lobby() {
    const { roomId } = useParams()
    const navigate = useNavigate()
    const [stream, setStream] = useState(null)
    const [aiData, setAiData] = useState(null)
    const [isAiConnected, setIsAiConnected] = useState(false)
    const [error, setError] = useState('')

    const videoRef = useRef(null)
    const wsRef = useRef(null)

    // Hardware status & Controls
    const [camStatus, setCamStatus] = useState('checking') // checking, ok, error
    const [micStatus, setMicStatus] = useState('checking')
    const [isAudioEnabled, setIsAudioEnabled] = useState(true)
    const [isVideoEnabled, setIsVideoEnabled] = useState(true)

    // User Nickname State
    const [userName, setUserName] = useState('')

    useEffect(() => {
        const startPreview = async () => {
            try {
                const mediaStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
                setStream(mediaStream)

                if (videoRef.current) {
                    videoRef.current.srcObject = mediaStream
                }

                // Check tracks
                const videoTrack = mediaStream.getVideoTracks()[0]
                const audioTrack = mediaStream.getAudioTracks()[0]

                setCamStatus(videoTrack && videoTrack.readyState === 'live' ? 'ok' : 'error')
                setMicStatus(audioTrack && audioTrack.readyState === 'live' ? 'ok' : 'error')

                setIsVideoEnabled(true)
                setIsAudioEnabled(true)

            } catch (err) {
                console.error("Lobby: Error access media", err)
                setError('Nie można uzyskać dostępu do kamery lub mikrofonu. Sprawdź uprawnienia.')
                setCamStatus('error')
                setMicStatus('error')
            }
        }

        startPreview()

        // Cleanup function to stop tracks when component unmounts (or when joining)
        return () => {
            if (stream) {
                stream.getTracks().forEach(track => track.stop())
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    useEffect(() => {
        // AI WebSocket for Preview
        wsRef.current = new WebSocket('ws://localhost:8000/ws/analyze')
        let intervalId

        wsRef.current.onopen = () => {
            console.log('Lobby: Connected to AI backend')
            setIsAiConnected(true)
            intervalId = setInterval(() => {
                if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                    wsRef.current.send('ping')
                }
            }, 1000)
        }

        wsRef.current.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data)
                setAiData(data)
            } catch (e) {
                // ignore ping responses/errors
            }
        }

        wsRef.current.onclose = () => {
            setIsAiConnected(false)
        }

        return () => {
            clearInterval(intervalId)
            if (wsRef.current) {
                wsRef.current.close()
            }
        }
    }, [])

    const toggleAudio = () => {
        if (stream) {
            const audioTrack = stream.getAudioTracks()[0]
            if (audioTrack) {
                audioTrack.enabled = !audioTrack.enabled
                setIsAudioEnabled(audioTrack.enabled)
            }
        }
    }

    const toggleVideo = () => {
        if (stream) {
            const videoTrack = stream.getVideoTracks()[0]
            if (videoTrack) {
                videoTrack.enabled = !videoTrack.enabled
                setIsVideoEnabled(videoTrack.enabled)
            }
        }
    }

    const handleJoinMeeting = () => {
        if (!userName.trim()) return

        // Explicitly stop all tracks before navigating to release hardware
        if (stream) {
            stream.getTracks().forEach(track => {
                track.stop()
            })
        }
        // Navigate to the actual meeting room with userName in state
        navigate(`/meeting/${roomId}`, { state: { userName } })
    }

    const getEmotionColor = (emotionString) => {
        if (!emotionString) return 'text-white'
        const emotion = emotionString.split(' ')[0].toLowerCase()
        if (['radość', 'szczęście'].includes(emotion)) return 'text-green-400 drop-shadow-[0_0_8px_rgba(74,222,128,0.6)]'
        if (['złość', 'gniew'].includes(emotion)) return 'text-red-500 drop-shadow-[0_0_8px_rgba(239,68,68,0.6)]'
        if (['smutek'].includes(emotion)) return 'text-blue-400 drop-shadow-[0_0_8px_rgba(96,165,250,0.6)]'
        return 'text-white'
    }

    return (
        <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center p-6 text-white overflow-hidden">

            {/* Background Ambience */}
            <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none z-0">
                <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-purple-600/10 rounded-full blur-[100px]"></div>
                <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-blue-600/10 rounded-full blur-[100px]"></div>
            </div>

            <div className="max-w-5xl w-full flex flex-col items-center gap-10 z-10">

                {/* Header */}
                <div className="text-center space-y-3">
                    <h1 className="text-5xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400">
                        Pokój Oczekiwania
                    </h1>
                    <p className="text-gray-400 text-lg">Sprawdź swój wygląd i połączenie</p>
                </div>

                {/* Main Content: Video + Sidebar */}
                <div className="w-full grid grid-cols-1 lg:grid-cols-3 gap-8 items-stretch">

                    {/* Video Preview (Span 2 cols) */}
                    <div className="lg:col-span-2 flex flex-col gap-4">
                        <div className={`relative group overflow-hidden rounded-2xl border-2 border-gray-800 bg-gray-900 aspect-video transition-all duration-300 ${!error && 'shadow-[0_0_30px_rgba(99,102,241,0.15)] hover:shadow-[0_0_40px_rgba(99,102,241,0.25)]'}`}>
                            {error ? (
                                <div className="flex items-center justify-center h-full p-4 text-center text-red-400">
                                    {error}
                                </div>
                            ) : (
                                <>
                                    <video
                                        ref={videoRef}
                                        autoPlay
                                        playsInline
                                        muted
                                        className={`w-full h-full object-cover transform -scale-x-100 transition-opacity duration-300 ${isVideoEnabled ? 'opacity-100' : 'opacity-0'}`}
                                    />
                                    {!isVideoEnabled && (
                                        <div className="absolute inset-0 flex items-center justify-center bg-gray-900">
                                            <div className="flex flex-col items-center text-gray-500 space-y-2">
                                                <span className="text-4xl">📷</span>
                                                <span>Kamera wyłączona</span>
                                            </div>
                                        </div>
                                    )}
                                </>
                            )}

                            {/* Controls Overlay */}
                            <div className="absolute bottom-6 left-1/2 transform -translate-x-1/2 flex items-center gap-4 bg-black/60 backdrop-blur-md px-6 py-3 rounded-full border border-white/10 shadow-lg">
                                <button
                                    onClick={toggleAudio}
                                    className={`p-3 rounded-full transition-all ${isAudioEnabled ? 'bg-gray-700 hover:bg-gray-600 text-white' : 'bg-red-500/20 text-red-400 hover:bg-red-500/30'}`}
                                    title={isAudioEnabled ? "Wycisz mikrofon" : "Włącz mikrofon"}
                                >
                                    {isAudioEnabled ? '🎤' : '🔇'}
                                </button>
                                <button
                                    onClick={toggleVideo}
                                    className={`p-3 rounded-full transition-all ${isVideoEnabled ? 'bg-gray-700 hover:bg-gray-600 text-white' : 'bg-red-500/20 text-red-400 hover:bg-red-500/30'}`}
                                    title={isVideoEnabled ? "Wyłącz kamerę" : "Włącz kamerę"}
                                >
                                    {isVideoEnabled ? '📷' : '🚫'}
                                </button>
                            </div>
                        </div>

                        <div className="flex justify-center gap-6 text-sm">
                            <div className={`flex items-center gap-2 ${camStatus === 'ok' ? 'text-green-400' : 'text-red-400'}`}>
                                <span className={`w-2 h-2 rounded-full ${camStatus === 'ok' ? 'bg-green-500' : 'bg-red-500'}`}></span>
                                {camStatus === 'ok' ? 'Kamera aktywna' : 'Problem z kamerą'}
                            </div>
                            <div className={`flex items-center gap-2 ${micStatus === 'ok' ? 'text-green-400' : 'text-red-400'}`}>
                                <span className={`w-2 h-2 rounded-full ${micStatus === 'ok' ? 'bg-green-500' : 'bg-red-500'}`}></span>
                                {micStatus === 'ok' ? 'Mikrofon aktywny' : 'Problem z mikrofonem'}
                            </div>
                        </div>
                    </div>

                    {/* Right Sidebar: AI Profile & Join */}
                    <div className="flex flex-col gap-6">

                        {/* AI Profile Card */}
                        <div className="bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-white/10 p-6 shadow-xl flex-1 flex flex-col">
                            <h2 className="text-xl font-semibold text-white mb-6 flex items-center gap-2">
                                <span>🤖</span> Twój Profil AI
                            </h2>

                            <div className="flex-1 flex flex-col items-center justify-center text-center space-y-6">
                                <div className="relative">
                                    <div className={`w-24 h-24 rounded-full flex items-center justify-center bg-gray-800 border-2 ${isAiConnected ? 'border-green-500/50' : 'border-gray-700'}`}>
                                        <span className="text-4xl">{aiData?.emotion ? '🙂' : '⏳'}</span>
                                    </div>
                                    {isAiConnected && (
                                        <div className="absolute -bottom-1 -right-1 bg-green-500 text-black text-[10px] font-bold px-2 py-0.5 rounded-full border border-gray-900">
                                            LIVE
                                        </div>
                                    )}
                                </div>

                                <div>
                                    <p className="text-sm text-gray-500 uppercase tracking-wider mb-2">Wykryte Emocje</p>
                                    <div className={`text-3xl font-bold transition-all duration-300 ${getEmotionColor(aiData?.emotion)}`}>
                                        {aiData ? aiData.emotion.split(' ')[0] : '...'}
                                    </div>
                                </div>

                                <div className="w-full bg-gray-800/50 p-4 rounded-xl border border-white/5 grid grid-cols-2 gap-4 text-sm">
                                    <div>
                                        <p className="text-gray-500">Wiek</p>
                                        <p className="font-mono text-gray-300">{aiData?.age || '--'}</p>
                                    </div>
                                    <div>
                                        <p className="text-gray-500">Płeć</p>
                                        <p className="font-mono text-gray-300">{aiData?.gender || '--'}</p>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Join Section with Nickname */}
                        <div className="space-y-4">
                            <div className="space-y-1">
                                <label className="text-xs font-bold text-gray-500 uppercase tracking-widest ml-1">Twój Nick</label>
                                <input
                                    type="text"
                                    value={userName}
                                    onChange={(e) => setUserName(e.target.value)}
                                    placeholder="Wpisz swój nick..."
                                    className="w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all font-medium"
                                />
                            </div>

                            <button
                                onClick={handleJoinMeeting}
                                disabled={camStatus !== 'ok' || !userName.trim()}
                                className={`w-full py-5 rounded-2xl font-bold text-xl shadow-lg transition-all transform active:scale-95 flex items-center justify-center gap-3 group relative overflow-hidden
                                    ${camStatus === 'ok' && userName.trim()
                                        ? 'bg-indigo-600 hover:bg-indigo-500 text-white animate-pulse-slow'
                                        : 'bg-gray-800 text-gray-500 cursor-not-allowed opacity-50'}`}
                            >
                                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:animate-shimmer" />
                                <span>Dołącz teraz</span>
                                <span className="group-hover:translate-x-1 transition-transform">➔</span>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
