import React from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getSession, parseApiError } from '../lib/api';
import { Button, Card, CardContent } from '../components';

interface QuizResult {
    quizId: string;
    answers: number[];
    score: number;
    total: number;
    completedAt: string;
}

interface SessionCompletion {
    summary: string;
    completedAt: string;
}

/**
 * Get quiz result from localStorage
 */
function getQuizResult(quizId: string, sessionId: string): QuizResult | null {
    const key = `quiz_result_${quizId}_${sessionId}`;
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : null;
}

export function CompleteScreen() {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const sessionId = searchParams.get('sessionId');

    const [turnCount, setTurnCount] = React.useState(0);
    const [quizResult, setQuizResult] = React.useState<QuizResult | null>(null);
    const [completion, setCompletion] = React.useState<SessionCompletion | null>(null);
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState<string | null>(null);

    React.useEffect(() => {
        async function loadSummary() {
            if (!sessionId) {
                setLoading(false);
                return;
            }

            try {
                const data = await getSession(sessionId);
                const session = data.session;

                setTurnCount(session.turnCount);

                // Get quiz result from server or localStorage
                if (session.quizResult) {
                    setQuizResult({
                        quizId: session.quizResult.quizId,
                        answers: session.quizResult.answers,
                        score: session.quizResult.score,
                        total: session.quizResult.total,
                        completedAt: session.quizResult.completedAt,
                    });
                } else if (session.postQuizId) {
                    // Fallback to localStorage
                    const localResult = getQuizResult(session.postQuizId, sessionId);
                    if (localResult) {
                        setQuizResult(localResult);
                    }
                }

                // Get completion from server
                if (session.completion) {
                    setCompletion({
                        summary: session.completion.summary,
                        completedAt: session.completion.completedAt,
                    });
                }
            } catch (err) {
                setError(parseApiError(err).message);
            } finally {
                setLoading(false);
            }
        }
        loadSummary();
    }, [sessionId]);

    const handleBackToMenu = () => {
        navigate('/');
    };

    const handleRetakeQuiz = () => {
        if (quizResult && sessionId) {
            navigate(`/quiz/${quizResult.quizId}?sessionId=${sessionId}`);
        }
    };

    const handleTryAnotherScenario = () => {
        navigate('/levels');
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center">
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-600" />
            </div>
        );
    }

    if (error) {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
                <Card className="max-w-md w-full">
                    <CardContent className="py-6">
                        <div className="text-center text-red-600 mb-4">
                            <p className="font-semibold">Failed to load session summary</p>
                            <p className="text-sm mt-2">{error}</p>
                        </div>
                        <Button onClick={handleBackToMenu} className="w-full">
                            Back to Menu
                        </Button>
                    </CardContent>
                </Card>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-50">
            {/* Header */}
            <header className="bg-white border-b border-gray-200">
                <div className="max-w-2xl mx-auto px-4 py-6 text-center">
                    <div className="inline-flex items-center justify-center w-16 h-16 bg-green-100 rounded-full mb-4">
                        <span className="text-3xl">🎉</span>
                    </div>
                    <h1 className="text-3xl font-bold text-gray-900">
                        Lesson Completed!
                    </h1>
                    <p className="text-gray-600 mt-2">
                        Great job practicing your Spanish today
                    </p>
                </div>
            </header>

            {/* Content */}
            <main className="max-w-2xl mx-auto px-4 py-8">
                {/* Session Summary */}
                <Card className="mb-6">
                    <CardContent className="py-6">
                        <h2 className="text-lg font-semibold text-gray-900 mb-4">
                            Session Summary
                        </h2>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="text-center p-4 bg-gray-50 rounded-lg">
                                <div className="text-3xl font-bold text-gray-900">
                                    {turnCount}
                                </div>
                                <div className="text-sm text-gray-600">Total Turns</div>
                            </div>

                            {quizResult ? (
                                <div className="text-center p-4 bg-green-50 rounded-lg">
                                    <div className="text-3xl font-bold text-green-600">
                                        {quizResult.score}%
                                    </div>
                                    <div className="text-sm text-green-700">Quiz Score</div>
                                </div>
                            ) : (
                                <div className="text-center p-4 bg-gray-50 rounded-lg">
                                    <div className="text-3xl font-bold text-gray-400">
                                        —
                                    </div>
                                    <div className="text-sm text-gray-500">No Quiz Taken</div>
                                </div>
                            )}
                        </div>

                        {quizResult && (
                            <div className="mt-4">
                                <Button
                                    onClick={handleRetakeQuiz}
                                    variant="outline"
                                    className="w-full"
                                >
                                    Retry Quiz
                                </Button>
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* Teacher Summary (if available) */}
                {completion ? (
                    <Card className="mb-6">
                        <CardContent className="py-6">
                            <h2 className="text-lg font-semibold text-gray-900 mb-4">
                                Lesson Summary
                            </h2>
                            <p className="text-gray-700">{completion.summary}</p>
                            <p className="text-sm text-gray-500 mt-2">
                                Completed: {new Date(completion.completedAt).toLocaleDateString()}
                            </p>
                        </CardContent>
                    </Card>
                ) : (
                    <Card className="mb-6">
                        <CardContent className="py-6">
                            <h2 className="text-lg font-semibold text-gray-900 mb-4">
                                Lesson Summary
                            </h2>
                            <p className="text-gray-500">
                                Your teacher hasn't provided a summary yet.
                            </p>
                        </CardContent>
                    </Card>
                )}

                {/* Actions */}
                <div className="space-y-3">
                    <Button
                        onClick={handleBackToMenu}
                        className="w-full"
                        size="lg"
                    >
                        Back to Menu
                    </Button>

                    <Button
                        onClick={handleTryAnotherScenario}
                        variant="outline"
                        className="w-full"
                        size="lg"
                    >
                        Try Another Scenario
                    </Button>
                </div>

                {/* Tips */}
                <div className="mt-8 p-4 bg-indigo-50 rounded-xl border border-indigo-100">
                    <h3 className="font-medium text-indigo-900 mb-2">
                        💡 Tips for improvement
                    </h3>
                    <ul className="text-sm text-indigo-700 space-y-1">
                        <li>• Practice a little every day for best results</li>
                        <li>• Try speaking aloud to improve pronunciation</li>
                        <li>• Review the quiz explanations to understand your mistakes</li>
                    </ul>
                </div>
            </main>
        </div>
    );
}
