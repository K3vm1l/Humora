import React from 'react';
import { Routes, Route } from 'react-router-dom';
import Home from './pages/Home';
import MeetingRoom from './pages/MeetingRoom';

function App() {
  return (
    // Tutaj React sprawdza routing
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/room/:roomId" element={<MeetingRoom />} />
    </Routes>
  );
}

export default App;