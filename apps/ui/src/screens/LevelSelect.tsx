import React from 'react';
import { useNavigate } from 'react-router-dom';
import type { Level } from '@repo/shared';
import { getLevels } from '../lib/api';
import { Card, CardContent, LevelTag, ErrorDisplay, LoadingSpinner } from '../components';

export function LevelSelect() {
    const navigate = useNavigate();
    const [levels, setLevels] = React.useState<Level[]>([]);
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState<{ message: string; details?: string } | null>(null);

    React.useEffect(() => {
        async function loadLevels() {
            try {
                const data = await getLevels();
                setLevels(data);
            } catch (err) {
                setError({
                    message: 'Failed to load levels',
                    details: err instanceof Error ? err.message : String(err),
                });
            } finally {
                setLoading(false);
            }
        }
        loadLevels();
    }, []);

    if (loading) {
        return <LoadingSpinner message="Loading levels..." />;
    }

    if (error) {
        return <ErrorDisplay message={error.message} details={error.details} onRetry={() => window.location.reload()} />;
    }

    return (
        <div className="min-h-screen bg-gray-50">
            {/* Header */}
            <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
                <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
                    <button
                        onClick={() => navigate('/')}
                        className="text-gray-600 hover:text-gray-900 flex items-center gap-2"
                    >
                        <span>←</span>
                        <span>Back</span>
                    </button>
                    <h1 className="text-xl font-semibold text-gray-900">Select Level</h1>
                    <div className="w-20" /> {/* Spacer for centering */}
                </div>
            </header>

            {/* Content */}
            <main className="max-w-4xl mx-auto px-4 py-8">
                <p className="text-gray-600 mb-6">
                    Choose a difficulty level to start practicing
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {levels.map((level) => (
                        <Card
                            key={level.id}
                            className="hover:border-indigo-300 transition-all"
                            onClick={() => navigate(`/scenarios/${level.id}`)}
                        >
                            <CardContent>
                                <div className="flex items-start justify-between">
                                    <div>
                                        <div className="flex items-center gap-2 mb-2">
                                            <LevelTag level={level.id} />
                                        </div>
                                        <h2 className="text-xl font-semibold text-gray-900 mb-1">
                                            {level.name}
                                        </h2>
                                        <p className="text-gray-600 text-sm">
                                            {level.description}
                                        </p>
                                    </div>
                                    <span className="text-3xl">→</span>
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>

                {levels.length === 0 && (
                    <div className="text-center py-12">
                        <p className="text-gray-500">No levels available</p>
                    </div>
                )}
            </main>
        </div>
    );
}
