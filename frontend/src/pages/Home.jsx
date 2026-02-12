import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

const Home = () => {
    const [roomId, setRoomId] = useState('');
    const navigate = useNavigate();

    const handleJoin = () => {
        if (roomId) {
            navigate(`/room/${roomId}`);
        }
    };

    return (
        <div style={{ textAlign: 'center', marginTop: '50px' }}>
            <h1>Humora</h1>
            <input
                type="text"
                placeholder="Wpisz ID pokoju"
                value={roomId}
                onChange={(e) => setRoomId(e.target.value)}
                style={{ padding: '10px', fontSize: '16px', marginRight: '10px' }}
            />
            <button onClick={handleJoin} style={{ padding: '10px 20px', fontSize: '16px' }}>
                Dołącz
            </button>
        </div>
    );
};

export default Home;
