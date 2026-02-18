import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import supabase from '../supabaseClient';

export default function History() {
    const navigate = useNavigate();
    const [meetings, setMeetings] = useState([]);
    const [loading, setLoading] = useState(true);
    const [session, setSession] = useState(null);

    useEffect(() => {
        supabase.auth.getSession().then(({ data: { session } }) => {
            setSession(session);
            if (session) fetchHistory(session.user.id);
        });
    }, []);

    const fetchHistory = async (userId) => {
        try {
            const { data, error } = await supabase
                .from('meetings')
                .select('*, captures(*)')
                .eq('host_id', userId)
                .order('started_at', { ascending: false });

            if (error) throw error;
            setMeetings(data || []);
        } catch (error) {
            console.error('Error fetching history:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async (meetingId, captures) => {
        if (!window.confirm('Czy na pewno chcesz usunąć to spotkanie i wszystkie raporty?')) return;

        try {
            // 1. Delete images from Storage
            if (captures && captures.length > 0) {
                const fileNames = captures.map(c => {
                    // Extract filename from URL or use a stored path if available.
                    // Assuming image_url format: .../captures/filename.png
                    const urlParts = c.image_url.split('/');
                    return urlParts[urlParts.length - 1];
                });

                const { error: storageError } = await supabase.storage
                    .from('captures')
                    .remove(fileNames);

                if (storageError) console.error('Error deleting files:', storageError);
            }

            // 2. Delete meeting from DB (Cascade should handle captures rows)
            const { error: dbError } = await supabase
                .from('meetings')
                .delete()
                .eq('id', meetingId);

            if (dbError) throw dbError;

            // 3. Update UI
            setMeetings(prev => prev.filter(m => m.id !== meetingId));

        } catch (error) {
            console.error('Error deleting meeting:', error);
            alert('Wystąpił błąd podczas usuwania.');
        }
    };

    const handleDownload = async (meeting) => {
        const duration = meeting.ended_at
            ? Math.round((new Date(meeting.ended_at) - new Date(meeting.started_at)) / 1000 / 60) + ' min'
            : 'N/A';

        const summary = `
RAPORT SPOTKANIA HUMORA
-----------------------
Data: ${new Date(meeting.started_at).toLocaleString('pl-PL')}
Uczestnik: ${meeting.participant_name || 'Nieznany'}
Czas trwania: ${duration}
Liczba zrzutów: ${meeting.captures?.length || 0}
-----------------------
ID Spotkania: ${meeting.id}
        `.trim();

        // Download Summary Text
        const blob = new Blob([summary], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `meeting-summary-${new Date(meeting.started_at).toISOString().split('T')[0]}.txt`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        // Download Images
        if (meeting.captures && meeting.captures.length > 0) {
            meeting.captures.forEach((cap, index) => {
                const link = document.createElement('a');
                link.href = cap.image_url;
                link.download = `capture-${index + 1}-${new Date(meeting.started_at).toISOString().split('T')[0]}.png`;
                link.target = '_blank'; // Open in new tab or trigger download depending on browser ref
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
            });
        }
    };

    if (loading) return <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">Ładowanie historii...</div>;

    return (
        <div className="min-h-screen bg-gray-900 text-white p-8">
            <div className="max-w-6xl mx-auto">
                <div className="flex justify-between items-center mb-8">
                    <h1 className="text-3xl font-bold flex items-center gap-3">
                        <span className="text-4xl">📂</span> Historia Spotkań
                    </h1>
                    <button
                        onClick={() => navigate('/')}
                        className="bg-gray-800 hover:bg-gray-700 text-gray-300 px-4 py-2 rounded-lg transition-colors border border-gray-700"
                    >
                        ← Powrót
                    </button>
                </div>

                {meetings.length === 0 ? (
                    <div className="text-center py-20 bg-gray-800/50 rounded-2xl border border-gray-700">
                        <p className="text-xl text-gray-400">Brak zapisanych spotkań.</p>
                    </div>
                ) : (
                    <div className="bg-gray-800 rounded-2xl shadow-xl overflow-hidden border border-gray-700">
                        <div className="overflow-x-auto">
                            <table className="w-full text-left">
                                <thead className="bg-gray-900/50 text-gray-400 uppercase text-xs">
                                    <tr>
                                        <th className="px-6 py-4 font-semibold tracking-wider">Data</th>
                                        <th className="px-6 py-4 font-semibold tracking-wider">Uczestnik</th>
                                        <th className="px-6 py-4 font-semibold tracking-wider">Czas Trwania</th>
                                        <th className="px-6 py-4 font-semibold tracking-wider">Raporty</th>
                                        <th className="px-6 py-4 font-semibold tracking-wider text-right">Akcje</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-700">
                                    {meetings.map((meeting) => {
                                        const duration = meeting.ended_at
                                            ? Math.round((new Date(meeting.ended_at) - new Date(meeting.started_at)) / 1000 / 60)
                                            : null;

                                        return (
                                            <tr key={meeting.id} className="hover:bg-gray-700/30 transition-colors">
                                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">
                                                    {new Date(meeting.started_at).toLocaleString('pl-PL')}
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-white">
                                                    {meeting.participant_name || 'Nieznany'}
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-400 font-mono">
                                                    {duration !== null ? `${duration} min` : 'Trwa...'}
                                                </td>
                                                <td className="px-6 py-4">
                                                    <div className="flex -space-x-2 overflow-hidden">
                                                        {meeting.captures?.slice(0, 3).map((cap, i) => (
                                                            <img
                                                                key={cap.id}
                                                                src={cap.image_url}
                                                                alt="Capture"
                                                                className="inline-block h-8 w-8 rounded-full ring-2 ring-gray-800 object-cover"
                                                                title={`Capture ${i + 1}`}
                                                            />
                                                        ))}
                                                        {meeting.captures?.length > 3 && (
                                                            <div className="h-8 w-8 rounded-full bg-gray-700 flex items-center justify-center text-xs text-white ring-2 ring-gray-800">
                                                                +{meeting.captures.length - 3}
                                                            </div>
                                                        )}
                                                        {(!meeting.captures || meeting.captures.length === 0) && (
                                                            <span className="text-xs text-gray-500 italic">Brak</span>
                                                        )}
                                                    </div>
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-3">
                                                    <button
                                                        onClick={() => handleDownload(meeting)}
                                                        className="text-indigo-400 hover:text-indigo-300 transition-colors"
                                                        title="Pobierz raport"
                                                    >
                                                        ⬇ Pobierz
                                                    </button>
                                                    <button
                                                        onClick={() => handleDelete(meeting.id, meeting.captures)}
                                                        className="text-red-500 hover:text-red-400 transition-colors"
                                                        title="Usuń z historii"
                                                    >
                                                        🗑 Usuń
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
