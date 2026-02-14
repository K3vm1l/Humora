import React from 'react';
import { Routes, Route } from 'react-router-dom';
import Home from './pages/Home';
import MeetingRoom from './pages/MeetingRoom';
import Lobby from './pages/Lobby';

function App() {
  return (
    // Tutaj React sprawdza routing
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/lobby/:roomId" element={<React.Suspense fallback={<div>Loading...</div>}><Lobby /></React.Suspense>} />
      <Route path="/meeting/:roomId" element={<MeetingRoom />} />
    </Routes>
  );
}

export default App;