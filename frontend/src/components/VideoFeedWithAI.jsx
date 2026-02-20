import React, { useEffect, useRef, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer } from 'recharts';

const VideoFeedWithAI = ({
    stream,
    isLocal,
    userName,
    aiIP,
    isAIEnabled = false,
    onToggleAudio,
    onToggleVideo,
    isAudioMuted,
    isVideoOff,
    showControls = false,
    isHandRaised = false
}) => {
    const videoRef = useRef(null);
    const [aiData, setAiData] = useState(null);
    const [emotionHistory, setEmotionHistory] = useState([]);
    const [aiConnectionError, setAiConnectionError] = useState(null);

    // AI Refs
    const aiSocketRef = useRef(null);
    const isProcessingRef = useRef(false);
    const lastActivityRef = useRef(Date.now());
    const rawEmotionsRef = useRef([]);

    // 1. Attach Stream to Video
    useEffect(() => {
        if (videoRef.current) {
            videoRef.current.srcObject = stream;
        }
    }, [stream]);

    // 2. AI Logic (WebSocket & Watchdog)
    useEffect(() => {
        // If disabled, cleanup and return
        if (!isAIEnabled) {
            if (aiSocketRef.current) {
                aiSocketRef.current.close();
                aiSocketRef.current = null;
            }
            return;
        }

        // Prevent double initialization
        if (aiSocketRef.current) return;

        let intervalId = null;
        let watchdogInterval = null;
        let ws = null;

        // Reset state on new connection attempt
        setAiConnectionError(null);

        // Helper to get score
        const getEmotionScore = (emotionString) => {
            if (!emotionString || typeof emotionString !== 'string') return 0;
            const emotion = emotionString.toLowerCase().trim();
            if (emotion.includes('happy') || emotion.includes('joy') || emotion.includes('radość') || emotion.includes('szczęście')) return 100;
            if (emotion.includes('surprise') || emotion.includes('zaskoczenie')) return 70;
            if (emotion.includes('neutral') || emotion.includes('naturalny')) return 50;
            if (emotion.includes('sad') || emotion.includes('fear') || emotion.includes('disgust') || emotion.includes('smutek') || emotion.includes('strach') || emotion.includes('obrzydzenie')) return 20;
            if (emotion.includes('angry') || emotion.includes('anger') || emotion.includes('złość') || emotion.includes('gniew')) return 10;
            return 0;
        };

        const sendFrame = () => {
            // Guard: strict check on socket state
            if (!ws || ws.readyState !== WebSocket.OPEN) return;

            const video = videoRef.current;
            if (!video || video.readyState < 2 || video.videoWidth === 0) {
                // Retry only if socket is still open
                if (ws && ws.readyState === WebSocket.OPEN) {
                    setTimeout(sendFrame, 500);
                }
                return;
            }

            if (!isProcessingRef.current) {
                try {
                    isProcessingRef.current = true;
                    lastActivityRef.current = Date.now();

                    const w = 640;
                    const h = 480;

                    const canvas = document.createElement('canvas'); // Consider reusing a canvas ref for performance
                    canvas.width = w;
                    canvas.height = h;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(video, 0, 0, w, h);

                    const frameData = canvas.toDataURL("image/jpeg", 0.7);
                    ws.send(frameData);

                } catch (e) {
                    console.error("Frame capture error:", e);
                    isProcessingRef.current = false;
                }
            }
        };

        if (!aiIP) {
            // --- MOCK MODE ---
            intervalId = setInterval(() => {
                const mockData = {
                    emotion: ['Radość 😃', 'Smutek 😔', 'Złość 😠', 'Neutralny 😐', 'Zaskoczenie 😲'][Math.floor(Math.random() * 5)],
                    age: Math.floor(Math.random() * (60 - 18 + 1)) + 18,
                    gender: Math.random() > 0.5 ? 'Mężczyzna' : 'Kobieta'
                };

                // Only "analyze" if we have valid input (mocking reality)
                if (stream) {
                    setAiData(mockData);
                    if (mockData.emotion) {
                        setEmotionHistory(prev => {
                            const newScore = getEmotionScore(mockData.emotion);
                            if (typeof newScore !== 'number' || isNaN(newScore)) return prev;
                            const newPoint = {
                                time: new Date().toLocaleTimeString('pl-PL', { hour12: false, hour: "numeric", minute: "numeric", second: "numeric" }),
                                value: newScore,
                                emotion: mockData.emotion.split(' ')[0]
                            };
                            return [...prev, newPoint].slice(-30);
                        });
                        rawEmotionsRef.current.push(mockData.emotion);
                    }
                }
            }, 2000);
        } else {
            // --- REAL AI MODE ---
            const buildWsUrl = (input) => {
                if (!input) return '';
                const cleanInput = input.trim().replace(/\/$/, '');

                if (cleanInput.includes('trycloudflare.com') || cleanInput.includes('ngrok-free.dev') || cleanInput.startsWith('http')) {
                    const domain = cleanInput.replace(/^https?:\/\//, '').split(':')[0];
                    return `wss://${domain}/ws`;
                }

                if (!cleanInput.startsWith('ws')) {
                    return `ws://${cleanInput}:8000/ws`;
                }
                return cleanInput;
            };

            const wsUrl = buildWsUrl(aiIP);

            if (wsUrl && !wsUrl.includes('undefined')) {
                try {
                    ws = new WebSocket(wsUrl);
                    aiSocketRef.current = ws;

                    ws.onopen = () => {
                        console.log(`AI Connected for ${userName}`);
                        lastActivityRef.current = Date.now();
                        sendFrame();
                    };

                    ws.onmessage = (event) => {
                        try {
                            isProcessingRef.current = false;
                            lastActivityRef.current = Date.now();

                            if (event.data === "PONG") return;

                            const data = JSON.parse(event.data);
                            if (data.emotion || data.age) {
                                setAiData(data);
                                if (data.emotion) {
                                    setEmotionHistory(prev => {
                                        const newScore = getEmotionScore(data.emotion);
                                        const newPoint = {
                                            time: new Date().toLocaleTimeString('pl-PL', { hour12: false, hour: "numeric", minute: "numeric", second: "numeric" }),
                                            value: newScore || 0,
                                            emotion: data.emotion.split(' ')[0]
                                        };
                                        return [...prev, newPoint].slice(-30);
                                    });
                                    rawEmotionsRef.current.push(data.emotion);
                                }
                            }
                            // Next frame
                            setTimeout(() => {
                                if (ws.readyState === WebSocket.OPEN) sendFrame();
                            }, 200);

                        } catch (e) {
                            console.error("Parse Error:", e);
                            isProcessingRef.current = false;
                        }
                    };

                    ws.onerror = (e) => {
                        console.error("AI WS Error:", e);
                        setAiConnectionError("Błąd AI");
                    };

                    ws.onclose = () => {
                        console.log("AI WS Closed");
                        aiSocketRef.current = null;
                        ws = null;
                    };

                    // Watchdog
                    watchdogInterval = setInterval(() => {
                        if (aiConnectionError) return;
                        if (ws && ws.readyState === WebSocket.OPEN && (Date.now() - lastActivityRef.current > 3000)) {
                            isProcessingRef.current = false;
                            sendFrame();
                        }
                    }, 1000);

                } catch (e) {
                    setAiConnectionError("Init Error");
                }
            }
        }

        return () => {
            if (intervalId) clearInterval(intervalId);
            if (watchdogInterval) clearInterval(watchdogInterval);
            if (ws) {
                ws.close();
                ws = null;
            }
            aiSocketRef.current = null;
        };
    }, [isAIEnabled]); // Only re-run if AI is toggled. Removed stream/userName/aiIP to prevent loop.

    // Emotion Color Helper
    const getEmotionColor = (emotionString) => {
        if (!emotionString || typeof emotionString !== 'string') return 'text-white';
        const emotion = emotionString.split(' ')[0].toLowerCase();
        if (['radość', 'szczęście'].includes(emotion)) return 'text-green-400 drop-shadow-[0_0_10px_rgba(74,222,128,0.5)]';
        if (['złość', 'gniew'].includes(emotion)) return 'text-red-500 drop-shadow-[0_0_10px_rgba(239,68,68,0.5)]';
        if (['smutek'].includes(emotion)) return 'text-blue-400 drop-shadow-[0_0_10px_rgba(96,165,250,0.5)]';
        return 'text-white';
    };

    const getEmotionHexColor = (emotionString) => {
        if (!emotionString) return '#8b5cf6';
        const emotion = emotionString.split(' ')[0].toLowerCase();
        if (['radość', 'szczęście', 'happy'].some(e => emotion.includes(e))) return '#4ade80';
        if (['złość', 'gniew', 'angry'].some(e => emotion.includes(e))) return '#ef4444';
        if (['smutek', 'sad'].some(e => emotion.includes(e))) return '#60a5fa';
        return '#8b5cf6'; // default
    };

    return (
        <div className="relative w-full h-full max-h-[70vh] aspect-video bg-slate-800 rounded-2xl overflow-hidden border border-white/10 shadow-2xl group transition-all duration-300 hover:shadow-indigo-500/20 hover:border-indigo-500/30">
            <video
                ref={videoRef}
                autoPlay
                playsInline
                muted={isLocal} // Always mute local to prevent echo
                className={`w-full h-full object-cover ${isLocal ? 'scale-x-[-1]' : ''}`}
            />

            {/* Hand Raise Icon (Top Right) */}
            {isHandRaised && (
                <div className="absolute top-4 right-4 z-30 bg-yellow-500 animate-bounce p-2 rounded-full shadow-lg text-xl">
                    ✋
                </div>
            )}

            {/* Emotion Overlay (Top Left) */}
            {aiData && (
                <div className="absolute top-4 left-4 z-20 bg-black/50 backdrop-blur-md p-3 rounded-xl border border-white/10 shadow-lg glow-white transition-all flex flex-col gap-1">
                    <div className={`text-xl font-bold ${getEmotionColor(aiData.emotion)}`}>
                        {aiData.emotion || 'Analiza...'}
                    </div>
                    {(aiData.age || aiData.gender) && (
                        <div className="flex gap-2 text-[10px] text-gray-300 font-mono opacity-80">
                            <span>{aiData.age ? `${aiData.age} l.` : ''}</span>
                            <span>{aiData.gender || ''}</span>
                        </div>
                    )}
                </div>
            )}

            {/* AI Error Warning (Shifted down to avoid overlap if hand raised) */}
            {aiConnectionError && (
                <div className={`absolute right-4 bg-red-500/80 text-white text-[10px] px-2 py-1 rounded backdrop-blur ${isHandRaised ? 'top-16' : 'top-4'}`}>
                    ⚠️ {aiConnectionError}
                </div>
            )}

            {/* Name Tag (Bottom Right) */}
            <div className="absolute bottom-4 right-4 z-30 bg-black/60 backdrop-blur px-3 py-1.5 rounded-lg text-xs text-white font-medium border border-white/5">
                {userName} {isLocal ? '(Ty)' : ''}
            </div>

            {/* Chart Overlay (Bottom Full Width) */}
            {emotionHistory.length > 1 && (
                <div className="absolute bottom-0 left-0 right-0 h-24 z-20 bg-gradient-to-t from-black/90 via-black/40 to-transparent pointer-events-none">
                    <div className="w-full h-full opacity-70">
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={emotionHistory}>
                                <XAxis dataKey="time" hide />
                                <YAxis domain={[0, 100]} hide />
                                <Line
                                    type="basis"
                                    dataKey="value"
                                    stroke={getEmotionHexColor(aiData?.emotion)}
                                    strokeWidth={3}
                                    dot={false}
                                    isAnimationActive={false}
                                />
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            )}

            {/* Local Controls (Hover) */}
            {showControls && isLocal && (
                <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 flex gap-4 z-30 opacity-0 group-hover:opacity-100 transition-all duration-300 scale-90 group-hover:scale-100">
                    <button onClick={onToggleAudio} className={`p-4 rounded-full transition-all shadow-xl ${isAudioMuted ? 'bg-red-500 hover:bg-red-600' : 'bg-slate-700/80 hover:bg-slate-600 backdrop-blur'}`}>
                        {isAudioMuted ? '🔇' : '🎤'}
                    </button>
                    <button onClick={onToggleVideo} className={`p-4 rounded-full transition-all shadow-xl ${isVideoOff ? 'bg-red-500 hover:bg-red-600' : 'bg-slate-700/80 hover:bg-slate-600 backdrop-blur'}`}>
                        {isVideoOff ? '🚫' : '📷'}
                    </button>
                </div>
            )}
        </div>
    );
};

export default VideoFeedWithAI;
