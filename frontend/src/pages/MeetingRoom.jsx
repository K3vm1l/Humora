import React, { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import Peer from 'peerjs'

export default function MeetingRoom() {
    const { roomId } = useParams()
    const navigate = useNavigate()
    const location = useLocation()
    const userName = location.state?.userName || 'Gość'
    const [myPeerId, setMyPeerId] = useState('')
    const [remotePeerId, setRemotePeerId] = useState('')
    const [aiData, setAiData] = useState(null)
    const [isAiConnected, setIsAiConnected] = useState(false)

    const videoRef = useRef(null)
    const remoteVideoRef = useRef(null)
    const peerInstance = useRef(null)
    const wsRef = useRef(null)
    const localStreamRef = useRef(null)

    // Robust cleanup function
    const performCleanup = () => {
        const stream = window.localStream || localStreamRef.current
        if (stream) {
            stream.getTracks().forEach(track => {
                track.stop()
                console.log('Track stopped:', track.kind)
            })
        }
        window.localStream = null
        localStreamRef.current = null

        if (videoRef.current) {
            videoRef.current.srcObject = null
        }

        if (wsRef.current) {
            wsRef.current.close()
        }

        if (peerInstance.current) {
            peerInstance.current.destroy()
        }
    }

    useEffect(() => {
        const startVideo = async () => {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })

                // Store globally and in ref for robust access
                window.localStream = stream
                localStreamRef.current = stream

                if (videoRef.current) {
                    videoRef.current.srcObject = stream
                }

                const peer = new Peer()
                peerInstance.current = peer

                peer.on('open', (id) => {
                    setMyPeerId(id)
                })

                peer.on('call', (call) => {
                    call.answer(stream)
                    call.on('stream', (remoteStream) => {
                        if (remoteVideoRef.current) {
                            remoteVideoRef.current.srcObject = remoteStream
                        }
                    })
                })

            } catch (err) {
                console.error("Error accessing media devices:", err)
            }
        }

        startVideo()

        return () => {
            performCleanup()
        }
    }, [])

    useEffect(() => {
        wsRef.current = new WebSocket('ws://localhost:8000/ws/analyze')
        let intervalId

        wsRef.current.onopen = () => {
            console.log('Connected to AI backend')
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
    }, [])

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

    const leaveMeeting = () => {
        performCleanup()
        window.location.href = '/'
    }

    // Helper to determine emotion color
    const getEmotionColor = (emotionString) => {
        if (!emotionString) return 'text-white'
        const emotion = emotionString.split(' ')[0].toLowerCase()
        if (['radość', 'szczęście'].includes(emotion)) return 'text-green-400 drop-shadow-[0_0_10px_rgba(74,222,128,0.5)]'
        if (['złość', 'gniew'].includes(emotion)) return 'text-red-500 drop-shadow-[0_0_10px_rgba(239,68,68,0.5)]'
        if (['smutek'].includes(emotion)) return 'text-blue-400 drop-shadow-[0_0_10px_rgba(96,165,250,0.5)]'
        if (['strach', 'lęk'].includes(emotion)) return 'text-purple-400 drop-shadow-[0_0_10px_rgba(192,132,252,0.5)]'
        if (['zaskoczenie'].includes(emotion)) return 'text-yellow-400 drop-shadow-[0_0_10px_rgba(250,204,21,0.5)]'
        return 'text-white'
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
        const gradient = ctx.createLinearGradient(0, 0, 0, 150)
        gradient.addColorStop(0, 'rgba(0,0,0,0.8)')
        gradient.addColorStop(1, 'rgba(0,0,0,0)')
        ctx.fillStyle = gradient
        ctx.fillRect(0, 0, canvas.width, 150)

        // Text Config
        ctx.font = 'bold 32px monospace'
        ctx.fillStyle = '#ffffff'
        ctx.fillText('HUMORA AI REPORT', 24, 50)

        // Add Nickname to Report
        ctx.font = '24px monospace'
        ctx.fillStyle = '#fbbf24' // amber-400
        ctx.fillText(`USER: ${userName.toUpperCase()}`, 24, 90)

        ctx.font = '20px monospace'
        ctx.fillStyle = '#cccccc'
        ctx.fillText(new Date().toLocaleString(), 24, 120)

        if (aiData) {
            ctx.font = 'bold 24px monospace'
            ctx.fillStyle = '#4ade80' // Green-400
            ctx.fillText(`EMOTION: ${aiData.emotion.toUpperCase()}`, 24, 160)

            ctx.textAlign = 'right'
            ctx.fillStyle = '#ffffff'
            ctx.fillText(`AGE: ${aiData.age} | GENDER: ${aiData.gender}`, canvas.width - 24, 160)
        } else {
            ctx.font = 'italic 20px monospace'
            ctx.fillStyle = '#aaaaaa'
            ctx.fillText('Waiting for analysis...', 24, 160)
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
                            <div className="absolute bottom-4 right-4 bg-black/50 px-2 py-1 rounded text-xs text-white">Rozmówca</div>
                            <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-0 peer-checked:opacity-100">
                                {/* Waiting logic */}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Controls (Floating centered in main area) */}
                <div className="fixed bottom-8 left-1/2 md:left-[calc(50%-10rem)] transform -translate-x-1/2 bg-gray-900/90 backdrop-blur-lg border border-gray-800 p-4 rounded-full shadow-2xl flex items-center gap-4 z-50">
                    <input
                        type="text"
                        placeholder="ID rozmówcy..."
                        value={remotePeerId}
                        onChange={(e) => setRemotePeerId(e.target.value)}
                        className="bg-gray-800 text-white px-4 py-2 rounded-full border border-gray-700 focus:outline-none focus:border-blue-500 w-32 md:w-48 text-sm"
                    />
                    <button
                        onClick={() => callUser(remotePeerId)}
                        className="bg-green-600 hover:bg-green-500 text-white p-3 rounded-full transition-colors shadow-lg shadow-green-900/20"
                        title="Zadzwoń"
                    >
                        📞
                    </button>
                    <div className="w-px h-8 bg-gray-700 mx-2"></div>
                    <button
                        onClick={leaveMeeting}
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
                        <p className="text-xs text-gray-400 font-mono mt-1">Profil: {userName}</p>
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
                            {aiData ? (
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

                    {/* Stats Grid */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="bg-gray-800/30 p-4 rounded-xl border border-gray-700/30">
                            <label className="text-[10px] text-gray-500 uppercase tracking-widest block mb-1">Wiek</label>
                            <div className="text-2xl font-mono text-white/90">
                                {aiData ? aiData.age : '--'}
                            </div>
                        </div>
                        <div className="bg-gray-800/30 p-4 rounded-xl border border-gray-700/30">
                            <label className="text-[10px] text-gray-500 uppercase tracking-widest block mb-1">Płeć</label>
                            <div className="text-2xl font-mono text-white/90">
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

                </div>
            </div>
        </div>
    )
}
