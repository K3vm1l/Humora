import React, { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import Peer from 'peerjs'
import { LineChart, Line, ResponsiveContainer, Tooltip, XAxis } from 'recharts'
import supabase from '../supabaseClient'

export default function MeetingRoom() {
    const { roomId } = useParams()
    const navigate = useNavigate()
    const location = useLocation()
    const userName = location.state?.userName || 'Gość'
    const useRemoteAi = location.state?.useRemoteAi || false
    const tailscaleIp = location.state?.tailscaleIp || ''

    const [myPeerId, setMyPeerId] = useState('')
    const [remotePeerId, setRemotePeerId] = useState('')
    const [remoteUserName, setRemoteUserName] = useState('Oczekiwanie...')

    // Media Control State (Initialized from Lobby)
    const [isAudioMuted, setIsAudioMuted] = useState(location.state?.startMuted || false)
    const [isVideoOff, setIsVideoOff] = useState(location.state?.startVideoOff || false)

    // Chat State
    const [messages, setMessages] = useState([])
    const [chatInput, setChatInput] = useState('')
    const chatScrollRef = useRef(null)

    const [aiData, setAiData] = useState(null)
    const [history, setHistory] = useState([])
    const [isAiConnected, setIsAiConnected] = useState(false)

    const videoRef = useRef(null)
    const remoteVideoRef = useRef(null)
    const peerInstance = useRef(null)
    const wsRef = useRef(null)
    const localStreamRef = useRef(null)
    const isProcessingRef = useRef(false)
    const roomChannelRef = useRef(null)

    // Robust cleanup function


    useEffect(() => {
        let isMounted = true;
        let myStream = null;
        let myPeer = null;
        let roomChannel = null;

        const initRoom = async () => {
            try {
                // 1. GET MEDIA FIRST
                myStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })

                // Apply initial mute states (from Lobby)
                const initialAudioMuted = location.state?.startMuted || false
                const initialVideoOff = location.state?.startVideoOff || false

                myStream.getAudioTracks().forEach(t => t.enabled = !initialAudioMuted)
                myStream.getVideoTracks().forEach(t => t.enabled = !initialVideoOff)

                // If component unmounted while waiting for camera, kill it immediately
                if (!isMounted) {
                    myStream.getTracks().forEach(t => t.stop())
                    return
                }

                // Save to refs for the UI to control
                localStreamRef.current = myStream
                // Also update global variable if used elsewhere, though ref is preferred
                window.localStream = myStream

                if (videoRef.current) videoRef.current.srcObject = myStream

                // 2. INITIALIZE PEERJS ONLY AFTER MEDIA IS READY
                myPeer = new Peer()
                peerInstance.current = myPeer

                myPeer.on('open', (id) => {
                    setMyPeerId(id)

                    // 3. SETUP SUPABASE SIGNALING
                    roomChannel = supabase.channel(`room-${roomId}`)
                    roomChannelRef.current = roomChannel

                    roomChannel.subscribe(async (status) => {
                        if (status === 'SUBSCRIBED') {
                            await roomChannel.send({
                                type: 'broadcast',
                                event: 'peer-joined',
                                payload: { peerId: id, userName: userName }
                            })
                        }
                    })

                    roomChannel.on('broadcast', { event: 'peer-joined' }, (payload) => {
                        const { peerId: remotePeerId, userName: remoteName } = payload.payload;
                        console.log('Peer joined:', remoteName, remotePeerId)
                        setRemoteUserName(remoteName);

                        // Call other peer with our ONLY stream
                        const call = myPeer.call(remotePeerId, myStream, { metadata: { callerName: userName } })
                        call.on('stream', (remoteStream) => {
                            if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remoteStream
                        })
                    })
                        .on('broadcast', { event: 'chat-message' }, (payload) => {
                            setMessages((prev) => {
                                if (prev.some(msg => msg.id === payload.payload.id)) return prev;
                                return [...prev, payload.payload];
                            });
                        });
                })

                // 4. ANSWER INCOMING CALLS
                myPeer.on('call', (call) => {
                    if (call.metadata?.callerName) setRemoteUserName(call.metadata.callerName)
                    call.answer(myStream) // Answer with our ONLY stream
                    call.on('stream', (remoteStream) => {
                        if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remoteStream
                    })
                })

            } catch (err) {
                console.error('Błąd kamery/mikrofonu:', err)
            }
        }

        initRoom()

        // 5. BULLETPROOF CLEANUP (KILLS GHOSTS)
        return () => {
            isMounted = false

            // 1. Forcefully detach streams from the HTML video elements
            if (videoRef.current) videoRef.current.srcObject = null
            if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null

            if (myStream) myStream.getTracks().forEach(track => {
                track.stop()
                track.enabled = false
            })
            if (myPeer) myPeer.destroy()
            if (roomChannel) supabase.removeChannel(roomChannel)

            // Clean refs
            localStreamRef.current = null
            window.localStream = null
            peerInstance.current = null
            roomChannelRef.current = null
        }
    }, [roomId, userName, location.state])

    useEffect(() => {
        // Dynamic WebSocket URL
        const wsUrl = (useRemoteAi && tailscaleIp)
            ? `ws://${tailscaleIp}:8000/ws/analyze`
            : 'ws://localhost:8000/ws/analyze'

        console.log(`Attempting connection to AI at: ${wsUrl}`)
        wsRef.current = new WebSocket(wsUrl)
        let intervalId

        wsRef.current.onopen = () => {
            console.log('Connected to AI backend')
            setIsAiConnected(true)
            intervalId = setInterval(() => {
                if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                    // Optimized video sending
                    if (!isProcessingRef.current && videoRef.current) {
                        try {
                            isProcessingRef.current = true // Lock
                            const canvas = document.createElement('canvas')
                            canvas.width = 320 // Downscale
                            canvas.height = 240
                            const ctx = canvas.getContext('2d')
                            ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height)
                            const base64Data = canvas.toDataURL('image/jpeg', 0.5) // Compress
                            wsRef.current.send(base64Data)
                        } catch (err) {
                            console.error("Frame capture error:", err)
                            isProcessingRef.current = false
                        }
                    } else if (wsRef.current.readyState === WebSocket.OPEN) {
                        // Keep-alive if not sending video
                        // wsRef.current.send('ping') -> Using ping here might conflict if video is frequent
                    }
                }
            }, 1000) // 1 FPS
        }

        wsRef.current.onmessage = (event) => {
            try {
                isProcessingRef.current = false // Unlock
                const data = JSON.parse(event.data)
                setAiData(data)

                // Update History
                console.log("Otrzymane aiData:", data)
                if (data && data.emotion) {
                    setHistory(prev => {
                        const newScore = getEmotionScore(data.emotion)
                        // Safety: Skip invalid scores to prevent chart crashes
                        if (typeof newScore !== 'number' || isNaN(newScore)) return prev

                        const newPoint = {
                            time: new Date().toLocaleTimeString('pl-PL', { hour12: false, hour: "numeric", minute: "numeric", second: "numeric" }),
                            score: newScore,
                            emotion: data.emotion.split(' ')[0]
                        }
                        const newHistory = [...prev, newPoint]
                        return newHistory.slice(-30) // Keep last 30 points
                    })
                }

            } catch (e) {
                console.error('Error parsing AI data:', e)
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
    }, [useRemoteAi, tailscaleIp])

    const callUser = (remoteId) => {
        const stream = window.localStream || localStreamRef.current
        if (!stream) {
            console.warn("No local stream available to make call")
            return
        }

        const call = peerInstance.current.call(remoteId, stream)
        call.on('stream', (remoteStream) => {
            if (remoteVideoRef.current) {
                remoteVideoRef.current.srcObject = remoteStream
            }
        })
    }

    const leaveRoom = () => {
        // 1. Forcefully detach streams from the HTML video elements
        if (videoRef.current) videoRef.current.srcObject = null;
        if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;

        // 2. Stop all hardware tracks aggressively
        if (localStreamRef.current) {
            localStreamRef.current.getTracks().forEach(track => {
                track.stop();
                track.enabled = false;
            });
            localStreamRef.current = null; // Clear the ref
        }

        // 3. Destroy Peer connection
        if (peerInstance.current) {
            peerInstance.current.destroy();
            peerInstance.current = null;
        }

        // 4. Navigate home
        navigate('/');
    }

    const toggleAudio = () => {
        setIsAudioMuted(prev => {
            const newState = !prev;
            if (localStreamRef.current) {
                localStreamRef.current.getAudioTracks().forEach(track => track.enabled = !newState);
            }
            return newState;
        });
    };

    const toggleVideo = () => {
        setIsVideoOff(prev => {
            const newState = !prev;
            if (localStreamRef.current) {
                localStreamRef.current.getVideoTracks().forEach(track => track.enabled = !newState);
            }
            return newState;
        });
    };

    const handleSendMessage = async (e) => {
        e.preventDefault()
        if (!chatInput.trim()) return

        const newMessage = {
            id: crypto.randomUUID(),
            sender: userName,
            text: chatInput.trim(),
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }

        // Optimistic update
        setMessages((prev) => [...prev, newMessage])
        setChatInput('')

        // Broadcast to others
        if (roomChannelRef.current) {
            await roomChannelRef.current.send({
                type: 'broadcast',
                event: 'chat-message',
                payload: newMessage
            })
        }
    }

    // Auto-scroll chat
    useEffect(() => {
        if (chatScrollRef.current) {
            chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight
        }
    }, [messages])

    // Helper to get score from emotion
    const getEmotionScore = (emotionString) => {
        if (!emotionString || typeof emotionString !== 'string') return 0
        const emotion = emotionString.toLowerCase().trim()
        if (emotion.includes('happy') || emotion.includes('joy') || emotion.includes('radość') || emotion.includes('szczęście')) return 100
        if (emotion.includes('surprise') || emotion.includes('zaskoczenie')) return 70
        if (emotion.includes('neutral') || emotion.includes('naturalny')) return 50
        if (emotion.includes('sad') || emotion.includes('fear') || emotion.includes('disgust') || emotion.includes('smutek') || emotion.includes('strach') || emotion.includes('obrzydzenie')) return 20
        if (emotion.includes('angry') || emotion.includes('anger') || emotion.includes('złość') || emotion.includes('gniew')) return 10
        return 0 // Default fallback
    }

    // Helper to determine emotion color
    const getEmotionColor = (emotionString) => {
        if (!emotionString || typeof emotionString !== 'string') return 'text-white'
        const emotion = emotionString.split(' ')[0].toLowerCase()
        if (['radość', 'szczęście'].includes(emotion)) return 'text-green-400 drop-shadow-[0_0_10px_rgba(74,222,128,0.5)]'
        if (['złość', 'gniew'].includes(emotion)) return 'text-red-500 drop-shadow-[0_0_10px_rgba(239,68,68,0.5)]'
        if (['smutek'].includes(emotion)) return 'text-blue-400 drop-shadow-[0_0_10px_rgba(96,165,250,0.5)]'
        if (['strach', 'lęk'].includes(emotion)) return 'text-purple-400 drop-shadow-[0_0_10px_rgba(192,132,252,0.5)]'
        if (['zaskoczenie'].includes(emotion)) return 'text-yellow-400 drop-shadow-[0_0_10px_rgba(250,204,21,0.5)]'
        return 'text-white'
    }

    // Helper for Hex color for Chart Line
    const getEmotionHexColor = (emotionString) => {
        if (!emotionString || typeof emotionString !== 'string') return '#8b5cf6'
        const emotion = emotionString.split(' ')[0].toLowerCase()
        if (['radość', 'szczęście', 'happy', 'joy'].some(e => emotion.includes(e))) return '#4ade80' // green-400
        if (['złość', 'gniew', 'angry'].some(e => emotion.includes(e))) return '#ef4444' // red-500
        if (['smutek', 'sad'].some(e => emotion.includes(e))) return '#60a5fa' // blue-400
        if (['strach', 'lęk', 'fear'].some(e => emotion.includes(e))) return '#c084fc' // purple-400
        if (['zaskoczenie', 'surprise'].some(e => emotion.includes(e))) return '#facc15' // yellow-400
        return '#8b5cf6' // default violet
    }

    // Extract percentage from emotion string if present
    const getEmotionPercentage = (emotionString) => {
        if (!emotionString) return 0;
        const match = emotionString.match(/(\d+)%/);
        return match ? parseInt(match[1]) : 0;
    }

    // Capture Report Function
    const captureReport = () => {
        if (!videoRef.current) return

        // Flash animation
        const btn = document.getElementById('capture-btn')
        if (btn) {
            btn.classList.add('animate-ping')
            setTimeout(() => btn.classList.remove('animate-ping'), 200)
        }

        const canvas = document.createElement('canvas')
        const video = videoRef.current
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        const ctx = canvas.getContext('2d')

        // specialized flip for local video mirroring
        ctx.translate(canvas.width, 0)
        ctx.scale(-1, 1)
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
        ctx.setTransform(1, 0, 0, 1, 0, 0) // Reset for text

        // Overlay Styles
        const gradient = ctx.createLinearGradient(0, 0, 0, 300)
        gradient.addColorStop(0, 'rgba(0,0,0,0.9)')
        gradient.addColorStop(1, 'rgba(0,0,0,0)')
        ctx.fillStyle = gradient
        ctx.fillRect(0, 0, canvas.width, 300)

        // Text Shadow Config
        ctx.shadowColor = 'rgba(0, 0, 0, 0.8)'
        ctx.shadowBlur = 4
        ctx.shadowOffsetX = 2
        ctx.shadowOffsetY = 2

        let yPos = 40

        // Title
        ctx.font = 'bold 30px monospace'
        ctx.fillStyle = '#ffffff'
        ctx.fillText('HUMORA AI REPORT', 24, yPos)
        yPos += 35

        // User
        ctx.font = '22px monospace'
        ctx.fillStyle = '#fbbf24' // amber
        ctx.fillText(`USER: ${userName?.toUpperCase() || 'ANONYMOUS'}`, 24, yPos)
        yPos += 30

        // Date
        ctx.font = '18px monospace'
        ctx.fillStyle = '#9ca3af' // gray
        ctx.fillText(new Date().toLocaleString('pl-PL'), 24, yPos)
        yPos += 40

        // AI Data
        if (aiData) {
            // Emotion
            ctx.font = 'bold 22px monospace'
            ctx.fillStyle = '#4ade80' // green
            const emotionText = aiData.emotion ? aiData.emotion.split(' ')[0].toUpperCase() : 'UNKNOWN'
            ctx.fillText(`EMOTION: ${emotionText}`, 24, yPos)
            yPos += 35

            // Age
            ctx.font = 'bold 22px monospace'
            ctx.fillStyle = '#fbbf24' // amber
            ctx.fillText(`AGE: ${aiData.age || '--'}`, 24, yPos)
            yPos += 35

            // Gender
            ctx.font = 'bold 22px monospace'
            ctx.fillStyle = '#ffffff' // white
            ctx.fillText(`GENDER: ${aiData.gender || '--'}`, 24, yPos)
        } else {
            ctx.font = 'italic 20px monospace'
            ctx.fillStyle = '#aaaaaa'
            ctx.fillText('Waiting for analysis...', 24, yPos)
        }

        // Download
        const link = document.createElement('a')
        link.download = `humora-report-${userName}-${Date.now()}.png`
        link.href = canvas.toDataURL('image/png')
        link.click()
    }

    return (
        <div className="h-screen bg-gray-950 flex flex-col md:flex-row text-white overflow-hidden">

            {/* Main Content Area (Videos) */}
            <div className="flex-1 flex flex-col relative p-4 pb-24 h-full overflow-y-auto w-full">
                {/* Header Info (moved to main area corner) */}
                <div className="absolute top-6 right-6 bg-gray-900/80 backdrop-blur px-4 py-2 rounded-lg border border-gray-800 text-gray-300 text-sm z-20">
                    <p>Pokój: <span className="text-white font-mono">{roomId}</span></p>
                    <p>ID: <span className="text-white font-mono">{myPeerId}</span></p>
                </div>

                {/* Video Grid */}
                <div className="flex-1 flex flex-col items-center justify-center gap-6 w-full max-w-6xl mx-auto">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full">
                        {/* Local Video */}
                        <div className="relative group overflow-hidden rounded-2xl border-2 border-gray-800 shadow-2xl bg-gray-900 aspect-video">
                            <video
                                ref={videoRef}
                                autoPlay
                                playsInline
                                muted
                                className="w-full h-full object-cover transform -scale-x-100"
                            />
                            <div className="absolute bottom-4 right-4 bg-black/50 px-2 py-1 rounded text-xs text-white z-20">
                                {userName} (Ty)
                            </div>
                        </div>

                        {/* Remote Video */}
                        <div className="relative rounded-2xl overflow-hidden border-2 border-gray-800 shadow-2xl bg-gray-900 aspect-video">
                            <video
                                ref={remoteVideoRef}
                                autoPlay
                                playsInline
                                className="w-full h-full object-cover"
                            />
                            <div className="absolute bottom-4 right-4 bg-black/50 px-2 py-1 rounded text-xs text-white">
                                {remoteUserName}
                            </div>
                            <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-0 peer-checked:opacity-100">
                                {/* Waiting logic */}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Controls (Floating centered in main area) */}
                <div className="fixed bottom-8 left-1/2 md:left-[calc(50%-10rem)] transform -translate-x-1/2 bg-gray-900/90 backdrop-blur-lg border border-gray-800 p-4 rounded-full shadow-2xl flex items-center gap-4 z-50">
                    <button
                        onClick={toggleAudio}
                        className={`p-4 rounded-full transition-all ${isAudioMuted ? 'bg-red-500 hover:bg-red-600' : 'bg-gray-700 hover:bg-gray-600'}`}
                        title={isAudioMuted ? "Włącz mikrofon" : "Wycisz mikrofon"}
                    >
                        {isAudioMuted ? '🔇' : '🎤'}
                    </button>
                    <button
                        onClick={toggleVideo}
                        className={`p-4 rounded-full transition-all ${isVideoOff ? 'bg-red-500 hover:bg-red-600' : 'bg-gray-700 hover:bg-gray-600'}`}
                        title={isVideoOff ? "Włącz kamerę" : "Wyłącz kamerę"}
                    >
                        {isVideoOff ? '🚫' : '📷'}
                    </button>

                    <div className="w-px h-8 bg-gray-700 mx-2"></div>

                    <button
                        onClick={leaveRoom}
                        className="bg-red-600 hover:bg-red-700 text-white p-4 rounded-full transition-colors shadow-lg shadow-red-900/20 flex items-center justify-center"
                        title="Rozłącz"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-3a2.25 2.25 0 00-2.25 2.25V9m7.5 0A2.25 2.25 0 0118 11.25v2.25c0 1.242-1.008 2.25-2.25 2.25H8.25C7.008 15.75 6 14.742 6 13.5v-2.25A2.25 2.25 0 018.25 9m7.5 0v-.75a.75.75 0 00-.75-.75h-6a.75.75 0 00-.75.75V9" />
                        </svg>
                    </button>
                </div>
            </div>

            {/* Side Panel (AI HUD) */}
            <div className="w-full md:w-80 bg-gray-900/95 border-l border-gray-800 flex flex-col shadow-2xl z-30 shrink-0">
                <div className="p-4 border-b border-gray-800 flex items-center justify-between">
                    <div>
                        <h2 className="font-semibold text-lg tracking-wide text-gray-100">ANALYTICS</h2>
                        <div className="flex items-center gap-2 mt-1">
                            <span className={`w-2 h-2 rounded-full ${useRemoteAi ? 'bg-green-500' : 'bg-orange-500'}`}></span>
                            <span className="text-[10px] text-gray-400 uppercase tracking-wider font-mono">
                                {useRemoteAi ? 'Połączono: Tailscale AI' : 'Połączono: Lokalny Test'}
                            </span>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${isAiConnected ? 'bg-green-500 animate-pulse' : 'bg-yellow-500'}`}></span>
                        <span className="text-[10px] uppercase font-bold text-gray-500 tracking-wider">
                            {isAiConnected ? 'ONLINE' : 'WAITING'}
                        </span>
                    </div>
                </div>

                <div className="p-6 flex-1 overflow-y-auto space-y-8">
                    {/* Emotion Section */}
                    <div className="space-y-2">
                        <label className="text-xs font-bold text-gray-500 uppercase tracking-widest block">Główna Emocja</label>
                        <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700/50 text-center">
                            {aiData && aiData.emotion ? (
                                <>
                                    <div className={`text-3xl font-bold mb-1 ${getEmotionColor(aiData.emotion)}`}>
                                        {aiData.emotion.split(' ')[0]}
                                    </div>
                                    <div className="w-full bg-gray-700 h-1.5 rounded-full mt-3 overflow-hidden">
                                        <div
                                            className="h-full bg-white/20 transition-all duration-500"
                                            style={{ width: `${getEmotionPercentage(aiData.emotion)}%` }}
                                        />
                                    </div>
                                </>
                            ) : (
                                <div className="text-gray-500 italic py-2">Oczekiwanie na dane...</div>
                            )}
                        </div>
                    </div>

                    {/* Emotion Trend Chart */}
                    <div className="space-y-2">
                        <label className="text-xs font-bold text-gray-500 uppercase tracking-widest block">Trend Emocjonalny</label>
                        <div className="bg-gray-800/30 rounded-xl p-2 border border-gray-700/30 h-48">
                            <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={history}>
                                    <XAxis dataKey="time" hide />
                                    <Tooltip
                                        contentStyle={{ backgroundColor: '#111827', borderColor: '#374151', fontSize: '12px' }}
                                        itemStyle={{ color: '#e5e7eb' }}
                                    />
                                    <Line
                                        type="monotone"
                                        dataKey="score"
                                        stroke={aiData && aiData.emotion ? getEmotionHexColor(aiData.emotion) : '#8b5cf6'}
                                        strokeWidth={3}
                                        dot={false}
                                        isAnimationActive={false}
                                    />
                                </LineChart>
                            </ResponsiveContainer>
                        </div>
                    </div>

                    {/* Stats Grid */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="bg-gray-800/30 rounded-xl border border-gray-700/30 min-w-0 flex flex-col items-center justify-center p-2 md:p-3 overflow-hidden">
                            <label className="text-[10px] text-gray-500 uppercase tracking-widest block mb-1">Wiek</label>
                            <div className="text-white/90 font-mono w-full text-center text-xs sm:text-sm md:text-base font-bold truncate">
                                {aiData ? aiData.age : '--'}
                            </div>
                        </div>
                        <div className="bg-gray-800/30 rounded-xl border border-gray-700/30 min-w-0 flex flex-col items-center justify-center p-2 md:p-3 overflow-hidden">
                            <label className="text-[10px] text-gray-500 uppercase tracking-widest block mb-1">Płeć</label>
                            <div className="text-white/90 font-mono w-full text-center text-xs sm:text-sm md:text-base font-bold truncate">
                                {aiData ? aiData.gender : '--'}
                            </div>
                        </div>
                    </div>

                    {/* Live Feed Status */}
                    <div className="bg-black/20 rounded-lg p-3 border border-white/5">
                        <div className="flex items-center gap-3">
                            <div className="relative w-8 h-8 rounded bg-gray-800 flex items-center justify-center border border-gray-700">
                                <span className="text-xs">📸</span>
                                {isAiConnected && (
                                    <div className="absolute top-0 right-0 w-2 h-2 bg-red-500 rounded-full animate-ping"></div>
                                )}
                            </div>
                            <div className="flex-1">
                                <div className="text-xs text-gray-400 font-medium">Video Feed Analysis</div>
                                <div className="text-[10px] text-gray-600">{isAiConnected ? 'Processing frames...' : 'Connecting...'}</div>
                            </div>
                        </div>
                    </div>

                    {/* Capture Report Button */}
                    <button
                        id="capture-btn"
                        onClick={captureReport}
                        className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 rounded-xl shadow-lg transition-all active:scale-95 flex items-center justify-center gap-2 group"
                    >
                        <span className="text-xl group-hover:rotate-12 transition-transform">📸</span>
                        <span>CAPTURE REPORT</span>
                    </button>

                    {/* Chat Section */}
                    <div className="flex flex-col h-80 bg-gray-800/80 border border-gray-700 rounded-xl overflow-hidden mt-4 shadow-inner">
                        <div className="bg-gray-800 p-3 text-sm font-semibold text-gray-300 border-b border-gray-700 flex items-center gap-2">
                            <span>💬</span> Czat na żywo
                        </div>

                        <div className="flex-1 overflow-y-auto p-3 space-y-3 custom-scrollbar" ref={chatScrollRef}>
                            {messages.length === 0 && (
                                <p className="text-xs text-gray-500 text-center mt-4">Brak wiadomości. Rozpocznij czat!</p>
                            )}
                            {messages.map((msg) => {
                                const isMe = msg.sender === userName
                                return (
                                    <div key={msg.id} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                                        <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${isMe
                                            ? 'bg-blue-600 text-white rounded-br-none'
                                            : 'bg-gray-700 text-gray-200 rounded-bl-none'
                                            }`}>
                                            {!isMe && <div className="text-[10px] font-bold text-gray-400 mb-0.5">{msg.sender}</div>}
                                            {msg.text}
                                        </div>
                                        <span className="text-[10px] text-gray-500 mt-1 px-1">
                                            {msg.time}
                                        </span>
                                    </div>
                                )
                            })}
                        </div>

                        <form onSubmit={handleSendMessage} className="flex p-2 bg-gray-900 border-t border-gray-700">
                            <input
                                type="text"
                                value={chatInput}
                                onChange={(e) => setChatInput(e.target.value)}
                                placeholder="Napisz..."
                                className="flex-1 bg-gray-800 text-white rounded-l-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 border border-transparent focus:border-blue-500 transition-all placeholder-gray-500"
                            />
                            <button
                                type="submit"
                                disabled={!chatInput.trim()}
                                className="bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 px-4 rounded-r-md text-white font-medium transition-colors text-sm"
                            >
                                ➤
                            </button>
                        </form>
                    </div>

                </div>
            </div>
        </div>
    )
}
