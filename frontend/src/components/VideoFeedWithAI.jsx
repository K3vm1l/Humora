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
    const [reportStatus, setReportStatus] = useState('idle'); // idle, empty, success

    // AI Refs
    const socketRef = useRef(null);
    const watchdogRef = useRef(null);
    const isProcessingRef = useRef(false);
    const lastActivityRef = useRef(Date.now());

    // Store all raw emotion strings to calculate report statistics later
    const emotionRecordsRef = useRef([]);

    // Store latest props in ref to access them inside the interval without dependencies
    const propsRef = useRef({ isAIEnabled, aiIP, userName, stream, isLocal });

    useEffect(() => {
        propsRef.current = { isAIEnabled, aiIP, userName, stream, isLocal };
    }, [isAIEnabled, aiIP, userName, stream, isLocal]);

    // 1. Attach Stream to Video (Run ONLY when stream changes)
    useEffect(() => {
        if (videoRef.current && stream) {
            videoRef.current.srcObject = stream;
        }
    }, [stream]);

    // 2. AI Logic (WebSocket & Watchdog in Strict Isolation)
    useEffect(() => {
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

        const sendFrame = () => {
            if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) return;

            const video = videoRef.current; // access directly from component ref
            if (!video || video.readyState < 2 || video.videoWidth === 0) return;

            if (!isProcessingRef.current) {
                try {
                    isProcessingRef.current = true;
                    lastActivityRef.current = Date.now();

                    const w = 640;
                    const h = 480;
                    const canvas = document.createElement('canvas');
                    canvas.width = w;
                    canvas.height = h;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(video, 0, 0, w, h);

                    const frameData = canvas.toDataURL("image/jpeg", 0.7);
                    socketRef.current.send(frameData);
                } catch (e) {
                    isProcessingRef.current = false;
                }
            }
        };

        // Main Watchdog Loop
        watchdogRef.current = setInterval(() => {
            const { isAIEnabled, aiIP, userName, stream } = propsRef.current;

            // STATUS CHECK
            // If AI Disabled but Socket Open -> Close it
            if (!isAIEnabled && socketRef.current) {
                socketRef.current.close();
                socketRef.current = null;
                setAiData(null);
                setEmotionHistory([]);
                return;
            }

            // If AI Enabled but Socket Closed -> Open it
            if (isAIEnabled && !socketRef.current) {
                if (!aiIP) {
                    // Mock Mode logic could go here if needed, but keeping simple for now
                    return;
                }

                const wsUrl = buildWsUrl(aiIP);
                if (wsUrl && !wsUrl.includes('undefined')) {
                    try {
                        const ws = new WebSocket(wsUrl);
                        socketRef.current = ws;

                        ws.onopen = () => {
                            setAiConnectionError(null);
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
                                        emotionRecordsRef.current.push(data);
                                        setEmotionHistory(prev => {
                                            const newScore = getEmotionScore(data.emotion);
                                            const newPoint = {
                                                time: new Date().toLocaleTimeString('pl-PL', { hour12: false, hour: "numeric", minute: "numeric", second: "numeric" }),
                                                value: newScore || 0,
                                                emotion: data.emotion.split(' ')[0]
                                            };
                                            return [...prev, newPoint].slice(-30);
                                        });
                                    }
                                }
                                // Next frame
                                setTimeout(() => {
                                    if (socketRef.current?.readyState === WebSocket.OPEN) sendFrame();
                                }, 200);

                            } catch (e) {
                                isProcessingRef.current = false;
                            }
                        };

                        ws.onerror = (e) => {
                            setAiConnectionError("Błąd AI");
                        };

                        ws.onclose = () => {
                            socketRef.current = null;
                        };
                    } catch (e) {
                        setAiConnectionError("Init Error");
                    }
                }
            }

            // Watchdog Logic (Restore activity if stuck)
            if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
                if (Date.now() - lastActivityRef.current > 3000) {
                    isProcessingRef.current = false;
                    sendFrame();
                }
            }

        }, 1000); // Check every second

        return () => {
            if (watchdogRef.current) clearInterval(watchdogRef.current);
            if (socketRef.current) {
                socketRef.current.close();
                socketRef.current = null;
            }
        };
    }, []); // STRICTLY EMPTY DEPENDENCY ARRAY

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

    // Download Report Logic
    const handleDownloadReport = () => {
        const video = videoRef.current;
        if (!video || video.videoWidth === 0) return;

        // Safety Guard
        if (!emotionRecordsRef.current.length && !aiData?.emotion) {
            alert('Brak danych z analizy AI. Poczekaj na pierwszą detekcję.');
            setReportStatus('empty');
            setTimeout(() => setReportStatus('idle'), 2000);
            return;
        }

        // Real-time Data Sync
        const latestRecord = emotionRecordsRef.current.length > 0
            ? emotionRecordsRef.current[emotionRecordsRef.current.length - 1]
            : aiData;

        let currentEmotion = latestRecord?.emotion || aiData?.emotion;
        let currentAge = latestRecord?.age || aiData?.age;
        let currentGender = latestRecord?.gender || aiData?.gender;

        // Translation Check
        if (currentGender) {
            const lowerGender = currentGender.toLowerCase();
            if (lowerGender === 'male') currentGender = 'Mężczyzna';
            else if (lowerGender === 'female') currentGender = 'Kobieta';
        }

        // Setup Canvas
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');

        // Draw Video Frame (Mirror if local)
        if (isLocal) {
            ctx.translate(canvas.width, 0);
            ctx.scale(-1, 1);
        }
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        // Reset transform for text
        if (isLocal) {
            ctx.setTransform(1, 0, 0, 1, 0, 0);
        }

        // Setup Text Rendering
        const padding = 30;
        let currentY = padding + 20;

        const drawText = (text, x, y, size, color, isBold = true) => {
            ctx.font = `${isBold ? 'bold' : 'normal'} ${size}px "Courier New", monospace`;

            // Text Shadow / Outline
            ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
            ctx.shadowBlur = 4;
            ctx.shadowOffsetX = 2;
            ctx.shadowOffsetY = 2;

            ctx.fillStyle = color;
            ctx.fillText(text, x, y);

            // Reset shadow
            ctx.shadowColor = 'transparent';
            ctx.shadowBlur = 0;
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = 0;

            return y + size + 10; // Return next Y position
        };

        // Draw Overlays
        currentY = drawText('HUMORA AI REPORT', padding, currentY, 28, '#ffffff');
        currentY += 10;

        // Date & Time
        const date = new Date();
        const dateString = date.toLocaleDateString();
        const timeString = date.toLocaleTimeString();
        currentY = drawText(`${dateString} ${timeString}`, padding, currentY, 18, '#9ca3af', false);
        currentY += 10;

        // User
        currentY = drawText(`USER: ${userName}`, padding, currentY, 22, '#eab308');

        // Emotion (Green)
        currentY = drawText(`EMOTION: ${currentEmotion.toUpperCase()}`, padding, currentY, 24, '#22c55e');

        // Age & Gender
        if (currentAge || currentGender) {
            const demoText = `AGE: ${currentAge || '?'} | GENDER: ${currentGender ? currentGender.toUpperCase() : '?'}`;
            drawText(demoText, padding, currentY, 20, '#ffffff');
        }

        // Generate and Download Image
        const reportImage = canvas.toDataURL('image/jpeg', 0.9);

        const safeUserName = userName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        const timestamp = `${date.getHours()}-${date.getMinutes()}-${date.getSeconds()}`;

        const a = document.createElement('a');
        a.href = reportImage;
        a.download = `humora-report-${safeUserName}-${timestamp}.jpg`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        // 3. UI Polish - Success State
        setReportStatus('success');
        setTimeout(() => setReportStatus('idle'), 3000);
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

            {/* Local Features (Bottom Left) */}
            {isLocal && (
                <div className="absolute bottom-12 left-4 z-30 flex flex-col gap-2">
                    <button
                        onClick={handleDownloadReport}
                        className={`text-[10px] px-3 py-1.5 rounded-lg font-bold shadow-lg transition-colors border backdrop-blur ${reportStatus === 'empty' ? 'bg-red-600/90 hover:bg-red-500 border-red-400/50 shadow-red-500/20 text-white' :
                            reportStatus === 'success' ? 'bg-green-600/90 hover:bg-green-500 border-green-400/50 shadow-green-500/20 text-white' :
                                'bg-indigo-600/90 hover:bg-indigo-500 text-white border-indigo-400/30 shadow-indigo-500/20'
                            }`}
                        title="Pobierz statystyki sesji jako .txt"
                    >
                        {reportStatus === 'empty' ? 'Brak danych! ❌' :
                            reportStatus === 'success' ? 'Pobrano! ✅' :
                                '📄 Raport z analizy'}
                    </button>
                </div>
            )}

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
