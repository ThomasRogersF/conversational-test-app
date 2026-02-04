import React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { TranscriptMessage, Timing } from '@repo/shared';
import { sendSessionTurn, getSession, parseApiError, transcribeAudio } from '../lib/api';
import {
    TranscriptList,
    Button,
    ErrorDisplay,
    LoadingSpinner,
    Toggle,
} from '../components';

/**
 * Create a Blob URL from base64 audio data
 */
function createAudioUrl(base64Audio: string, mimeType: string): string {
    const binaryString = atob(base64Audio);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    // Use ArrayBuffer for proper type compatibility
    const arrayBuffer = bytes.buffer.slice(0, len);
    const blob = new Blob([arrayBuffer], { type: mimeType });
    return URL.createObjectURL(blob);
}

export function SessionScreen() {
    const navigate = useNavigate();
    const { sessionId } = useParams<{ sessionId: string }>();
    const [session, setSession] = React.useState<{
        id: string;
        transcript: TranscriptMessage[];
        phase: string;
        postQuizId?: string;
        activeQuiz?: { quizId: string; startedAt: string };
    } | null>(null);
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState<string | null>(null);
    const [messageInput, setMessageInput] = React.useState('');
    const [ttsEnabled, setTtsEnabled] = React.useState(false);
    const [sending, setSending] = React.useState(false);

    // Audio playback state
    const [audioUrl, setAudioUrl] = React.useState<string | null>(null);
    const [isPlaying, setIsPlaying] = React.useState(false);
    const [audioError, setAudioError] = React.useState<string | null>(null);
    const audioRef = React.useRef<HTMLAudioElement | null>(null);

    // Microphone/Recording state (default OFF)
    const [micEnabled, setMicEnabled] = React.useState(false);
    const [isRecording, setIsRecording] = React.useState(false);
    const [transcribing, setTranscribing] = React.useState(false);
    const mediaRecorderRef = React.useRef<MediaRecorder | null>(null);
    const recordedChunksRef = React.useRef<Blob[]>([]);

    // Debug panel state (default OFF)
    const [debugEnabled, setDebugEnabled] = React.useState(false);
    const [lastSttTiming, setLastSttTiming] = React.useState<{ timing?: Timing; requestId?: string } | null>(null);
    const [lastTurnTiming, setLastTurnTiming] = React.useState<{ timing?: Timing; requestId?: string } | null>(null);

    // Cleanup audio URL on unmount
    React.useEffect(() => {
        return () => {
            if (audioUrl) {
                URL.revokeObjectURL(audioUrl);
            }
            if (audioRef.current) {
                audioRef.current.pause();
                audioRef.current = null;
            }
        };
    }, [audioUrl]);

    // Load session on mount
    React.useEffect(() => {
        async function loadSession() {
            if (!sessionId) {
                setError('No session ID provided');
                setLoading(false);
                return;
            }

            try {
                const data = await getSession(sessionId);
                setSession(data.session);
            } catch (err) {
                setError(parseApiError(err).message);
            } finally {
                setLoading(false);
            }
        }
        loadSession();
    }, [sessionId]);

    /**
     * Play audio from base64 data
     */
    const playAudio = React.useCallback((base64Audio: string, mimeType: string) => {
        // Clean up previous audio
        if (audioUrl) {
            URL.revokeObjectURL(audioUrl);
            setAudioUrl(null);
        }
        if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current = null;
        }

        try {
            const url = createAudioUrl(base64Audio, mimeType);
            setAudioUrl(url);
            setAudioError(null);

            const audio = new Audio(url);
            audioRef.current = audio;

            audio.onplay = () => setIsPlaying(true);
            audio.onpause = () => setIsPlaying(false);
            audio.onended = () => {
                setIsPlaying(false);
                // Clean up after playback
                URL.revokeObjectURL(url);
                setAudioUrl(null);
                audioRef.current = null;
            };
            audio.onerror = () => {
                setIsPlaying(false);
                setAudioError('Failed to play audio');
                URL.revokeObjectURL(url);
                setAudioUrl(null);
                audioRef.current = null;
            };

            // Attempt autoplay (may fail due to browser policies)
            const playPromise = audio.play();
            if (playPromise !== undefined) {
                playPromise.catch((err) => {
                    // Autoplay was prevented - user must interact first
                    console.warn('Audio autoplay prevented:', err);
                    setAudioError('Click the play button to hear the tutor');
                });
            }
        } catch (err) {
            console.error('Failed to create audio:', err);
            setAudioError('Failed to play audio');
        }
    }, [audioUrl]);

    // ============================================================================
    // Microphone Recording Handlers
    // ============================================================================

    /**
     * Start recording audio from the microphone
     */
    const startRecording = async () => {
        try {
            // Request microphone permission
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

            // Set up media recorder with webm format (widely supported)
            const mediaRecorder = new MediaRecorder(stream, {
                mimeType: 'audio/webm',
            });

            // Clear previous recording
            recordedChunksRef.current = [];

            // Collect audio chunks
            mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    recordedChunksRef.current.push(event.data);
                }
            };

            // When recording stops, process the audio
            mediaRecorder.onstop = async () => {
                // Stop all tracks to release the microphone
                stream.getTracks().forEach((track) => track.stop());

                // Create the audio blob
                const audioBlob = new Blob(recordedChunksRef.current, { type: 'audio/webm' });

                // Transcribe the audio
                await handleTranscribe(audioBlob);
            };

            // Start recording
            mediaRecorderRef.current = mediaRecorder;
            mediaRecorder.start(100); // Collect data every 100ms for better responsiveness
            setIsRecording(true);
        } catch (err) {
            console.error('Failed to start recording:', err);
            if (err instanceof Error && err.name === 'NotAllowedError') {
                setError('Microphone access denied. Please allow microphone access to use voice input.');
            } else {
                setError('Failed to access microphone. Please try again.');
            }
            setMicEnabled(false);
        }
    };

    /**
     * Stop recording and trigger transcription
     */
    const stopRecording = () => {
        if (mediaRecorderRef.current && isRecording) {
            mediaRecorderRef.current.stop();
            setIsRecording(false);
            setTranscribing(true);
        }
    };

    /**
     * Transcribe recorded audio and send as a session turn
     */
    const handleTranscribe = async (audioBlob: Blob) => {
        if (!sessionId) return;

        setTranscribing(true);

        try {
            // Transcribe the audio (now returns timing data)
            const sttResult = await transcribeAudio(sessionId, audioBlob, 'es');
            setLastSttTiming({
                timing: sttResult.timing,
                requestId: sttResult.requestId,
            });

            // Send the transcribed text as a user message (auto-send)
            await sendTranscribedMessage(sttResult.text);
        } catch (err) {
            console.error('Transcription failed:', err);
            setError(`Transcription failed: ${parseApiError(err).message}. You can still type your message.`);
            setTranscribing(false);
            setMicEnabled(false);
        }
    };

    /**
     * Send transcribed text as a session turn
     */
    const sendTranscribedMessage = async (text: string) => {
        if (!sessionId || sending) return;

        setSending(true);

        try {
            const data = await sendSessionTurn(sessionId, text, ttsEnabled);
            setSession(data.session);
            setLastTurnTiming({
                timing: data.timing,
                requestId: data.requestId,
            });

            // Handle TTS audio playback
            if (ttsEnabled && data.tts?.audioBase64) {
                playAudio(data.tts.audioBase64, data.tts.mimeType);
            }
        } catch (err) {
            console.error('Failed to send transcribed message:', err);
            setError(`Failed to send message: ${parseApiError(err).message}`);
        } finally {
            setSending(false);
            setTranscribing(false);
        }
    };

    /**
     * Toggle microphone on/off
     */
    const toggleMic = () => {
        if (micEnabled) {
            // If currently enabled, stop recording if active
            if (isRecording) {
                stopRecording();
            }
            setMicEnabled(false);
        } else {
            // Enable mic and start recording
            setMicEnabled(true);
            startRecording();
        }
    };

    const handleSendMessage = async () => {
        if (!sessionId || !messageInput.trim() || sending) return;

        setSending(true);
        const userText = messageInput.trim();
        setMessageInput('');

        try {
            const data = await sendSessionTurn(sessionId, userText, ttsEnabled);
            setSession(data.session);
            setLastTurnTiming({
                timing: data.timing,
                requestId: data.requestId,
            });

            // Handle TTS audio playback
            if (ttsEnabled && data.tts?.audioBase64) {
                playAudio(data.tts.audioBase64, data.tts.mimeType);
            }
        } catch (err) {
            setError(parseApiError(err).message);
        } finally {
            setSending(false);
        }
    };

    const handleEndLesson = () => {
        if (!sessionId) return;
        navigate(`/complete?sessionId=${sessionId}`);
    };

    const handleTakeQuiz = () => {
        if (!session?.postQuizId || !sessionId) return;
        navigate(`/quiz/${session.postQuizId}?sessionId=${sessionId}`);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage();
        }
    };

    if (loading) {
        return <LoadingSpinner message="Loading session..." />;
    }

    if (error || !session) {
        return <ErrorDisplay message={error || 'Session not found'} onRetry={() => navigate('/levels')} />;
    }

    return (
        <div className="min-h-screen bg-gray-100 flex flex-col">
            {/* Header */}
            <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
                <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
                    <button
                        onClick={handleEndLesson}
                        className="text-gray-600 hover:text-gray-900 flex items-center gap-2"
                    >
                        <span>←</span>
                        <span>Exit</span>
                    </button>
                    <h1 className="text-lg font-semibold text-gray-900">
                        Practice Session
                    </h1>
                    <div className="flex items-center gap-3">
                        {/* Tutor Voice Toggle */}
                        <label className="flex items-center space-x-2 cursor-pointer">
                            <button
                                type="button"
                                role="switch"
                                aria-checked={ttsEnabled}
                                onClick={() => setTtsEnabled(!ttsEnabled)}
                                className={`
                                    relative inline-flex h-6 w-11 items-center rounded-full
                                    transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2
                                    ${ttsEnabled ? 'bg-indigo-600' : 'bg-gray-200'}
                                `}
                            >
                                <span
                                    className={`
                                        inline-block h-4 w-4 transform rounded-full bg-white transition-transform
                                        ${ttsEnabled ? 'translate-x-6' : 'translate-x-1'}
                                    `}
                                />
                            </button>
                            <span className="text-sm font-medium text-gray-700 flex items-center gap-2">
                                <span>🔊</span>
                                <span>Tutor Voice</span>
                            </span>
                        </label>

                        {/* Mic Input Toggle */}
                        <button
                            type="button"
                            onClick={toggleMic}
                            disabled={transcribing || sending}
                            className={`
                                flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium
                                transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2
                                ${micEnabled
                                    ? 'bg-red-100 text-red-700 hover:bg-red-200'
                                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                }
                                ${transcribing || sending ? 'opacity-50 cursor-not-allowed' : ''}
                            `}
                            title={micEnabled ? 'Click to stop recording' : 'Click to start voice input'}
                        >
                            {transcribing ? (
                                <>
                                    <span className="animate-pulse">⏳</span>
                                    <span>Transcribing...</span>
                                </>
                            ) : isRecording ? (
                                <>
                                    <span className="animate-pulse">●</span>
                                    <span>Recording...</span>
                                </>
                            ) : (
                                <>
                                    <span>🎤</span>
                                    <span>Mic Input</span>
                                </>
                            )}
                        </button>

                        {/* Debug Toggle */}
                        <Toggle
                            label="Debug"
                            checked={debugEnabled}
                            onChange={setDebugEnabled}
                        />
                    </div>
                </div>
            </header>

            {/* Transcript Area */}
            <main className="flex-1 max-w-4xl mx-auto w-full p-4 overflow-auto">
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 min-h-[500px] flex flex-col">
                    <TranscriptList
                        messages={session.transcript}
                        className="flex-1"
                    />
                </div>

                {/* Audio Playback UI - shown when audio is available */}
                {audioUrl && (
                    <div className="mt-4 p-3 bg-indigo-50 rounded-lg border border-indigo-200 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <span className="text-indigo-600">🔊</span>
                            <span className="text-sm text-indigo-800 font-medium">Tutor Voice</span>
                        </div>
                        <div className="flex items-center gap-3">
                            {audioError && (
                                <span className="text-xs text-red-600">{audioError}</span>
                            )}
                            <button
                                onClick={() => {
                                    if (isPlaying && audioRef.current) {
                                        audioRef.current.pause();
                                    } else if (audioRef.current) {
                                        audioRef.current.play().catch(() => {
                                            setAudioError('Click to play');
                                        });
                                    } else if (audioUrl) {
                                        // Recreate audio if needed
                                        const audio = new Audio(audioUrl);
                                        audioRef.current = audio;
                                        audio.onplay = () => setIsPlaying(true);
                                        audio.onpause = () => setIsPlaying(false);
                                        audio.onended = () => {
                                            setIsPlaying(false);
                                        };
                                        audio.play().catch(() => {
                                            setAudioError('Playback failed');
                                        });
                                    }
                                }}
                                className={`
                                    px-4 py-2 rounded-lg text-sm font-medium transition-colors
                                    ${isPlaying
                                        ? 'bg-indigo-200 text-indigo-800 hover:bg-indigo-300'
                                        : 'bg-indigo-600 text-white hover:bg-indigo-700'
                                    }
                                `}
                            >
                                {isPlaying ? 'Pause' : audioError ? 'Play' : 'Play'}
                            </button>
                        </div>
                    </div>
                )}
            </main>

            {/* Input Area */}
            <footer className="bg-white border-t border-gray-200 p-4">
                <div className="max-w-4xl mx-auto">
                    <div className="flex gap-3">
                        <textarea
                            value={messageInput}
                            onChange={(e) => setMessageInput(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder="Type your response in Spanish..."
                            className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 resize-none"
                            rows={2}
                            disabled={sending}
                        />
                        <Button
                            onClick={handleSendMessage}
                            disabled={(!messageInput.trim() && !transcribing) || sending}
                            className="self-end"
                        >
                            {transcribing ? 'Transcribing...' : sending ? 'Sending...' : 'Send'}
                        </Button>
                    </div>
                    {transcribing && (
                        <p className="text-xs text-indigo-600 mt-2 text-center">
                            Converting speech to text...
                        </p>
                    )}
                    {!transcribing && (
                        <p className="text-xs text-gray-500 mt-2 text-center">
                            Press Enter to send, Shift+Enter for new line
                        </p>
                    )}
                </div>
            </footer>

            {/* Quiz Button (if active quiz started via tool) */}
            {session.phase === 'quiz' && session.activeQuiz && (
                <div className="fixed bottom-24 right-4">
                    <Button
                        onClick={() => navigate(`/quiz/${session.activeQuiz!.quizId}?sessionId=${session!.id}`)}
                        variant="outline"
                        className="shadow-lg bg-white"
                    >
                        📝 Go to Quiz
                    </Button>
                </div>
            )}

            {/* Post-quiz button (if scenario has postQuizId) */}
            {session.phase !== 'quiz' && session.postQuizId && (
                <div className="fixed bottom-24 right-4">
                    <Button
                        onClick={handleTakeQuiz}
                        variant="outline"
                        className="shadow-lg"
                    >
                        Take Quiz →
                    </Button>
                </div>
            )}

            {/* End Lesson Button */}
            <div className="fixed bottom-4 right-4">
                <Button
                    onClick={handleEndLesson}
                    variant="secondary"
                    className="shadow-lg"
                >
                    End Lesson
                </Button>
            </div>

            {/* Debug Panel */}
            {debugEnabled && (
                <DebugPanel
                    sttTiming={lastSttTiming}
                    turnTiming={lastTurnTiming}
                />
            )}
        </div>
    );
}

/**
 * Debug Panel Component - displays request timing information
 */
function DebugPanel({
    sttTiming,
    turnTiming,
}: {
    sttTiming: { timing?: Timing; requestId?: string } | null;
    turnTiming: { timing?: Timing; requestId?: string } | null;
}) {
    return (
        <div className="fixed bottom-4 left-4 bg-gray-900 text-gray-100 p-4 rounded-lg shadow-lg max-w-xs text-sm">
            <h3 className="font-bold mb-2 text-indigo-400">Debug Info</h3>

            {/* STT Timing */}
            {sttTiming && (
                <div className="mb-3 border-b border-gray-700 pb-2">
                    <h4 className="font-semibold text-yellow-400 mb-1">STT Transcription</h4>
                    {sttTiming.requestId && (
                        <p className="text-xs font-mono text-gray-400 break-all">
                            ID: {sttTiming.requestId}
                        </p>
                    )}
                    {sttTiming.timing && (
                        <div className="grid grid-cols-2 gap-1 mt-1">
                            <span>STT:</span>
                            <span className="font-mono">{sttTiming.timing.sttMs ?? '—'}ms</span>
                            <span>Total:</span>
                            <span className="font-mono">{sttTiming.timing.totalMs ?? '—'}ms</span>
                        </div>
                    )}
                </div>
            )}

            {/* Turn Timing */}
            {turnTiming && (
                <div>
                    <h4 className="font-semibold text-green-400 mb-1">Session Turn</h4>
                    {turnTiming.requestId && (
                        <p className="text-xs font-mono text-gray-400 break-all">
                            ID: {turnTiming.requestId}
                        </p>
                    )}
                    {turnTiming.timing && (
                        <div className="grid grid-cols-2 gap-1 mt-1">
                            <span>LLM:</span>
                            <span className="font-mono">{turnTiming.timing.llmMs ?? '—'}ms</span>
                            <span>Tool:</span>
                            <span className="font-mono">{turnTiming.timing.toolMs ?? '—'}ms</span>
                            <span>TTS:</span>
                            <span className="font-mono">{turnTiming.timing.ttsMs ?? '—'}ms</span>
                            <span>Total:</span>
                            <span className="font-mono">{turnTiming.timing.totalMs ?? '—'}ms</span>
                        </div>
                    )}
                </div>
            )}

            {/* Empty state */}
            {!sttTiming && !turnTiming && (
                <p className="text-gray-500 text-xs">
                    No requests yet. Try recording or sending a message.
                </p>
            )}
        </div>
    );
}
