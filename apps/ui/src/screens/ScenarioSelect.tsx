import React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Scenario } from '@repo/shared';
import { getScenarios, startSession, parseApiError } from '../lib/api';
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    CardDescription,
    Tag,
    QuizTag,
    Button,
    ErrorDisplay,
    LoadingSpinner,
} from '../components';

export function ScenarioSelect() {
    const navigate = useNavigate();
    const { levelId } = useParams<{ levelId: string }>();
    const [scenarios, setScenarios] = React.useState<Scenario[]>([]);
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState<{ message: string; details?: string } | null>(null);
    const [startingScenario, setStartingScenario] = React.useState<string | null>(null);

    React.useEffect(() => {
        async function loadScenarios() {
            if (!levelId) {
                setError({ message: 'No level specified' });
                setLoading(false);
                return;
            }

            try {
                const data = await getScenarios(levelId);
                setScenarios(data);
            } catch (err) {
                setError({
                    message: 'Failed to load scenarios',
                    details: parseApiError(err).message,
                });
            } finally {
                setLoading(false);
            }
        }
        loadScenarios();
    }, [levelId]);

    const handleStartScenario = async (scenario: Scenario) => {
        if (!levelId) return;

        setStartingScenario(scenario.id);

        try {
            const { sessionId } = await startSession(levelId, scenario.id);
            navigate(`/session/${sessionId}`);
        } catch (err) {
            setError({
                message: 'Failed to start session',
                details: parseApiError(err).message,
            });
            setStartingScenario(null);
        }
    };

    if (loading) {
        return <LoadingSpinner message="Loading scenarios..." />;
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
                        onClick={() => navigate('/levels')}
                        className="text-gray-600 hover:text-gray-900 flex items-center gap-2"
                    >
                        <span>←</span>
                        <span>Back</span>
                    </button>
                    <h1 className="text-xl font-semibold text-gray-900">
                        {levelId} Scenarios
                    </h1>
                    <div className="w-20" /> {/* Spacer for centering */}
                </div>
            </header>

            {/* Content */}
            <main className="max-w-4xl mx-auto px-4 py-8">
                <p className="text-gray-600 mb-6">
                    Choose a conversation scenario to practice
                </p>

                <div className="grid grid-cols-1 gap-4">
                    {scenarios.map((scenario) => (
                        <Card key={scenario.id} className="hover:border-indigo-300 transition-all">
                            <CardHeader>
                                <div className="flex items-start justify-between">
                                    <div className="flex-1">
                                        <CardTitle className="text-lg">{scenario.title}</CardTitle>
                                        <CardDescription className="mt-1">
                                            {scenario.description}
                                        </CardDescription>
                                    </div>
                                    {scenario.postQuizId && <QuizTag />}
                                </div>
                            </CardHeader>
                            <CardContent>
                                {/* Tags */}
                                <div className="flex flex-wrap gap-2 mb-4">
                                    {scenario.tags.map((tag) => (
                                        <Tag key={tag}>{tag}</Tag>
                                    ))}
                                </div>

                                {/* Learning Goals */}
                                <div className="mb-4">
                                    <h4 className="text-sm font-medium text-gray-700 mb-2">
                                        Learning Goals:
                                    </h4>
                                    <ul className="text-sm text-gray-600 space-y-1">
                                        {scenario.learningGoals.map((goal, index) => (
                                            <li key={index} className="flex items-start gap-2">
                                                <span className="text-indigo-500 mt-0.5">•</span>
                                                {goal}
                                            </li>
                                        ))}
                                    </ul>
                                </div>

                                {/* Start Button */}
                                <Button
                                    onClick={() => handleStartScenario(scenario)}
                                    disabled={startingScenario === scenario.id}
                                    className="w-full sm:w-auto"
                                >
                                    {startingScenario === scenario.id ? 'Starting...' : 'Start Scenario'}
                                </Button>
                            </CardContent>
                        </Card>
                    ))}
                </div>

                {scenarios.length === 0 && (
                    <div className="text-center py-12">
                        <p className="text-gray-500">No scenarios available for this level</p>
                    </div>
                )}
            </main>
        </div>
    );
}
