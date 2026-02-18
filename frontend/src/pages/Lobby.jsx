import React, { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import supabase from '../supabaseClient'

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
    const [isLoggedIn, setIsLoggedIn] = useState(false)

    // Remote AI Connection State
    const [useRemoteAi, setUseRemoteAi] = useState(false)
    const [tailscaleIp, setTailscaleIp] = useState(() => {
        return localStorage.getItem('tailscaleIp') || ''
    })

    useEffect(() => {
        const fetchUserProfile = async () => {
            const { data: { session } } = await supabase.auth.getSession();
            if (session) {
                setIsLoggedIn(true);
                const { data } = await supabase.from('profiles').select('username').eq('id', session.user.id).single();
                if (data) {
                    setUserName(data.username);
                }
            }
        };
        fetchUserProfile();
    }, []);

    useEffect(() => {
        let isMounted = true
        let myStream = null

        const startPreview = async () => {
            try {
                // Cleanup old streams first (Phantom Stream Fix)
                if (stream) {
                    stream.getTracks().forEach(track => track.stop())
                }

                const mediaStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })

                // THE CRITICAL CHECK: If the user clicked 'Back' before the camera loaded
                if (!isMounted) {
                    mediaStream.getTracks().forEach(track => { track.stop(); track.enabled = false; });
                    return;
                }

                myStream = mediaStream
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
                if (isMounted) {
                    console.error("Lobby: Error access media", err)
                    setError('Nie można uzyskać dostępu do kamery lub mikrofonu. Sprawdź uprawnienia.')
                    setCamStatus('error')
                    setMicStatus('error')
                }
            }
        }

        startPreview()

        // Cleanup function to stop tracks when component unmounts (or when joining)
        return () => {
            isMounted = false // Signals pending promises to abort

            // Clean local variable stream
            if (myStream) {
                myStream.getTracks().forEach(track => { track.stop(); track.enabled = false; });
            }

            // Clean state stream if it exists (though myStream handles the immediate reference)
            if (stream) {
                stream.getTracks().forEach(track => {
                    track.stop()
                    track.enabled = false
                })
            }
            if (videoRef.current) {
                videoRef.current.srcObject = null
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    useEffect(() => {
        let mockInterval = null;
        let ws = null;

        // CASE A: MOCK MODE (Default)
        if (!useRemoteAi) {
            console.log("🎭 Lobby: Starting Mock Mode (No Network)");
            // Simulate connection delay for better UX
            setTimeout(() => {
                setIsAiConnected(true); // "Connected" to mock
            }, 500);

            // Simulate data updates
            mockInterval = setInterval(() => {
                const mockData = {
                    emotion: ['Radość 😃', 'Smutek 😔', 'Złość 😠', 'Neutralny 😐', 'Zaskoczenie 😲'][Math.floor(Math.random() * 5)],
                    age: Math.floor(Math.random() * (60 - 18 + 1)) + 18,
                    gender: Math.random() > 0.5 ? 'Mężczyzna' : 'Kobieta'
                };
                setAiData(mockData);
            }, 2000);
        }

        // CASE B: REAL AI MODE
        else if (useRemoteAi && tailscaleIp) {
            const cleanIp = tailscaleIp.replace(/https?:\/\//, '');
            const wsUrl = `ws://${cleanIp}:8000/ws/analyze`;
            console.log("🔗 Lobby: Connecting to Real AI...", wsUrl);

            try {
                ws = new WebSocket(wsUrl);
                wsRef.current = ws;

                ws.onopen = () => {
                    console.log("✅ Lobby: Socket Open");
                    setIsAiConnected(true);

                    // Start Frame Sending Loop
                    // Note: Lobby intentionally uses a simpler sending logic than MeetingRoom
                    // to just verify connectivity.
                    const sendingInterval = setInterval(() => {
                        if (ws && ws.readyState === WebSocket.OPEN && videoRef.current && videoRef.current.readyState === 4) {
                            try {
                                const canvas = document.createElement('canvas');
                                canvas.width = 320;
                                canvas.height = 240;
                                const ctx = canvas.getContext('2d');
                                ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
                                const frameData = canvas.toDataURL("image/jpeg", 0.7);
                                ws.send(frameData);
                            } catch (e) {
                                // ignore capture errors in lobby
                            }
                        }
                    }, 1000);

                    // Attach interval to socket object to clear it on close (closure trick)
                    ws.sendingInterval = sendingInterval;
                };

                ws.onmessage = (event) => {
                    try {
                        const data = JSON.parse(event.data);
                        setAiData(data);
                    } catch (e) { }
                };

                ws.onerror = (e) => {
                    console.log("⚠️ Lobby: Socket Error (Check IP)");
                    setIsAiConnected(false);
                };

                ws.onclose = () => {
                    console.log("Lobby: WS Disconnected");
                    setIsAiConnected(false);
                    if (ws.sendingInterval) clearInterval(ws.sendingInterval);
                };

            } catch (e) {
                console.error("Invalid URL");
            }
        }

        // CLEANUP
        return () => {
            if (mockInterval) clearInterval(mockInterval);
            if (ws) {
                if (ws.sendingInterval) clearInterval(ws.sendingInterval);
                ws.close();
                wsRef.current = null;
            }
        };
    }, [useRemoteAi, tailscaleIp]);

    const toggleAudio = () => {
        setIsAudioEnabled(prev => {
            const newState = !prev
            if (stream) {
                stream.getAudioTracks().forEach(track => track.enabled = newState)
            }
            return newState
        })
    }

    const toggleVideo = () => {
        setIsVideoEnabled(prev => {
            const newState = !prev
            if (stream) {
                stream.getVideoTracks().forEach(track => track.enabled = newState)
            }
            return newState
        })
    }

    const handleGoBack = () => {
        if (stream) {
            stream.getTracks().forEach(track => { track.stop(); track.enabled = false; });
            setStream(null)
        }
        if (videoRef.current) {
            videoRef.current.srcObject = null
        }
        navigate('/')
    }

    const handleJoinMeeting = () => {
        if (!userName.trim()) return

        // Save IP for future
        if (tailscaleIp) {
            localStorage.setItem('tailscaleIp', tailscaleIp)
        }

        // Explicitly stop all tracks before navigating to release hardware
        // Explicitly stop all tracks before navigating to release hardware
        if (stream) {
            stream.getTracks().forEach(track => {
                track.stop()
                track.enabled = false
            })
            setStream(null)
        }
        if (videoRef.current) {
            videoRef.current.srcObject = null
        }
        // Navigate to the actual meeting room with userName and AI settings
        navigate(`/meeting/${roomId}`, {
            state: {
                userName,
                isAIEnabled: useRemoteAi,
                aiIP: tailscaleIp,
                startMuted: !isAudioEnabled,
                startVideoOff: !isVideoEnabled
            }
        })
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
        <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center p-6 text-white overflow-hidden relative">
            <button
                onClick={handleGoBack}
                className="absolute top-6 left-6 flex items-center gap-2 text-gray-400 hover:text-white transition-colors font-medium z-50 cursor-pointer"
            >
                <span className="text-xl">⬅️</span> Wróć
            </button>

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
                                        {aiData && aiData.emotion ? aiData.emotion.split(' ')[0] : '...'}
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
                            {isLoggedIn ? (
                                <div className="bg-gray-800 border border-gray-700 rounded-lg p-3 text-center mb-4">
                                    <p className="text-gray-400 text-sm">Dołączasz jako:</p>
                                    <p className="text-white font-bold text-lg">{userName}</p>
                                </div>
                            ) : (
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
                            )}

                            {/* Connection Settings */}
                            <div className="space-y-3 bg-gray-800/30 p-4 rounded-xl border border-white/5">
                                <div className="flex items-center justify-between">
                                    <label className="text-sm font-medium text-gray-300">Połącz z zewnętrznym AI (Tailscale)</label>
                                    <button
                                        onClick={() => setUseRemoteAi(!useRemoteAi)}
                                        className={`w-12 h-6 rounded-full p-1 transition-colors duration-300 ${useRemoteAi ? 'bg-green-500' : 'bg-gray-600'}`}
                                    >
                                        <div className={`w-4 h-4 rounded-full bg-white shadow-md transform transition-transform duration-300 ${useRemoteAi ? 'translate-x-6' : 'translate-x-0'}`} />
                                    </button>
                                </div>

                                {useRemoteAi && (
                                    <input
                                        type="text"
                                        value={tailscaleIp}
                                        onChange={(e) => setTailscaleIp(e.target.value)}
                                        placeholder="IP kolegi, np. 100.x.x.x"
                                        className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-green-500 transition-all font-mono"
                                    />
                                )}
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
