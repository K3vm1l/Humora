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

    const peerInstance = useRef(null)
    const localStreamRef = useRef(null)
    const roomChannelRef = useRef(null)
    const startTimeRef = useRef(Date.now()) // Track meeting start time

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
                                payload: { peerId: id, userName: userName, userId: currentSession?.user?.id }
                            })
                        }
                    })

                    roomChannel.on('broadcast', { event: 'peer-joined' }, (payload) => {
                        const { peerId: remotePeerId, userName: remoteName, userId: remoteDbId } = payload.payload;
                        console.log('Peer joined:', remoteName)

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
        <div className="h-screen bg-gray-950 flex flex-col md:flex-row text-white overflow-hidden">

            {/* Main Content Area (Videos) */}
            <div className="flex-1 flex flex-col relative p-4 pb-24 h-full overflow-y-auto w-full">
                {/* Header */}
                <div className="absolute top-6 right-6 bg-gray-900/80 backdrop-blur px-4 py-2 rounded-lg border border-gray-800 text-gray-300 text-sm z-20">
                    <p>Pokój: <span className="text-white font-mono">{roomId}</span></p>
                    <p>ID: <span className="text-white font-mono">{myPeerId}</span></p>
                </div>

                {/* Video Grid */}
                <div className="flex-1 flex flex-col items-center justify-center gap-6 w-full max-w-6xl mx-auto">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full h-full max-h-[80vh]">
                        {/* 1. Local Video Feed */}
                        <div className="w-full h-full min-h-[300px]">
                            <VideoFeedWithAI
                                stream={localStreamRef.current}
                                isLocal={true}
                                userName={userName}
                                aiIP={aiIP}
                                isAIEnabled={isAIEnabled} // Only local analyzes by default? Or all? User requested independence. 
                                // Actually, if we want to analyze remote, we pass isAIEnabled too. 
                                // But usually we analyze local and display remote. 
                                // If I pass isAIEnabled={isAIEnabled} to LOCAL, it connects. 
                                // If I pass it to REMOTE, it connects and analyzes THEIR stream (which I am receiving).
                                // This effectively doubles the analysis (sender analyzes, receiver analyzes). 
                                // But it solves "seeing" their emotions if we don't implement data-channel syncing.
                                // I will pass it to ALL for now as requested ("Each participant's video tile will now independently connect").
                                onToggleAudio={toggleAudio}
                                onToggleVideo={toggleVideo}
                                isAudioMuted={isAudioMuted}
                                isVideoOff={isVideoOff}
                                showControls={true}
                            />
                        </div>

                        {/* 2. Remote Video Feeds */}
                        {remoteStreams.map(remote => (
                            <div key={remote.id} className="w-full h-full min-h-[300px]">
                                <VideoFeedWithAI
                                    stream={remote.stream}
                                    isLocal={false}
                                    userName={remote.name}
                                    aiIP={aiIP}
                                    isAIEnabled={isAIEnabled} // Allow analyzing remote streams too
                                />
                            </div>
                        ))}

                        {/* Placeholder if waiting */}
                        {remoteStreams.length === 0 && (
                            <div className="flex items-center justify-center border-2 border-dashed border-gray-800 rounded-2xl bg-gray-900/50 text-gray-500">
                                <div className="text-center">
                                    <p className="text-2xl mb-2">⏳</p>
                                    <p>Oczekiwanie na uczestników...</p>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Right Sidebar (Chat & Controls) - Simplified for brevity in this view, keeping existing layout logic */}
            <div className="w-full md:w-96 bg-gray-900 border-l border-gray-800 flex flex-col overflow-hidden transition-all z-30">
                {/* Chat Header */}
                <div className="p-4 border-b border-gray-800 bg-gray-900/95 backdrop-blur flex justify-between items-center">
                    <h3 className="font-bold flex items-center gap-2">💬 Czat Spotkania</h3>
                    <div className="flex gap-2">
                        <button
                            onClick={toggleHand}
                            className={`p-2 rounded-lg transition-colors ${raisedHands.has(session?.user?.id) ? 'bg-yellow-500/20 text-yellow-400' : 'hover:bg-gray-800 text-gray-400'}`}
                            title="Podnieś rękę"
                        >
                            ✋
                        </button>
                    </div>
                </div>

                {/* Messages */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar" ref={chatScrollRef}>
                    {messages.length === 0 ? (
                        <p className="text-center text-gray-500 text-sm mt-10">Tu pojawi się historia czatu...</p>
                    ) : (
                        messages.map((msg) => {
                            const isMe = msg.sender === userName
                            return (
                                <div key={msg.id} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                                    <div className={`max-w-[85%] px-4 py-2 rounded-2xl text-sm ${isMe ? 'bg-indigo-600 text-white rounded-br-none' : 'bg-gray-800 text-gray-200 rounded-bl-none'}`}>
                                        <span className="block text-[10px] opacity-70 mb-1 font-bold">{msg.sender}</span>
                                        {msg.text}
                                    </div>
                                    <span className="text-[10px] text-gray-500 mt-1 px-1">{msg.time}</span>
                                </div>
                            )
                        })
                    )}
                </div>

                {/* Input Area */}
                <div className="p-4 bg-gray-900 border-t border-gray-800">
                    <form onSubmit={handleSendMessage} className="flex gap-2">
                        <input
                            type="text"
                            value={chatInput}
                            onChange={(e) => setChatInput(e.target.value)}
                            placeholder="Napisz wiadomość..."
                            className="flex-1 bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-indigo-500 transition-colors"
                        />
                        <button
                            type="submit"
                            disabled={!chatInput.trim()}
                            className="bg-indigo-600 hover:bg-indigo-500 text-white p-3 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            ➤
                        </button>
                    </form>
                </div>

                {/* Footer Controls */}
                <div className="p-4 border-t border-gray-800 bg-gray-900">
                    <button
                        onClick={leaveRoom}
                        className="w-full py-4 bg-red-600 hover:bg-red-500 text-white rounded-xl font-bold shadow-lg shadow-red-900/20 transition-all flex items-center justify-center gap-2"
                    >
                        <span>📞</span> Zakończ spotkanie
                    </button>
                </div>
            </div>
        </div>
    )
}
