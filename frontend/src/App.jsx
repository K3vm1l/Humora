import React, { useState, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Home from './pages/Home';
import MeetingRoom from './pages/MeetingRoom';
import Lobby from './pages/Lobby';
import History from './pages/History';
import Auth from './pages/Auth';
import supabase from './supabaseClient';

function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-900 text-white">
        Loading...
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/" element={session ? <Home /> : <Auth />} />
      <Route path="/lobby/:roomId" element={<React.Suspense fallback={<div>Loading...</div>}><Lobby /></React.Suspense>} />
      <Route path="/meeting/:roomId" element={<MeetingRoom />} />
      <Route path="/history" element={<History />} />
    </Routes>
  );
}

export default App;