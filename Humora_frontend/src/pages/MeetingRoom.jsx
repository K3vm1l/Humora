import { useParams } from 'react-router-dom';

const MeetingRoom = () => {
    const { roomId } = useParams();

    return (
        <div style={{ textAlign: 'center', marginTop: '50px' }}>
            <h1>Jesteś w pokoju: {roomId}</h1>
        </div>
    );
};

export default MeetingRoom;
