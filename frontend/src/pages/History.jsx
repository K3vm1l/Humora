import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import supabase from '../supabaseClient';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

export default function History() {
    const navigate = useNavigate();
    const [meetings, setMeetings] = useState([]);
    const [loading, setLoading] = useState(true);
    const [session, setSession] = useState(null);
    const [expandedChartId, setExpandedChartId] = useState(null);

    useEffect(() => {
        supabase.auth.getSession().then(({ data: { session } }) => {
            setSession(session);
            if (session) fetchHistory(session.user.id);
        });
    }, []);

    const fetchHistory = async (userId) => {
        try {
            setLoading(true);

            // 1. Fetch Meetings (Core Data)
            const { data: meetingsData, error: meetingsError } = await supabase
                .from('meetings')
                .select('*, captures(*)')
                .eq('host_id', userId)
                .order('started_at', { ascending: false });

            if (meetingsError) throw meetingsError;
            console.log("✅ Fetched Meetings:", meetingsData?.length);

            // 2. Fetch Summaries separately (to avoid inner join issues)
            const { data: summariesData, error: summariesError } = await supabase
                .from('meeting_summaries')
                .select('*')
                .eq('user_id', userId);

            if (summariesError) {
                console.error("⚠️ Error fetching summaries:", summariesError);
            } else {
                console.log("✅ Fetched Summaries:", summariesData?.length);
            }

            // 3. Manual Merge
            const mergedData = meetingsData.map(meeting => {
                let match = null;

                if (summariesData) {
                    // Strategy A: Match by Room ID (if meetings table has it)
                    if (meeting.room_id) {
                        match = summariesData.find(s => s.room_id === meeting.room_id);
                    }

                    // Strategy B: Match by Time (User ID already matches)
                    // Summary created_at should be very close to meeting ended_at
                    if (!match && meeting.ended_at) {
                        const meetingEnd = new Date(meeting.ended_at).getTime();
                        match = summariesData.find(s => {
                            const summaryTime = new Date(s.created_at).getTime();
                            return Math.abs(summaryTime - meetingEnd) < 10000; // 10 second window
                        });
                    }
                }

                return {
                    ...meeting,
                    meeting_summaries: match ? [match] : [] // Attach as array to match existing UI code
                };
            });

            console.log("🔗 Merged History Data:", mergedData);
            setMeetings(mergedData || []);

        } catch (error) {
            console.error('❌ Error fetching history:', error);
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

        const summaryData = meeting.meeting_summaries?.[0];
        let aiSection = '';

        if (summaryData) {
            const statsText = summaryData.emotion_stats
                ? Object.entries(summaryData.emotion_stats).map(([k, v]) => `${k} (${v}%)`).join(', ')
                : 'Brak danych';

            aiSection = `
--- Analiza Emocji AI ---
Czas trwania: ${summaryData.duration_seconds} sek
Dominująca emocja: ${summaryData.dominant_emotion}
Szczegóły: ${statsText}
            `;
        }

        const summary = `
RAPORT SPOTKANIA HUMORA
-----------------------
Data: ${new Date(meeting.started_at).toLocaleString('pl-PL')}
Uczestnik: ${meeting.participant_name || 'Nieznany'}
Czas trwania: ${duration}
Liczba zrzutów: ${meeting.captures?.length || 0}
-----------------------
ID Spotkania: ${meeting.id}
${aiSection}
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
                                        <th className="px-6 py-4 font-semibold tracking-wider">Analiza AI</th>
                                        <th className="px-6 py-4 font-semibold tracking-wider">Raporty</th>
                                        <th className="px-6 py-4 font-semibold tracking-wider text-right">Akcje</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-700">
                                    {meetings.map((meeting) => {
                                        // Calculate duration helper
                                        const getDuration = () => {
                                            if (meeting.meeting_summaries && meeting.meeting_summaries.length > 0) {
                                                const seconds = meeting.meeting_summaries[0].duration_seconds;
                                                const mins = Math.floor(seconds / 60);
                                                const secs = seconds % 60;
                                                return `${mins}:${secs.toString().padStart(2, '0')}`;
                                            }
                                            if (meeting.ended_at) {
                                                const diff = Math.round((new Date(meeting.ended_at) - new Date(meeting.started_at)) / 1000 / 60);
                                                return `${diff} min`;
                                            }
                                            return 'Trwa...';
                                        };

                                        const summary = meeting.meeting_summaries?.[0];

                                        return (
                                            <React.Fragment key={meeting.id}>
                                                <tr className="hover:bg-gray-700/30 transition-colors">
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">
                                                        {new Date(meeting.started_at).toLocaleString('pl-PL')}
                                                    </td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-white">
                                                        {meeting.participant_name || 'Nieznany'}
                                                    </td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-400 font-mono">
                                                        {getDuration()}
                                                    </td>
                                                    <td className="px-6 py-4 whitespace-nowrap">
                                                        {summary ? (
                                                            <div className="group relative inline-block cursor-help">
                                                                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${summary.dominant_emotion === 'Radość' ? 'bg-green-900/30 text-green-400 border-green-500/30' :
                                                                    summary.dominant_emotion === 'Złość' ? 'bg-red-900/30 text-red-400 border-red-500/30' :
                                                                        summary.dominant_emotion === 'Smutek' ? 'bg-blue-900/30 text-blue-400 border-blue-500/30' :
                                                                            'bg-gray-700 text-gray-300 border-gray-600'
                                                                    }`}>
                                                                    {summary.dominant_emotion}
                                                                </span>

                                                                {/* Tooltip */}
                                                                <div className="invisible group-hover:visible absolute z-10 bottom-full left-1/2 transform -translate-x-1/2 mb-2 w-48 bg-gray-900 border border-gray-700 rounded-lg shadow-xl p-3 text-xs">
                                                                    {summary.emotion_stats && Object.entries(summary.emotion_stats).map(([emotion, pct]) => (
                                                                        <div key={emotion} className="flex justify-between py-0.5 text-gray-300">
                                                                            <span>{emotion}:</span>
                                                                            <span className="font-mono text-white">{pct}%</span>
                                                                        </div>
                                                                    ))}
                                                                    <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900"></div>
                                                                </div>
                                                            </div>
                                                        ) : (
                                                            <span className="text-xs text-gray-600">-</span>
                                                        )}
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
                                                            onClick={() => setExpandedChartId(expandedChartId === meeting.id ? null : meeting.id)}
                                                            className="text-green-400 hover:text-green-300 transition-colors"
                                                            title="Oś czasu emocji"
                                                        >
                                                            {expandedChartId === meeting.id ? 'Ukryj Wykres' : '📈 Wykres'}
                                                        </button>
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
                                                {
                                                    expandedChartId === meeting.id && summary?.timeline_data && (
                                                        <tr>
                                                            <td colSpan="6" className="bg-gray-800/80 p-4 border-t border-gray-700">
                                                                <div className="h-64 w-full">
                                                                    <h4 className="text-gray-300 mb-2 font-medium">Oś Czasu Emocji Ai</h4>
                                                                    <ResponsiveContainer width="100%" height="100%">
                                                                        <LineChart
                                                                            data={summary.timeline_data.map(item => {
                                                                                let value = 0;
                                                                                const emotion = item.emotion.toLowerCase();
                                                                                if (emotion.includes('happy') || emotion.includes('radość') || emotion.includes('szczęście')) value = 100;
                                                                                else if (emotion.includes('surprise') || emotion.includes('zaskoczenie')) value = 70;
                                                                                else if (emotion.includes('neutral') || emotion.includes('naturalny')) value = 50;
                                                                                else if (emotion.includes('sad') || emotion.includes('smutek') || emotion.includes('fear') || emotion.includes('disgust')) value = 20;
                                                                                else if (emotion.includes('angry') || emotion.includes('złość') || emotion.includes('gniew')) value = 10;

                                                                                // 🕒 NOWOŚĆ: Obliczanie dokładnego czasu dla danego punktu
                                                                                const totalPoints = summary.timeline_data.length;
                                                                                const totalSeconds = summary.duration_seconds || 0;
                                                                                const currentSecond = totalPoints > 1 ? Math.round((item.timeIndex / (totalPoints - 1)) * totalSeconds) : 0;

                                                                                const mins = Math.floor(currentSecond / 60);
                                                                                const secs = currentSecond % 60;
                                                                                const timeFormatted = `${mins}:${secs.toString().padStart(2, '0')}`;

                                                                                return { timeFormatted, value, emotion: item.emotion };
                                                                            })}
                                                                        >
                                                                            {/* 🕒 NOWOŚĆ: Oś X pokazuje teraz czas, minTickGap zapobiega nakładaniu się napisów */}
                                                                            <XAxis
                                                                                dataKey="timeFormatted"
                                                                                stroke="#9ca3af"
                                                                                minTickGap={40}
                                                                                tick={{ fontSize: 12 }}
                                                                            />
                                                                            <YAxis domain={[0, 100]} stroke="#9ca3af" hide />

                                                                            {/* 🕒 NOWOŚĆ: Tooltip pokazuje czas na samej górze dymku */}
                                                                            <Tooltip
                                                                                contentStyle={{ backgroundColor: '#1f2937', borderColor: '#374151', color: '#f3f4f6', borderRadius: '8px' }}
                                                                                formatter={(value, name, props) => [props.payload.emotion, 'Wykryto']}
                                                                                labelFormatter={(label) => `Czas spotkania: ${label}`}
                                                                            />
                                                                            <Line
                                                                                type="monotone"
                                                                                dataKey="value"
                                                                                stroke="#8b5cf6"
                                                                                strokeWidth={3}
                                                                                dot={false}
                                                                                activeDot={{ r: 6, fill: '#10b981', stroke: '#fff', strokeWidth: 2 }}
                                                                            />
                                                                        </LineChart>
                                                                    </ResponsiveContainer>
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    )}
                                            </React.Fragment>
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
