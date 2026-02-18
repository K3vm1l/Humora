import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import supabase from '../supabaseClient';

const ChatWidget = ({ friend, session, index, onClose }) => {
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState('');
    const scrollRef = useRef(null);

    useEffect(() => {
        const fetchMessages = async () => {
            const { data } = await supabase
                .from('messages')
                .select('*')
                .or(`and(sender_id.eq.${session.user.id},receiver_id.eq.${friend.id}),and(sender_id.eq.${friend.id},receiver_id.eq.${session.user.id})`)
                .order('created_at', { ascending: true });
            if (data) setMessages(data);
        };
        fetchMessages();

        const channel = supabase.channel(`chat:${friend.id}`)
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
                const msg = payload.new;
                // Only add if it's from the friend (our own are added optimistically)
                if (msg.sender_id === friend.id && msg.receiver_id === session.user.id) {
                    setMessages(prev => [...prev, msg]);
                }
            })
            .subscribe();

        return () => { supabase.removeChannel(channel); };
    }, [friend.id, session.user.id]);

    useEffect(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }, [messages]);

    const handleSend = async (e) => {
        e.preventDefault();
        if (!input.trim()) return;

        const newMsg = { sender_id: session.user.id, receiver_id: friend.id, content: input.trim() };
        const optMsg = { ...newMsg, id: crypto.randomUUID(), created_at: new Date().toISOString() };

        setMessages(prev => [...prev, optMsg]);
        setInput('');

        await supabase.from('messages').insert([newMsg]);
    };

    return (
        <div
            className="fixed bottom-0 bg-gray-900 border border-gray-700 rounded-t-lg shadow-2xl z-50 flex flex-col h-96 w-80 animate-in slide-in-from-bottom-5 duration-300"
            style={{ right: `calc(1rem + ${index * 340}px)` }}
        >
            <div className="bg-gray-800 p-3 rounded-t-lg flex justify-between items-center border-b border-gray-700">
                <div className="flex items-center gap-2">
                    <span className="font-bold text-sm text-white">{friend.username}</span>
                </div>
                <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">✕</button>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-2 custom-scrollbar" ref={scrollRef}>
                {messages.map(msg => {
                    const isMe = msg.sender_id === session.user.id;
                    return (
                        <div key={msg.id} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                            <div className={`max-w-[80%] px-3 py-2 text-sm break-words ${isMe ? 'bg-blue-600 text-white rounded-lg rounded-br-none' : 'bg-gray-700 text-white rounded-lg rounded-bl-none'}`}>
                                {msg.content}
                            </div>
                            <span className="text-[10px] text-gray-500 mt-0.5 px-0.5">
                                {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                        </div>
                    );
                })}
            </div>

            <form onSubmit={handleSend} className="p-2 bg-gray-800 border-t border-gray-700 flex gap-2">
                <input value={input} onChange={e => setInput(e.target.value)} className="flex-1 bg-gray-700 text-white text-sm rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500 placeholder-gray-500" placeholder="Napisz..." />
                <button type="submit" disabled={!input.trim()} className="bg-blue-600 hover:bg-blue-500 text-white px-3 rounded-md text-sm transition-colors">➤</button>
            </form>
        </div>
    );
};

export default function Home() {
    const navigate = useNavigate();
    const [roomId, setRoomId] = useState('');
    const [username, setUsername] = useState('');

    // Friends state
    const [friends, setFriends] = useState([]);
    const [friendSearch, setFriendSearch] = useState('');
    const [friendMessage, setFriendMessage] = useState('');

    // Presence & Modal state
    const [onlineUsers, setOnlineUsers] = useState(new Set());
    const [selectedFriend, setSelectedFriend] = useState(null);

    // Call state
    const [myProfile, setMyProfile] = useState(null);
    const [incomingCall, setIncomingCall] = useState(null);
    const channelRef = useRef(null);

    // Chat & DM State
    const [openChats, setOpenChats] = useState([]);
    const [unreadCounts, setUnreadCounts] = useState({});
    const [session, setSession] = useState(null);
    const openChatsRef = useRef(openChats);

    useEffect(() => {
        openChatsRef.current = openChats;
    }, [openChats]);

    useEffect(() => {
        supabase.auth.getSession().then(({ data: { session } }) => setSession(session));
    }, []);

    const fetchFriends = async (userId) => {
        if (!userId) return;

        const { data: friendsData, error } = await supabase
            .from('friends')
            .select('friend_id')
            .eq('user_id', userId);

        if (error) {
            console.error('Error fetching friends:', error);
            return;
        }

        if (friendsData && friendsData.length > 0) {
            const friendIds = friendsData.map(f => f.friend_id);
            const { data: profilesData, error: profilesError } = await supabase
                .from('profiles')
                .select('id, username')
                .in('id', friendIds);

            if (profilesError) {
                console.error('Error fetching friend profiles:', profilesError);
            } else {
                setFriends(profilesData || []);
            }
        } else {
            setFriends([]);
        }
    };

    useEffect(() => {
        const fetchProfile = async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (user) {
                const { data } = await supabase
                    .from('profiles')
                    .select('username')
                    .eq('id', user.id)
                    .single();
                if (data) setUsername(data.username);

                // Fetch friends
                fetchFriends(user.id);
            }
        };
        fetchProfile();
    }, []);

    // Presence & Call Effect
    // Presence & Call Effect
    useEffect(() => {
        if (!session) return;

        // Fetch my profile for caller ID
        const fetchMyProfile = async () => {
            const { data } = await supabase.from('profiles').select('username').eq('id', session.user.id).single();
            setMyProfile(data);
        };
        fetchMyProfile();

        // Initialize Presence & Call channel
        const presenceChannel = supabase.channel('global-presence', {
            config: { presence: { key: session.user.id } },
        });
        channelRef.current = presenceChannel;

        presenceChannel
            .on('presence', { event: 'sync' }, () => {
                const newState = presenceChannel.presenceState();
                const onlineIds = new Set(Object.keys(newState));
                setOnlineUsers(onlineIds);
            })
            .on('broadcast', { event: 'incoming-call' }, (payload) => {
                if (payload.payload.targetId === session.user.id) {
                    setIncomingCall(payload.payload);
                }
            })
            .subscribe(async (status) => {
                if (status === 'SUBSCRIBED') {
                    await presenceChannel.track({ user_id: session.user.id, online_at: new Date().toISOString() });
                }
            });

        return () => {
            supabase.removeChannel(presenceChannel);
        };
    }, [session]);

    // Global Unread Listener
    useEffect(() => {
        if (!session) return;
        const globalSub = supabase.channel('global-dms')
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `receiver_id=eq.${session.user.id}` }, (payload) => {
                console.log('Nowa wiadomość w tle:', payload);
                const senderId = payload.new.sender_id;
                // If chat is NOT open, increment unread count
                if (!openChatsRef.current.some(chat => chat.id === senderId)) {
                    setUnreadCounts(prev => ({ ...prev, [senderId]: (prev[senderId] || 0) + 1 }));
                }
            })
            .subscribe();
        return () => { supabase.removeChannel(globalSub); };
    }, [session]);

    const handleCallFriend = async (friend) => {
        const newRoomId = crypto.randomUUID();
        if (channelRef.current) {
            await channelRef.current.send({
                type: 'broadcast',
                event: 'incoming-call',
                payload: {
                    targetId: friend.id,
                    callerName: myProfile?.username || 'Ktoś',
                    roomId: newRoomId
                }
            });
        }
        navigate(`/lobby/${newRoomId}`);
    };

    const openChat = (friend) => {
        // Clear unread count for this friend
        setUnreadCounts(prev => ({ ...prev, [friend.id]: 0 }));

        // Add to open chats if not already open (limit to 3 windows)
        if (!openChats.some(chat => chat.id === friend.id)) {
            setOpenChats(prev => [...prev.slice(-2), friend]); // Keeps max 3 windows
        }
    };

    const closeChat = (friendId) => {
        setOpenChats(prev => prev.filter(c => c.id !== friendId));
    };

    const createRoom = () => {
        // Generate a random UUID for the room
        const id = crypto.randomUUID();
        navigate(`/lobby/${id}`);
    };

    const joinRoom = (e) => {
        e.preventDefault();
        if (roomId) navigate(`/lobby/${roomId}`);
    };

    const handleLogout = async () => {
        await supabase.auth.signOut();
    };

    const handleAddFriend = async () => {
        setFriendMessage('');
        const trimmedNick = friendSearch.trim();
        if (!trimmedNick) return;

        try {
            const { data: { user: currentUser } } = await supabase.auth.getUser();
            if (!currentUser) return;

            // Step 1: Find user by username
            const { data: foundUser, error: searchError } = await supabase
                .from('profiles')
                .select('id')
                .eq('username', trimmedNick)
                .single();

            if (searchError || !foundUser) {
                setFriendMessage('Nie znaleziono użytkownika.');
                return;
            }

            if (foundUser.id === currentUser.id) {
                setFriendMessage('Nie możesz dodać samego siebie.');
                return;
            }

            // Check if already friends
            const { data: existingFriend } = await supabase
                .from('friends')
                .select('id')
                .eq('user_id', currentUser.id)
                .eq('friend_id', foundUser.id)
                .single();

            if (existingFriend) {
                setFriendMessage('Ten użytkownik jest już na Twojej liście.');
                return;
            }

            // Step 3: Insert into friends table
            const { error: insertError } = await supabase
                .from('friends')
                .insert([{
                    user_id: currentUser.id,
                    friend_id: foundUser.id,
                    status: 'accepted'
                }]);

            if (insertError) {
                setFriendMessage('Błąd podczas dodawania: ' + insertError.message);
            } else {
                setFriendMessage('Dodano znajomego!');
                setFriendSearch('');
                fetchFriends(currentUser.id);
            }
        } catch (err) {
            console.error(err);
            setFriendMessage('Wystąpił błąd.');
        }
    };

    return (
        <div className="min-h-screen bg-gray-900 text-white p-8">
            <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-8 h-[calc(100vh-4rem)]">
                {/* Left Column: Actions */}
                <div className="space-y-8 flex flex-col justify-center">
                    <div className="bg-gray-800 p-8 rounded-2xl shadow-lg border border-gray-700 text-center md:text-left">
                        <h1 className="text-3xl font-bold mb-2">
                            Witaj w Humora, <span className="text-purple-400 block md:inline">{username || 'User'}</span>
                        </h1>
                        <p className="text-gray-400">Twój panel sterowania analizą emocji</p>
                    </div>

                    <div className="bg-gray-800 p-8 rounded-2xl shadow-lg border border-gray-700 space-y-8">
                        <button
                            onClick={createRoom}
                            className="w-full py-5 text-xl font-bold bg-gradient-to-r from-purple-600 to-blue-600 rounded-xl hover:shadow-[0_0_20px_rgba(124,58,237,0.5)] transition-all transform hover:scale-[1.02] flex items-center justify-center gap-2"
                        >
                            <span>🚀</span> Utwórz nowy pokój
                        </button>

                        <button
                            onClick={() => navigate('/history')}
                            className="w-full py-4 text-lg font-bold bg-gray-700/50 border border-gray-600 rounded-xl hover:bg-gray-700 hover:border-gray-500 transition-all text-gray-300 flex items-center justify-center gap-2"
                        >
                            <span>📂</span> Historia Spotkań
                        </button>

                        <div className="relative">
                            <div className="absolute inset-0 flex items-center">
                                <div className="w-full border-t border-gray-700"></div>
                            </div>
                            <div className="relative flex justify-center text-sm">
                                <span className="px-4 bg-gray-800 text-gray-400 uppercase tracking-wider">lub dołącz</span>
                            </div>
                        </div>

                        <form onSubmit={joinRoom} className="flex flex-col sm:flex-row gap-3">
                            <input
                                type="text"
                                value={roomId}
                                onChange={(e) => setRoomId(e.target.value)}
                                placeholder="Wklej ID pokoju..."
                                className="flex-1 bg-gray-700 border border-gray-600 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-purple-500 placeholder-gray-500"
                            />
                            <button
                                type="submit"
                                className="px-6 py-3 bg-gray-700 hover:bg-gray-600 rounded-lg font-semibold transition-colors border border-gray-600"
                            >
                                Dołącz
                            </button>
                        </form>
                    </div>
                </div>

                {/* Right Column: Friends Panel */}
                <div className="bg-gray-800 p-6 rounded-2xl shadow-lg border border-gray-700 flex flex-col h-full">
                    <div className="flex justify-between items-center mb-6 pb-4 border-b border-gray-700">
                        <h2 className="text-2xl font-bold flex items-center gap-2">
                            <span>👥</span> Moi Znajomi
                        </h2>
                        <button
                            onClick={handleLogout}
                            className="text-xs sm:text-sm text-red-400 hover:text-red-300 transition-colors border border-red-900/50 px-3 py-1 rounded-full hover:bg-red-900/20"
                        >
                            Wyloguj
                        </button>
                    </div>

                    <div className="mb-6">
                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={friendSearch}
                                onChange={(e) => setFriendSearch(e.target.value)}
                                placeholder="Szukaj po nicku..."
                                className="flex-1 bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500 text-sm"
                            />
                            <button
                                onClick={handleAddFriend}
                                className="px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded-lg text-sm font-semibold transition-colors"
                            >
                                Dodaj
                            </button>
                        </div>
                        {friendMessage && (
                            <p className={`text-xs mt-2 ${friendMessage.includes('Dodano') ? 'text-green-400' : 'text-red-400'}`}>
                                {friendMessage}
                            </p>
                        )}
                    </div>

                    <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
                        {friends.length === 0 ? (
                            <p className="text-center text-gray-500 text-sm mt-10">
                                Brak znajomych. Wyszukaj kogoś po nicku!
                            </p>
                        ) : (
                            <ul className="space-y-3">
                                {friends.map((friend) => {
                                    const isOnline = onlineUsers.has(friend.id);
                                    const isSelected = selectedFriend?.id === friend.id;
                                    return (
                                        <li
                                            key={friend.id}
                                            className="bg-gray-800/50 border border-gray-700 rounded-lg mb-2 overflow-hidden transition-all duration-200"
                                        >
                                            <div
                                                className="flex justify-between items-center p-3 cursor-pointer hover:bg-gray-700/50 transition-colors"
                                                onClick={() => {
                                                    const isSelected = selectedFriend?.id === friend.id;
                                                    setSelectedFriend(isSelected ? null : friend);
                                                }}
                                            >
                                                <div className="flex items-center">
                                                    <span className="font-semibold text-white">{friend.username}</span>
                                                    {unreadCounts[friend.id] > 0 && (
                                                        <span className="bg-red-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full ml-3 animate-bounce shadow-[0_0_8px_rgba(239,68,68,0.6)]">
                                                            {unreadCounts[friend.id]}
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <div className={`w-2 h-2 rounded-full ${isOnline
                                                        ? 'bg-green-500 shadow-[0_0_8px_#22c55e]'
                                                        : 'bg-gray-500'
                                                        }`}></div>
                                                    <span className="text-xs text-gray-400 min-w-[3rem]">
                                                        {isOnline ? 'Online' : 'Offline'}
                                                    </span>
                                                </div>
                                            </div>

                                            {isSelected && (
                                                <div className="flex gap-2 p-3 border-t border-gray-700 bg-gray-800/80 animate-in slide-in-from-top-2 duration-200">
                                                    <button
                                                        onClick={() => handleCallFriend(friend)}
                                                        className="flex-1 flex justify-center items-center gap-2 bg-green-600 hover:bg-green-500 text-white py-2 rounded-md text-sm font-medium transition-colors"
                                                    >
                                                        <span>📞</span> Spotkanie
                                                    </button>
                                                    <button
                                                        onClick={() => openChat(friend)}
                                                        className="flex-1 flex justify-center items-center gap-2 bg-gray-700 hover:bg-gray-600 text-white py-2 rounded-md text-sm font-medium transition-colors"
                                                    >
                                                        <span>💬</span> Wiadomość
                                                    </button>
                                                </div>
                                            )}
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </div>
                </div>
            </div>

            {/* Multi-Window Chat Rendering */}
            {session && openChats.map((friend, idx) => (
                <ChatWidget
                    key={friend.id}
                    friend={friend}
                    session={session}
                    index={idx}
                    onClose={() => closeChat(friend.id)}
                />
            ))}

            {/* Incoming Call Modal */}
            {incomingCall && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm">
                    <div className="bg-gray-900 border border-gray-700 rounded-2xl p-8 text-center shadow-[0_0_40px_rgba(34,197,94,0.2)] animate-in zoom-in-95">
                        <div className="w-20 h-20 bg-gray-800 rounded-full mx-auto mb-4 animate-pulse flex items-center justify-center text-3xl">
                            📞
                        </div>
                        <p className="text-gray-400">Połączenie przychodzące...</p>
                        <h3 className="text-3xl font-bold text-white my-2">{incomingCall.callerName}</h3>

                        <div className="flex gap-4 justify-center mt-8">
                            <button
                                onClick={() => setIncomingCall(null)}
                                className="px-6 py-3 bg-red-600 hover:bg-red-500 hover:shadow-[0_0_15px_rgba(220,38,38,0.4)] text-white rounded-xl font-bold transition-all"
                            >
                                Odrzuć
                            </button>
                            <button
                                onClick={() => {
                                    setIncomingCall(null);
                                    navigate(`/lobby/${incomingCall.roomId}`);
                                }}
                                className="px-6 py-3 bg-green-600 hover:bg-green-500 hover:shadow-[0_0_15px_rgba(34,197,94,0.4)] text-white rounded-xl font-bold transition-all animate-bounce"
                            >
                                Odbierz
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
