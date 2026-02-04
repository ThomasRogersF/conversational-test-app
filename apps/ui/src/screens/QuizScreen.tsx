import React from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { Quiz } from '@repo/shared';
import { getQuiz, submitQuizAnswers } from '../lib/api';
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    Button,
    ErrorDisplay,
    LoadingSpinner,
} from '../components';

interface QuizResult {
    quizId: string;
    sessionId: string;
    answers: number[];
    score: number;
    total: number;
    completedAt: string;
}

/**
 * Save quiz result to localStorage
 */
function saveQuizResult(result: QuizResult): void {
    const key = `quiz_result_${result.quizId}_${result.sessionId}`;
    localStorage.setItem(key, JSON.stringify(result));
}

/**
 * Get quiz result from localStorage
 */
function getQuizResult(quizId: string, sessionId: string): QuizResult | null {
    const key = `quiz_result_${quizId}_${sessionId}`;
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : null;
}

export function QuizScreen() {
    const navigate = useNavigate();
    const { quizId } = useParams<{ quizId: string }>();
    const [searchParams] = useSearchParams();
    const sessionId = searchParams.get('sessionId');

    const [quiz, setQuiz] = React.useState<Quiz | null>(null);
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState<{ message: string; details?: string } | null>(null);
    const [submitting, setSubmitting] = React.useState(false);

    // Quiz state - use array indexed by question order
    const [answers, setAnswers] = React.useState<number[]>([]);
    const [submitted, setSubmitted] = React.useState(false);
    const [quizResult, setQuizResult] = React.useState<QuizResult | null>(null);

    // Initialize answers array when quiz loads
    React.useEffect(() => {
        if (quiz && answers.length === 0) {
            setAnswers(new Array(quiz.items.length).fill(-1));
        }
    }, [quiz, answers.length]);

    React.useEffect(() => {
        async function loadQuiz() {
            if (!quizId) {
                setError({ message: 'No quiz ID provided' });
                setLoading(false);
                return;
            }

            try {
                const data = await getQuiz(quizId);
                setQuiz(data);
            } catch (err) {
                setError({
                    message: 'Failed to load quiz',
                    details: err instanceof Error ? err.message : String(err),
                });
            } finally {
                setLoading(false);
            }
        }
        loadQuiz();
    }, [quizId]);

    // Check for existing result on mount
    React.useEffect(() => {
        if (quiz && sessionId) {
            const existing = getQuizResult(quiz.id, sessionId);
            if (existing) {
                setQuizResult(existing);
                setSubmitted(true);
                setAnswers(existing.answers);
            }
        }
    }, [quiz, sessionId]);

    const handleSelectOption = (questionIndex: number, optionIndex: number) => {
        if (submitted) return;

        setAnswers((prev) => {
            const newAnswers = [...prev];
            newAnswers[questionIndex] = optionIndex;
            return newAnswers;
        });
    };

    const handleSubmit = async () => {
        if (!quiz || !sessionId) return;

        // Validate all questions answered
        const allAnswered = answers.length === quiz.items.length && answers.every(a => a >= 0);
        if (!allAnswered) {
            setError({ message: 'Please answer all questions before submitting' });
            return;
        }

        setSubmitting(true);
        setError(null);

        try {
            // Submit to server for authoritative grading
            const response = await submitQuizAnswers(sessionId, quiz.id, answers);

            const result: QuizResult = {
                quizId: quiz.id,
                sessionId,
                answers: response.result.answers,
                score: response.result.score,
                total: response.result.total,
                completedAt: response.result.completedAt,
            };

            saveQuizResult(result);
            setQuizResult(result);
            setSubmitted(true);
        } catch (err) {
            setError({
                message: 'Failed to submit quiz',
                details: err instanceof Error ? err.message : String(err),
            });
        } finally {
            setSubmitting(false);
        }
    };

    const handleRetry = () => {
        if (quiz) {
            setAnswers(new Array(quiz.items.length).fill(-1));
        }
        setSubmitted(false);
        setQuizResult(null);
        setError(null);
    };

    const handleContinue = () => {
        if (sessionId) {
            navigate(`/complete?sessionId=${sessionId}`);
        } else {
            navigate('/');
        }
    };

    if (loading) {
        return <LoadingSpinner message="Loading quiz..." />;
    }

    if (error && !quiz) {
        return <ErrorDisplay message={error.message} onRetry={() => window.location.reload()} />;
    }

    if (!quiz) {
        return <ErrorDisplay message="Quiz not found" onRetry={() => window.location.reload()} />;
    }

    const answeredCount = answers.filter(a => a >= 0).length;
    const allAnswered = answeredCount === quiz.items.length;

    return (
        <div className="min-h-screen bg-gray-50">
            {/* Header */}
            <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
                <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
                    <button
                        onClick={() => sessionId ? navigate(`/complete?sessionId=${sessionId}`) : navigate('/')}
                        className="text-gray-600 hover:text-gray-900 flex items-center gap-2"
                    >
                        <span>←</span>
                        <span>Back</span>
                    </button>
                    <h1 className="text-xl font-semibold text-gray-900">
                        Quiz
                    </h1>
                    {!submitted && (
                        <div className={`text-sm ${allAnswered ? 'text-green-600 font-medium' : 'text-gray-500'}`}>
                            {answeredCount}/{quiz.items.length} answered
                        </div>
                    )}
                </div>
            </header>

            {/* Content */}
            <main className="max-w-3xl mx-auto px-4 py-8">
                {/* Error display */}
                {error && (
                    <Card className="mb-6 bg-red-50 border-red-200">
                        <CardContent className="py-4">
                            <p className="text-red-700">{error.message}</p>
                            {error.details && (
                                <p className="text-red-600 text-sm mt-1">{error.details}</p>
                            )}
                        </CardContent>
                    </Card>
                )}

                {/* Quiz Result Summary */}
                {submitted && quizResult && (
                    <Card className="mb-8 bg-green-50 border-green-200">
                        <CardContent className="text-center py-6">
                            <div className="text-5xl font-bold text-green-600 mb-2">
                                {quizResult.score}%
                            </div>
                            <p className="text-green-700">
                                You got {Math.round(quizResult.score * quizResult.total / 100)} out of {quizResult.total} correct
                            </p>
                        </CardContent>
                    </Card>
                )}

                {/* Quiz Questions */}
                <div className="space-y-6">
                    {quiz.items.map((item, questionIndex) => {
                        const selectedOption = answers[questionIndex] ?? -1;
                        const showResult = submitted;
                        const isCorrect = selectedOption === item.correctIndex;

                        return (
                            <Card key={questionIndex} className={showResult ? (isCorrect ? 'border-green-300' : 'border-red-300') : ''}>
                                <CardHeader>
                                    <CardTitle className="text-base">
                                        {questionIndex + 1}. {item.question}
                                    </CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <div className="space-y-2">
                                        {item.options.map((option, optionIndex) => {
                                            const isSelected = selectedOption === optionIndex;
                                            const isCorrectOption = optionIndex === item.correctIndex;

                                            let optionClass = 'border-gray-200 hover:border-indigo-300 hover:bg-indigo-50';

                                            if (showResult) {
                                                if (isCorrectOption) {
                                                    optionClass = 'border-green-500 bg-green-50';
                                                } else if (isSelected && !isCorrect) {
                                                    optionClass = 'border-red-500 bg-red-50';
                                                } else if (!isCorrect && optionIndex === item.correctIndex) {
                                                    optionClass = 'border-green-500 bg-green-50';
                                                }
                                            } else if (isSelected) {
                                                optionClass = 'border-indigo-500 bg-indigo-50';
                                            }

                                            return (
                                                <button
                                                    key={optionIndex}
                                                    onClick={() => handleSelectOption(questionIndex, optionIndex)}
                                                    disabled={submitted}
                                                    className={`
                                                        w-full text-left px-4 py-3 rounded-lg border-2 transition-all
                                                        ${optionClass}
                                                        ${submitted ? 'cursor-default' : 'cursor-pointer'}
                                                    `}
                                                >
                                                    <div className="flex items-center gap-3">
                                                        <span
                                                            className={`
                                                                w-6 h-6 rounded-full border-2 flex items-center justify-center text-sm
                                                                ${isSelected ? 'border-indigo-500 bg-indigo-500 text-white' : 'border-gray-300'}
                                                                ${showResult && isCorrectOption ? 'border-green-500 bg-green-500 text-white' : ''}
                                                                ${showResult && isSelected && !isCorrect ? 'border-red-500 bg-red-500 text-white' : ''}
                                                            `}
                                                        >
                                                            {String.fromCharCode(65 + optionIndex)}
                                                        </span>
                                                        <span>{option}</span>
                                                    </div>
                                                </button>
                                            );
                                        })}
                                    </div>

                                    {/* Explanation (shown after submit) */}
                                    {showResult && item.explanation && (
                                        <div className="mt-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
                                            <p className="text-sm text-gray-700">
                                                <span className="font-medium">
                                                    {isCorrect ? '✓ Correct!' : '✗ Incorrect. '}
                                                </span>
                                                {item.explanation}
                                            </p>
                                        </div>
                                    )}
                                </CardContent>
                            </Card>
                        );
                    })}
                </div>

                {/* Actions */}
                <div className="mt-8 flex gap-4 justify-center">
                    {!submitted ? (
                        <Button
                            size="lg"
                            onClick={handleSubmit}
                            disabled={!allAnswered || submitting}
                        >
                            {submitting ? 'Submitting...' : 'Submit Quiz'}
                        </Button>
                    ) : (
                        <>
                            <Button size="lg" variant="outline" onClick={handleRetry}>
                                Retry Quiz
                            </Button>
                            <Button size="lg" onClick={handleContinue}>
                                Continue
                            </Button>
                        </>
                    )}
                </div>
            </main>
        </div>
    );
}
