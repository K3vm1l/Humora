import React, { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import Peer from 'peerjs'
import supabase from '../supabaseClient'
import VideoFeedWithAI from '../components/VideoFeedWithAI'

export default function MeetingRoom() {
    const { roomId } = useParams()
    const navigate = useNavigate()
    const location = useLocation()
    const userName = location.state?.userName || 'Gość'
    const { isAIEnabled = false, aiIP = '' } = location.state || {}

    const [myPeerId, setMyPeerId] = useState('')
    const [remotePeerId, setRemotePeerId] = useState('')
    const [remoteUserName, setRemoteUserName] = useState('Oczekiwanie...')
    const [raisedHands, setRaisedHands] = useState(new Set())
    const [remoteStreams, setRemoteStreams] = useState([]) // Array of { id, stream, name, userId }
    const [session, setSession] = useState(null)
    const [currentMeetingId, setCurrentMeetingId] = useState(null)

    // Media Control State (Initialized from Lobby)
    const [isAudioMuted, setIsAudioMuted] = useState(location.state?.startMuted || false)
    const [isVideoOff, setIsVideoOff] = useState(location.state?.startVideoOff || false)

    // Chat State
    const [messages, setMessages] = useState([])
    const [chatInput, setChatInput] = useState('')
    const chatScrollRef = useRef(null)

    // Call Timer State
    const [callSeconds, setCallSeconds] = useState(0)

    const peerInstance = useRef(null)
    const localStreamRef = useRef(null)
    const roomChannelRef = useRef(null)
    const startTimeRef = useRef(Date.now()) // Track meeting start time

    // Call Timer Effect
    useEffect(() => {
        const timer = setInterval(() => {
            setCallSeconds(prev => prev + 1)
        }, 1000)
        return () => clearInterval(timer)
    }, [])

    const formatTime = (totalSeconds) => {
        const m = Math.floor(totalSeconds / 60).toString().padStart(2, '0')
        const s = (totalSeconds % 60).toString().padStart(2, '0')
        return `${m}:${s}`
    }

    useEffect(() => {
        let isMounted = true;
        let myStream = null;
        let myPeer = null;
        let roomChannel = null;

        const initRoom = async () => {
            try {
                // Get session for user ID
                const { data: { session: currentSession } } = await supabase.auth.getSession()
                setSession(currentSession)

                // 1. GET MEDIA
                myStream = await navigator.mediaDevices.getUserMedia({
                    video: { width: { ideal: 1280 }, height: { ideal: 720 } },
                    audio: true
                })

                // Apply initial mute states
                const initialAudioMuted = location.state?.startMuted || false
                const initialVideoOff = location.state?.startVideoOff || false
                myStream.getAudioTracks().forEach(t => t.enabled = !initialAudioMuted)
                myStream.getVideoTracks().forEach(t => t.enabled = !initialVideoOff)

                if (!isMounted) {
                    myStream.getTracks().forEach(t => t.stop())
                    return
                }

                localStreamRef.current = myStream
                window.localStream = myStream

                // 2. INITIALIZE PEERJS
                myPeer = new Peer(undefined, {
                    config: {
                        iceServers: [
                            { urls: 'stun:stun.l.google.com:19302' },
                            { urls: 'stun:stun1.l.google.com:19302' },
                        ]
                    }
                })
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
                                payload: { peerId: id, userName: userName, userId: currentSession?.user?.id }
                            })
                        }
                    })

                    roomChannel.on('broadcast', { event: 'peer-joined' }, (payload) => {
                        const { peerId: remotePeerId, userName: remoteName, userId: remoteDbId } = payload.payload;

                        // Call them
                        const call = myPeer.call(remotePeerId, myStream, {
                            metadata: {
                                callerName: userName,
                                callerUserId: currentSession?.user?.id
                            }
                        })
                        call.on('stream', (remoteStream) => {
                            setRemoteStreams(prev => {
                                if (prev.some(s => s.id === remotePeerId)) return prev;
                                return [...prev, { id: remotePeerId, stream: remoteStream, name: remoteName, userId: remoteDbId }];
                            });
                        })

                        // Start Meeting Recording (Host)
                        if (!currentMeetingId) {
                            supabase.from('meetings').insert([{
                                host_id: currentSession?.user?.id,
                                participant_name: remoteName,
                                started_at: new Date().toISOString()
                            }]).select().single()
                                .then(({ data }) => {
                                    if (data) setCurrentMeetingId(data.id);
                                });
                        }
                    })
                        .on('broadcast', { event: 'chat-message' }, (payload) => {
                            setMessages((prev) => {
                                if (prev.some(msg => msg.id === payload.payload.id)) return prev;
                                return [...prev, payload.payload];
                            });
                        })
                        .on('broadcast', { event: 'hand-toggle' }, ({ payload }) => {
                            setRaisedHands(prev => {
                                const newSet = new Set(prev);
                                if (payload.isRaised) newSet.add(payload.userId);
                                else newSet.delete(payload.userId);
                                return newSet;
                            });
                        });
                })

                // 4. ANSWER INCOMING CALLS
                myPeer.on('call', (call) => {
                    const callerName = call.metadata?.callerName || 'Uczestnik';
                    const callerUserId = call.metadata?.callerUserId;

                    call.answer(myStream)
                    call.on('stream', (remoteStream) => {
                        setRemoteStreams(prev => {
                            // Use peer id from call if possible, otherwise generic unique
                            const pid = call.peer;
                            if (prev.some(s => s.id === pid)) return prev;
                            return [...prev, { id: pid, stream: remoteStream, name: callerName, userId: callerUserId }];
                        });
                    })

                    if (!currentMeetingId) {
                        supabase.from('meetings').insert([{
                            host_id: currentSession?.user?.id,
                            participant_name: callerName,
                            started_at: new Date().toISOString()
                        }]).select().single()
                            .then(({ data }) => {
                                if (data) setCurrentMeetingId(data.id);
                            });
                    }
                })

            } catch (err) {
                console.error('Room Init Error:', err)
            }
        }

        initRoom()

        return () => {
            isMounted = false
            if (myStream) myStream.getTracks().forEach(t => t.stop())
            if (myPeer) myPeer.destroy()
            if (roomChannel) supabase.removeChannel(roomChannel)
            localStreamRef.current = null
            window.localStream = null
        }
    }, [roomId, userName])

    const leaveRoom = async () => {
        // Cleanup local media
        if (localStreamRef.current) {
            localStreamRef.current.getTracks().forEach(track => {
                track.stop();
                track.enabled = false;
            });
        }
        if (peerInstance.current) peerInstance.current.destroy();

        // Save meeting end time if tracked
        if (currentMeetingId) {
            await supabase.from('meetings').update({
                ended_at: new Date().toISOString(),
            }).eq('id', currentMeetingId);
        }

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

    const toggleHand = async () => {
        const myId = session?.user?.id;
        if (!myId) return;
        const isRaised = raisedHands.has(myId);
        setRaisedHands(prev => {
            const next = new Set(prev);
            if (isRaised) next.delete(myId);
            else next.add(myId);
            return next;
        });
        if (roomChannelRef.current) {
            await roomChannelRef.current.send({
                type: 'broadcast',
                event: 'hand-toggle',
                payload: { userId: myId, isRaised: !isRaised }
            });
        }
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
        setMessages((prev) => [...prev, newMessage])
        setChatInput('')
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


    return (
        <div className="flex h-screen bg-[#0f172a] text-white overflow-hidden">

            {/* Main Content Area (Videos) */}
            {/* Main Content Area (Videos) */}
            <div className="flex-1 flex flex-col items-center justify-center p-4 min-h-0 overflow-hidden relative">
                {/* Header Info (Top Left) */}
                <div className="fixed top-4 left-4 z-50 flex gap-2 bg-slate-900/80 backdrop-blur-md px-6 py-2 rounded-full border border-white/10 text-xs shadow-xl hover:bg-slate-900 transition-colors">
                    <p className="text-gray-400 flex items-center gap-2">
                        <span>⌛ Czas:</span>
                        <span className="text-white font-mono font-bold">{formatTime(callSeconds)}</span>
                    </p>
                    <div className="w-px h-4 bg-white/10 self-center mx-2"></div>
                    <p className="text-gray-400 flex items-center gap-2">
                        <span>🏠 Pokój:</span>
                        <span className="text-white font-mono font-bold tracking-wider">{roomId}</span>
                    </p>
                    <div className="w-px h-4 bg-white/10 self-center mx-2"></div>
                    <p className="text-gray-400 flex items-center gap-2">
                        <span>👤 ID:</span>
                        <span className="text-white font-mono">{myPeerId}</span>
                    </p>
                </div>

                {/* Video Grid */}
                <div className={`grid gap-6 w-full max-w-6xl mx-auto place-items-center transition-all duration-500 ease-in-out ${(remoteStreams.length + 1) <= 1 ? 'grid-cols-1 max-w-4xl' :
                    (remoteStreams.length + 1) <= 4 ? 'grid-cols-1 md:grid-cols-2' :
                        'grid-cols-2 lg:grid-cols-3'
                    }`}>
                    {/* 1. Local Video Feed */}
                    <div className="w-full flex justify-center">
                        <VideoFeedWithAI
                            stream={localStreamRef.current}
                            isLocal={true}
                            userName={userName}
                            aiIP={aiIP}
                            isAIEnabled={isAIEnabled}
                            onToggleAudio={toggleAudio}
                            onToggleVideo={toggleVideo}
                            isAudioMuted={isAudioMuted}
                            isVideoOff={isVideoOff}
                            showControls={true}
                            isHandRaised={raisedHands.has(session?.user?.id)}
                        />
                    </div>

                    {/* 2. Remote Video Feeds */}
                    {remoteStreams.map(remote => (
                        <div key={remote.id} className="w-full flex justify-center">
                            <VideoFeedWithAI
                                stream={remote.stream}
                                isLocal={false}
                                userName={remote.name}
                                aiIP={aiIP}
                                isAIEnabled={isAIEnabled} // Allow analyzing remote streams too
                                isHandRaised={raisedHands.has(remote.userId)}
                            />
                        </div>
                    ))}
                </div>

                {/* Waiting State */}
                {remoteStreams.length === 0 && (
                    <div className="absolute bottom-10 left-1/2 -translate-x-1/2 flex items-center gap-3 opacity-60 bg-black/20 px-4 py-2 rounded-full">
                        <div className="animate-pulse text-xl">👋</div>
                        <p className="text-sm font-light">Czekamy na innych uczestników...</p>
                    </div>
                )}
            </div>

            {/* Right Sidebar (Chat Only) - Fixed Width */}
            <div className="w-96 bg-[#1e293b] border-l border-white/10 flex flex-col shadow-2xl z-30">
                {/* Chat Header */}
                <div className="p-4 border-b border-white/10 bg-[#1e293b]/95 backdrop-blur flex justify-between items-center">
                    <h3 className="font-bold flex items-center gap-2 text-indigo-400">
                        <span>💬</span> Czat
                    </h3>
                    <div className="flex gap-2">
                        <button
                            onClick={toggleHand}
                            className={`p-2 rounded-lg transition-all duration-300 ${raisedHands.has(session?.user?.id) ? 'bg-yellow-500/20 text-yellow-400 scale-110' : 'hover:bg-slate-700 text-gray-400'}`}
                            title="Podnieś rękę"
                        >
                            ✋
                        </button>
                    </div>
                </div>

                {/* Messages */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar bg-[#0f172a]/50" ref={chatScrollRef}>
                    {messages.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center text-gray-500 opacity-60">
                            <span className="text-4xl mb-2">💭</span>
                            <p className="text-sm">Tu pojawi się historia czatu...</p>
                        </div>
                    ) : (
                        messages.map((msg) => {
                            const isMe = msg.sender === userName
                            return (
                                <div key={msg.id} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'} animate-fade-in-up`}>
                                    <div className={`max-w-[85%] px-4 py-2.5 rounded-2xl text-sm shadow-sm ${isMe ? 'bg-indigo-600 text-white rounded-br-none' : 'bg-slate-700 text-gray-200 rounded-bl-none'}`}>
                                        <span className={`block text-[10px] uppercase tracking-wider mb-1 font-bold ${isMe ? 'text-indigo-200' : 'text-slate-400'}`}>{msg.sender}</span>
                                        {msg.text}
                                    </div>
                                    <span className="text-[10px] text-gray-500 mt-1 px-1">{msg.time}</span>
                                </div>
                            )
                        })
                    )}
                </div>

                {/* Input Area */}
                <div className="p-4 bg-[#1e293b] border-t border-white/10">
                    <form onSubmit={handleSendMessage} className="flex gap-2 relative">
                        <input
                            type="text"
                            value={chatInput}
                            onChange={(e) => setChatInput(e.target.value)}
                            placeholder="Napisz wiadomość..."
                            className="flex-1 bg-slate-800 border border-slate-600 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all text-white placeholder-gray-500"
                        />
                        <button
                            type="submit"
                            disabled={!chatInput.trim()}
                            className="bg-indigo-600 hover:bg-indigo-500 text-white p-3 rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-indigo-500/20 active:scale-95"
                        >
                            ➤
                        </button>
                    </form>
                </div>

                {/* Footer Controls */}
                <div className="p-4 border-t border-white/10 bg-[#0f172a]">
                    <button
                        onClick={leaveRoom}
                        className="w-full py-3 bg-red-500/10 hover:bg-red-500/20 text-red-400 hover:text-red-300 border border-red-500/20 rounded-xl font-bold transition-all flex items-center justify-center gap-2 group"
                    >
                        <span className="group-hover:scale-110 transition-transform">📞</span> Zakończ
                    </button>
                </div>
            </div>
        </div>
    )
}
