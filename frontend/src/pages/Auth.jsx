import React, { useState } from 'react';
import supabase from '../supabaseClient';

export default function Auth() {
    const [loading, setLoading] = useState(false);
    const [isLoginView, setIsLoginView] = useState(true);
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [error, setError] = useState(null);

    const getEmail = (user) => `${user.trim().toLowerCase()}@humora.local`;

    const handleLogin = async () => {
        setLoading(true);
        setError(null);
        const { error } = await supabase.auth.signInWithPassword({
            email: getEmail(username),
            password,
        });

        if (error) {
            setError('Złe hasło lub użytkownik nie istnieje');
        }
        setLoading(false);
    };

    const handleRegister = async () => {
        if (password !== confirmPassword) {
            setError('Hasła nie są identyczne');
            return;
        }

        setLoading(true);
        setError(null);
        const { data, error } = await supabase.auth.signUp({
            email: getEmail(username),
            password,
        });

        if (error) {
            setError(error.message);
        } else if (data.user) {
            const userId = data.user.id;
            const { error: profileError } = await supabase
                .from('profiles')
                .insert([{ id: userId, username: username.trim() }]);

            if (profileError) {
                // Warning: Account created but profile failed
                setError('Konto utworzone, ale wystąpił błąd profilu: ' + profileError.message);
            } else {
                setError(null);
            }
        }
        setLoading(false);
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        if (isLoginView) {
            handleLogin();
        } else {
            handleRegister();
        }
    };

    return (
        <div className="flex items-center justify-center min-h-screen bg-gray-900 text-white">
            <div className="w-full max-w-md p-8 space-y-6 bg-gray-800 rounded-lg shadow-lg">
                <h2 className="text-3xl font-bold text-center text-purple-500">Humora</h2>
                <p className="text-center text-gray-400">
                    {isLoginView ? 'Witaj ponownie' : 'Stwórz nowe konto'}
                </p>

                <form className="space-y-4" onSubmit={handleSubmit}>
                    <div>
                        <label className="block text-sm font-medium text-gray-300">Nazwa użytkownika</label>
                        <input
                            type="text"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            required
                            className="w-full px-4 py-2 mt-1 text-white bg-gray-700 border border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-purple-500"
                            placeholder="Wpisz nazwę użytkownika"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-300">Hasło</label>
                        <input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                            className="w-full px-4 py-2 mt-1 text-white bg-gray-700 border border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-purple-500"
                            placeholder="••••••••"
                        />
                    </div>

                    {!isLoginView && (
                        <div>
                            <label className="block text-sm font-medium text-gray-300">Potwierdź hasło</label>
                            <input
                                type="password"
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                required
                                className="w-full px-4 py-2 mt-1 text-white bg-gray-700 border border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-purple-500"
                                placeholder="••••••••"
                            />
                        </div>
                    )}

                    {error && (
                        <div className="text-sm text-center text-red-500">
                            {error}
                        </div>
                    )}

                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full py-2 font-bold text-white transition bg-purple-600 rounded hover:bg-purple-700 disabled:opacity-50"
                    >
                        {loading ? 'Ładowanie...' : (isLoginView ? 'Zaloguj się' : 'Zarejestruj się')}
                    </button>
                </form>

                <div className="text-center text-sm text-gray-400">
                    {isLoginView ? 'Nie masz konta? ' : 'Masz już konto? '}
                    <button
                        onClick={() => {
                            setIsLoginView(!isLoginView);
                            setError(null);
                        }}
                        disabled={loading}
                        className="text-purple-400 hover:text-purple-300 hover:underline font-medium transition-all duration-200 hover:drop-shadow-[0_0_5px_rgba(168,85,247,0.5)]"
                    >
                        {isLoginView ? 'Zarejestruj się' : 'Zaloguj się'}
                    </button>
                </div>
            </div>
        </div>
    );
}
