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
    showControls = false
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
        if (videoRef.current && stream) {
            videoRef.current.srcObject = stream;
        }
    }, [stream]);

    // 2. AI Logic (WebSocket & Watchdog)
    useEffect(() => {
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
            if (!ws || ws.readyState !== WebSocket.OPEN) return;

            const video = videoRef.current;
            if (!video || video.readyState < 2 || video.videoWidth === 0) {
                setTimeout(sendFrame, 500);
                return;
            }

            if (!isProcessingRef.current) {
                try {
                    isProcessingRef.current = true;
                    lastActivityRef.current = Date.now();

                    const w = 640; // Optimize: reduced from 1280 for performance per-feed
                    const h = 480;

                    const canvas = document.createElement('canvas');
                    canvas.width = w;
                    canvas.height = h;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(video, 0, 0, w, h);

                    const frameData = canvas.toDataURL("image/jpeg", 0.7); // Optimize: 0.7 quality
                    ws.send(frameData);

                } catch (e) {
                    console.error("Frame capture error:", e);
                    isProcessingRef.current = false;
                }
            }
        };

        if (!isAIEnabled || !aiIP) {
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
                    };

                    // Watchdog
                    watchdogInterval = setInterval(() => {
                        if (aiConnectionError) return;
                        if (ws.readyState === WebSocket.OPEN && (Date.now() - lastActivityRef.current > 3000)) {
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
            if (ws) ws.close();
            aiSocketRef.current = null;
        };
    }, [stream, isAIEnabled, aiIP, userName]); // Re-run if stream or AI settings change

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
        <div className="relative group overflow-hidden rounded-2xl border-2 border-gray-800 shadow-2xl bg-gray-900 aspect-video w-full h-full">
            <video
                ref={videoRef}
                autoPlay
                playsInline
                muted={isLocal} // Always mute local to prevent echo
                className={`w-full h-full object-cover ${isLocal ? 'scale-x-[-1]' : ''}`}
            />

            {/* Overlay Info */}
            <div className="absolute bottom-4 right-4 bg-black/50 px-2 py-1 rounded text-xs text-white z-20">
                {userName} {isLocal ? '(Ty)' : ''}
            </div>

            {/* AI Error */}
            {aiConnectionError && (
                <div className="absolute top-2 right-2 bg-red-900/80 text-white text-[10px] px-2 py-1 rounded">
                    ⚠️ {aiConnectionError}
                </div>
            )}

            {/* AI Stats Overlay */}
            {aiData && (
                <div className="absolute top-4 left-4 z-20 flex flex-col gap-2">
                    <div className="bg-black/40 backdrop-blur-md p-3 rounded-xl border border-white/10 shadow-lg glow-white">
                        <div className={`text-2xl font-bold transition-all duration-300 ${getEmotionColor(aiData.emotion)}`}>
                            {aiData.emotion || '...'}
                        </div>
                        <div className="flex gap-3 text-[10px] text-gray-300 font-mono mt-1">
                            <span>Wiek: {aiData.age || '--'}</span>
                            <span>Płeć: {aiData.gender || '--'}</span>
                        </div>
                    </div>
                </div>
            )}

            {/* Chart Overlay (Bottom Left) */}
            {emotionHistory.length > 1 && (
                <div className="absolute bottom-4 left-4 z-20 w-1/3 h-24 opacity-60 hover:opacity-100 transition-opacity">
                    <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={emotionHistory}>
                            <XAxis dataKey="time" hide />
                            <YAxis domain={[0, 100]} hide />
                            <Line
                                type="monotone"
                                dataKey="value"
                                stroke={getEmotionHexColor(aiData?.emotion)}
                                strokeWidth={3}
                                dot={false}
                                isAnimationActive={false}
                            />
                        </LineChart>
                    </ResponsiveContainer>
                </div>
            )}

            {/* Local Controls (only if enabled) */}
            {showControls && isLocal && (
                <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 flex gap-4 z-30 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={onToggleAudio} className={`p-2 rounded-full ${isAudioMuted ? 'bg-red-500' : 'bg-gray-700'}`}>
                        {isAudioMuted ? '🔇' : '🎤'}
                    </button>
                    <button onClick={onToggleVideo} className={`p-2 rounded-full ${isVideoOff ? 'bg-red-500' : 'bg-gray-700'}`}>
                        {isVideoOff ? '🚫' : '📷'}
                    </button>
                </div>
            )}
        </div>
    );
};

export default VideoFeedWithAI;
