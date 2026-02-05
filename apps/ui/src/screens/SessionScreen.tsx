import React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { TranscriptMessage, Timing } from '@repo/shared';
import { sendSessionTurn, getSession, parseApiError, transcribeAudio } from '../lib/api';
import {
    TranscriptList,
    ErrorDisplay,
    LoadingSpinner,
} from '../components';

// ============================================================================
// MediaRecorder Support Detection
// ============================================================================

const MIME_CANDIDATES = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4;codecs=mp4a.40.2',
    'audio/mp4',
];

function detectMediaRecorderSupport(): { supported: true; mimeType: string } | { supported: false } {
    if (typeof MediaRecorder === 'undefined') {
        return { supported: false };
    }
    for (const mime of MIME_CANDIDATES) {
        if (MediaRecorder.isTypeSupported(mime)) {
            return { supported: true, mimeType: mime };
        }
    }
    return { supported: false };
}

function mimeToExtension(mimeType: string): string {
    if (mimeType.startsWith('audio/webm')) return 'webm';
    if (mimeType.startsWith('audio/mp4')) return 'm4a';
    return 'webm';
}

const mediaSupport = detectMediaRecorderSupport();

// ============================================================================
// Audio Helpers
// ============================================================================

function createAudioUrl(base64Audio: string, mimeType: string): string {
    try {
        const binaryString = atob(base64Audio);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        const arrayBuffer = bytes.buffer.slice(0, len);
        const blob = new Blob([arrayBuffer], { type: mimeType });
        return URL.createObjectURL(blob);
    } catch (e) {
        console.error("Error converting base64 to audio:", e);
        throw e;
    }
}

// ============================================================================
// SVG Icons (inline to avoid dependency on icon library)
// ============================================================================

function MicIcon({ className = 'w-10 h-10' }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="23" />
            <line x1="8" y1="23" x2="16" y2="23" />
        </svg>
    );
}

function KeyboardIcon({ className = 'w-5 h-5' }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="4" width="20" height="16" rx="2" ry="2" />
            <line x1="6" y1="8" x2="6" y2="8" />
            <line x1="10" y1="8" x2="10" y2="8" />
            <line x1="14" y1="8" x2="14" y2="8" />
            <line x1="18" y1="8" x2="18" y2="8" />
            <line x1="6" y1="12" x2="6" y2="12" />
            <line x1="10" y1="12" x2="10" y2="12" />
            <line x1="14" y1="12" x2="14" y2="12" />
            <line x1="18" y1="12" x2="18" y2="12" />
            <line x1="8" y1="16" x2="16" y2="16" />
        </svg>
    );
}

function SpinnerIcon({ className = 'w-10 h-10' }: { className?: string }) {
    return (
        <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth={4} />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
    );
}

function SpeakerIcon({ className = 'w-4 h-4' }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
            <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
        </svg>
    );
}

// ============================================================================
// SessionScreen Component — Voice Call UI
// ============================================================================

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
    const [fatalError, setFatalError] = React.useState<string | null>(null);
    const [banner, setBanner] = React.useState<{ message: string; retry?: () => void } | null>(null);

    const [messageInput, setMessageInput] = React.useState('');
    const [showKeyboard, setShowKeyboard] = React.useState(false);

    const [ttsEnabled, setTtsEnabled] = React.useState(true);
    const [sending, setSending] = React.useState(false);

    const [audioUrl, setAudioUrl] = React.useState<string | null>(null);
    const [isPlaying, setIsPlaying] = React.useState(false);
    const [audioError, setAudioError] = React.useState<string | null>(null);
    const audioRef = React.useRef<HTMLAudioElement | null>(null);
    const audioUrlRef = React.useRef<string | null>(null);

    const [isRecording, setIsRecording] = React.useState(false);
    const [transcribing, setTranscribing] = React.useState(false);
    const mediaRecorderRef = React.useRef<MediaRecorder | null>(null);
    const streamRef = React.useRef<MediaStream | null>(null);
    const recordedChunksRef = React.useRef<Blob[]>([]);

    const [debugEnabled, setDebugEnabled] = React.useState(false);
    const [lastSttTiming, setLastSttTiming] = React.useState<{ timing?: Timing; requestId?: string } | null>(null);
    const [lastTurnTiming, setLastTurnTiming] = React.useState<{ timing?: Timing; requestId?: string } | null>(null);
    const [micUnsupportedShown, setMicUnsupportedShown] = React.useState(false);
    const inflightRef = React.useRef(false);

    // ========================================================================
    // Cleanup effects
    // ========================================================================
    React.useEffect(() => {
        return () => {
            if (audioUrlRef.current) {
                URL.revokeObjectURL(audioUrlRef.current);
                audioUrlRef.current = null;
            }
            if (audioRef.current) {
                audioRef.current.onplay = null;
                audioRef.current.onpause = null;
                audioRef.current.onended = null;
                audioRef.current.onerror = null;
                audioRef.current.pause();
                audioRef.current = null;
            }
        };
    }, []);

    React.useEffect(() => {
        return () => {
            if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
                try { mediaRecorderRef.current.stop(); } catch { }
            }
            mediaRecorderRef.current = null;
            if (streamRef.current) {
                streamRef.current.getTracks().forEach((track) => track.stop());
                streamRef.current = null;
            }
        };
    }, []);

    // ========================================================================
    // Load session
    // ========================================================================
    React.useEffect(() => {
        async function loadSession() {
            if (!sessionId) {
                setFatalError('No session ID provided');
                setLoading(false);
                return;
            }
            try {
                const data = await getSession(sessionId);
                setSession(data.session);
            } catch (err) {
                setFatalError(parseApiError(err).message);
            } finally {
                setLoading(false);
            }
        }
        loadSession();
    }, [sessionId]);

    // ========================================================================
    // Audio Playback
    // ========================================================================
    const playAudio = React.useCallback((base64Audio: string, mimeType: string) => {
        console.log(`[Audio] Attempting to play ${mimeType}, length: ${base64Audio.length}`);

        if (audioUrlRef.current) {
            URL.revokeObjectURL(audioUrlRef.current);
            audioUrlRef.current = null;
        }
        setAudioUrl(null);

        const prev = audioRef.current;
        audioRef.current = null;
        if (prev) {
            prev.onplay = null;
            prev.onpause = null;
            prev.onended = null;
            prev.onerror = null;
            prev.pause();
        }

        try {
            const url = createAudioUrl(base64Audio, mimeType);
            audioUrlRef.current = url;
            setAudioUrl(url);
            setAudioError(null);

            const audio = new Audio(url);
            audioRef.current = audio;

            audio.onplay = () => setIsPlaying(true);
            audio.onpause = () => setIsPlaying(false);
            audio.onended = () => {
                setIsPlaying(false);
                if (audioUrlRef.current === url) {
                    URL.revokeObjectURL(url);
                    audioUrlRef.current = null;
                }
                setAudioUrl(null);
                audioRef.current = null;
            };
            audio.onerror = (e) => {
                console.error("[Audio] Playback Error:", e);
                setIsPlaying(false);
                setAudioError('Failed to play audio');
                if (audioUrlRef.current === url) {
                    URL.revokeObjectURL(url);
                    audioUrlRef.current = null;
                }
                setAudioUrl(null);
                audioRef.current = null;
            };

            const playPromise = audio.play();
            if (playPromise !== undefined) {
                playPromise.catch((err: DOMException) => {
                    if (err.name === 'AbortError') return;
                    console.warn('Audio autoplay prevented:', err);
                    setAudioError('Click the play button to hear the tutor');
                });
            }
        } catch (err) {
            console.error('Failed to create audio:', err);
            setAudioError('Failed to play audio');
        }
    }, []);

    // ========================================================================
    // Recording handlers
    // ========================================================================
    const startRecording = async () => {
        if (!mediaSupport.supported) return;
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            streamRef.current = stream;
            const mediaRecorder = new MediaRecorder(stream, { mimeType: mediaSupport.mimeType });
            recordedChunksRef.current = [];
            mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) recordedChunksRef.current.push(event.data);
            };
            mediaRecorder.onstop = async () => {
                stream.getTracks().forEach((track) => track.stop());
                streamRef.current = null;
                const audioBlob = new Blob(recordedChunksRef.current, { type: mediaSupport.mimeType });
                await handleTranscribe(audioBlob);
            };
            mediaRecorderRef.current = mediaRecorder;
            mediaRecorder.start(100);
            setIsRecording(true);
        } catch (err) {
            console.error('Failed to start recording:', err);
            setBanner({ message: "Microphone access denied or failed." });
        }
    };

    const stopRecording = () => {
        if (mediaRecorderRef.current && isRecording) {
            mediaRecorderRef.current.stop();
            setIsRecording(false);
            setTranscribing(true);
        }
    };

    const handleTranscribe = async (audioBlob: Blob) => {
        if (!sessionId || inflightRef.current) return;
        setTranscribing(true);
        inflightRef.current = true;

        try {
            const ext = mimeToExtension(mediaSupport.supported ? mediaSupport.mimeType : 'audio/webm');
            const sttResult = await transcribeAudio(sessionId, audioBlob, 'es', ext);
            setLastSttTiming({ timing: sttResult.timing, requestId: sttResult.requestId });

            if (!sttResult.text || !sttResult.text.trim()) {
                setBanner({
                    message: "Couldn't hear anything. Try again.",
                    retry: () => { setBanner(null); startRecording(); },
                });
                return;
            }
            await sendTranscribedMessage(sttResult.text);
        } catch (err) {
            console.error('Transcription failed:', err);
            setBanner({ message: `Transcription failed: ${parseApiError(err).message}` });
        } finally {
            setTranscribing(false);
            inflightRef.current = false;
        }
    };

    const sendTranscribedMessage = async (text: string) => {
        if (!sessionId || sending) return;
        setSending(true);

        try {
            console.log(`[Session] Sending turn. TTS Enabled: ${ttsEnabled}`);
            const data = await sendSessionTurn(sessionId, text, ttsEnabled);
            setSession(data.session);
            setLastTurnTiming({ timing: data.timing, requestId: data.requestId });

            if (ttsEnabled && data.tts?.audioBase64) {
                playAudio(data.tts.audioBase64, data.tts.mimeType);
            }
        } catch (err) {
            console.error('Failed to send transcribed message:', err);
            setBanner({ message: `Failed to send message: ${parseApiError(err).message}` });
        } finally {
            setSending(false);
        }
    };

    // ========================================================================
    // Mic button handler (for the big call button)
    // ========================================================================
    const handleMicPress = () => {
        if (!mediaSupport.supported) {
            if (!micUnsupportedShown) {
                setBanner({ message: "Voice input isn't available in this browser. Use the keyboard instead." });
                setMicUnsupportedShown(true);
                setShowKeyboard(true);
            }
            return;
        }

        if (transcribing || sending) return;

        if (isRecording) {
            stopRecording();
        } else {
            setBanner(null);
            startRecording();
        }
    };

    // ========================================================================
    // Send typed message
    // ========================================================================
    const handleSendMessage = async () => {
        if (!sessionId || !messageInput.trim() || sending || inflightRef.current) return;
        setSending(true);
        inflightRef.current = true;
        const userText = messageInput.trim();
        setMessageInput('');

        try {
            console.log(`[Session] Sending turn (Typed). TTS Enabled: ${ttsEnabled}`);
            const data = await sendSessionTurn(sessionId, userText, ttsEnabled);
            setSession(data.session);
            setLastTurnTiming({ timing: data.timing, requestId: data.requestId });

            if (ttsEnabled && data.tts?.audioBase64) {
                playAudio(data.tts.audioBase64, data.tts.mimeType);
            }
        } catch (err) {
            setBanner({ message: `Failed to send message: ${parseApiError(err).message}` });
        } finally {
            setSending(false);
            inflightRef.current = false;
        }
    };

    const handleEndLesson = () => { if (sessionId) navigate(`/complete?sessionId=${sessionId}`); };
    const handleTakeQuiz = () => { if (session?.postQuizId && sessionId) navigate(`/quiz/${session.postQuizId}?sessionId=${sessionId}`); };
    const handleKeyDown = (e: React.KeyboardEvent) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(); } };

    // ========================================================================
    // Determine mic button state
    // ========================================================================
    const getMicButtonState = () => {
        if (transcribing || sending) return 'processing';
        if (isRecording) return 'recording';
        return 'idle';
    };

    const micState = getMicButtonState();

    const micButtonStyles: Record<string, string> = {
        idle: 'bg-teal-500 hover:bg-teal-600 text-white shadow-lg shadow-teal-500/30 active:scale-95',
        recording: 'bg-red-500 text-white shadow-lg shadow-red-500/40 animate-pulse',
        processing: 'bg-gray-400 text-white cursor-not-allowed',
    };

    const micLabel: Record<string, string> = {
        idle: 'Tap to Speak',
        recording: 'Listening...',
        processing: transcribing ? 'Transcribing...' : 'Sending...',
    };

    // ========================================================================
    // Loading / Error states
    // ========================================================================
    if (loading) {
        return (
            <div className="h-screen flex items-center justify-center bg-gray-50">
                <LoadingSpinner message="Loading session..." />
            </div>
        );
    }

    if (fatalError) {
        return (
            <div className="h-screen flex items-center justify-center bg-gray-50 p-4">
                <ErrorDisplay message={fatalError} onRetry={() => window.location.reload()} />
            </div>
        );
    }

    // ========================================================================
    // Render — Voice Call UI
    // ========================================================================
    return (
        <div className="h-screen bg-gray-50 flex flex-col">
            {/* ============================================================ */}
            {/* Header */}
            {/* ============================================================ */}
            <header className="bg-white border-b border-gray-200 flex-shrink-0 z-20">
                <div className="px-4 py-3 flex items-center justify-between max-w-2xl mx-auto w-full">
                    {/* Exit */}
                    <button
                        onClick={handleEndLesson}
                        className="text-gray-500 hover:text-gray-800 transition-colors p-1"
                        aria-label="Exit session"
                    >
                        <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                    </button>

                    {/* Title + Phase */}
                    <div className="text-center">
                        <h1 className="text-base font-semibold text-gray-900">Practice</h1>
                        {session?.phase && (
                            <p className="text-xs text-gray-400 capitalize">{session.phase}</p>
                        )}
                    </div>

                    {/* Controls */}
                    <div className="flex items-center gap-2">
                        {/* TTS Toggle (compact) */}
                        <button
                            onClick={() => setTtsEnabled(!ttsEnabled)}
                            className={`p-2 rounded-full transition-colors ${ttsEnabled ? 'text-teal-600 bg-teal-50' : 'text-gray-400 bg-gray-100'}`}
                            aria-label={ttsEnabled ? 'Disable tutor voice' : 'Enable tutor voice'}
                        >
                            <SpeakerIcon className="w-5 h-5" />
                        </button>
                        {/* Debug toggle */}
                        <button
                            onClick={() => setDebugEnabled(!debugEnabled)}
                            className={`p-2 rounded-full text-xs font-mono transition-colors ${debugEnabled ? 'text-indigo-600 bg-indigo-50' : 'text-gray-400 bg-gray-100'}`}
                            aria-label="Toggle debug"
                        >
                            {'{ }'}
                        </button>
                    </div>
                </div>
            </header>

            {/* ============================================================ */}
            {/* Banner */}
            {/* ============================================================ */}
            {banner && (
                <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 flex-shrink-0 z-10">
                    <div className="max-w-2xl mx-auto flex items-center justify-between">
                        <span className="text-sm text-amber-800">{banner.message}</span>
                        <div className="flex items-center gap-2">
                            {banner.retry && (
                                <button onClick={banner.retry} className="text-xs text-amber-700 underline">
                                    Retry
                                </button>
                            )}
                            <button onClick={() => setBanner(null)} className="text-amber-600 hover:text-amber-800 ml-2">
                                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                                    <line x1="18" y1="6" x2="6" y2="18" />
                                    <line x1="6" y1="6" x2="18" y2="18" />
                                </svg>
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ============================================================ */}
            {/* Audio playback bar (shows when tutor audio is available) */}
            {/* ============================================================ */}
            {audioUrl && (
                <div className="bg-teal-50 border-b border-teal-200 px-4 py-2 flex-shrink-0">
                    <div className="max-w-2xl mx-auto flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <SpeakerIcon className="w-4 h-4 text-teal-600" />
                            <span className="text-sm text-teal-800 font-medium">
                                {isPlaying ? 'Tutor is speaking...' : 'Tutor audio ready'}
                            </span>
                            {audioError && <span className="text-xs text-red-600 ml-2">{audioError}</span>}
                        </div>
                        <button
                            onClick={() => {
                                if (audioRef.current) {
                                    if (isPlaying) {
                                        audioRef.current.pause();
                                    } else {
                                        audioRef.current.play().catch((err: DOMException) => {
                                            if (err.name !== 'AbortError') console.warn('Audio play prevented:', err);
                                        });
                                    }
                                }
                            }}
                            className="px-3 py-1 rounded-full bg-teal-600 text-white text-xs font-medium hover:bg-teal-700 transition-colors"
                        >
                            {isPlaying ? 'Pause' : 'Play'}
                        </button>
                    </div>
                </div>
            )}

            {/* ============================================================ */}
            {/* Chat / Message Area */}
            {/* ============================================================ */}
            <main className="flex-1 overflow-y-auto">
                <div className="max-w-2xl mx-auto w-full px-4 pt-4 pb-52">
                    {session?.transcript && session.transcript.length > 0 ? (
                        <TranscriptList messages={session.transcript} />
                    ) : (
                        <div className="flex flex-col items-center justify-center h-full min-h-[300px] text-center text-gray-400">
                            <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mb-4">
                                <MicIcon className="w-8 h-8 text-gray-300" />
                            </div>
                            <p className="text-sm">Tap the microphone to start speaking</p>
                            <p className="text-xs mt-1 text-gray-300">or use the keyboard to type</p>
                        </div>
                    )}
                </div>
            </main>

            {/* ============================================================ */}
            {/* Footer — Control Deck */}
            {/* ============================================================ */}
            <footer className="flex-shrink-0 bg-white/90 backdrop-blur-sm border-t border-gray-200 z-20">
                {/* Keyboard text input overlay */}
                {showKeyboard && (
                    <div className="px-4 pt-3 pb-2 border-b border-gray-100 max-w-2xl mx-auto w-full">
                        <div className="flex gap-2">
                            <textarea
                                value={messageInput}
                                onChange={(e) => setMessageInput(e.target.value)}
                                onKeyDown={handleKeyDown}
                                placeholder="Type your response..."
                                className="flex-1 px-3 py-2 border border-gray-300 rounded-xl resize-none text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                                rows={1}
                                disabled={sending}
                                autoFocus
                            />
                            <button
                                onClick={handleSendMessage}
                                disabled={!messageInput.trim() || sending || inflightRef.current}
                                className="px-4 py-2 bg-teal-500 text-white rounded-xl text-sm font-medium disabled:opacity-40 hover:bg-teal-600 transition-colors"
                            >
                                {sending ? '...' : 'Send'}
                            </button>
                        </div>
                    </div>
                )}

                {/* Main control area */}
                <div className="px-4 py-4 max-w-2xl mx-auto w-full">
                    <div className="flex items-center justify-center gap-6">
                        {/* Keyboard toggle (left of mic) */}
                        <button
                            onClick={() => setShowKeyboard(!showKeyboard)}
                            className={`p-3 rounded-full transition-all ${
                                showKeyboard
                                    ? 'bg-teal-100 text-teal-700'
                                    : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                            }`}
                            aria-label="Toggle keyboard input"
                        >
                            <KeyboardIcon className="w-6 h-6" />
                        </button>

                        {/* Big Mic Button */}
                        <div className="flex flex-col items-center">
                            <button
                                onClick={handleMicPress}
                                disabled={micState === 'processing'}
                                className={`
                                    w-20 h-20 rounded-full flex items-center justify-center
                                    transition-all duration-200
                                    focus:outline-none focus:ring-4 focus:ring-teal-200
                                    ${micButtonStyles[micState]}
                                `}
                                aria-label={micLabel[micState]}
                            >
                                {micState === 'processing' ? (
                                    <SpinnerIcon className="w-8 h-8" />
                                ) : (
                                    <MicIcon className={`w-8 h-8 ${micState === 'recording' ? 'animate-none' : ''}`} />
                                )}
                            </button>
                            <span className={`text-xs mt-2 font-medium ${
                                micState === 'recording' ? 'text-red-500' :
                                micState === 'processing' ? 'text-gray-400' :
                                'text-gray-500'
                            }`}>
                                {micLabel[micState]}
                            </span>
                        </div>

                        {/* End lesson button (right of mic) */}
                        <button
                            onClick={handleEndLesson}
                            className="p-3 rounded-full bg-gray-100 text-gray-500 hover:bg-red-50 hover:text-red-500 transition-all"
                            aria-label="End lesson"
                        >
                            <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                                <path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91" />
                                <line x1="23" y1="1" x2="1" y2="23" />
                            </svg>
                        </button>
                    </div>
                </div>

                {/* Quiz prompt (if available) */}
                {session?.postQuizId && (
                    <div className="px-4 pb-3 max-w-2xl mx-auto w-full">
                        <button
                            onClick={handleTakeQuiz}
                            className="w-full py-2 rounded-xl bg-indigo-50 text-indigo-700 text-sm font-medium hover:bg-indigo-100 transition-colors"
                        >
                            Take Quiz
                        </button>
                    </div>
                )}
            </footer>

            {/* ============================================================ */}
            {/* Debug Panel */}
            {/* ============================================================ */}
            {debugEnabled && <DebugPanel sttTiming={lastSttTiming} turnTiming={lastTurnTiming} />}
        </div>
    );
}

// ============================================================================
// Debug Panel
// ============================================================================
function DebugPanel({ sttTiming, turnTiming }: { sttTiming: any; turnTiming: any }) {
    return (
        <div className="fixed bottom-4 left-4 bg-gray-900 text-gray-100 p-4 rounded-lg shadow-lg max-w-xs text-xs font-mono z-50">
            <pre className="overflow-auto max-h-48">{JSON.stringify({ stt: sttTiming, turn: turnTiming }, null, 2)}</pre>
        </div>
    );
}
