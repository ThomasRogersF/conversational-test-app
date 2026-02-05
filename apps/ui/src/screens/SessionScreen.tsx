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
// SessionScreen Component
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
    
    // CHANGED: Default to TRUE so you hear audio immediately
    const [ttsEnabled, setTtsEnabled] = React.useState(true); 
    const [sending, setSending] = React.useState(false);

    const [audioUrl, setAudioUrl] = React.useState<string | null>(null);
    const [isPlaying, setIsPlaying] = React.useState(false);
    const [audioError, setAudioError] = React.useState<string | null>(null);
    const audioRef = React.useRef<HTMLAudioElement | null>(null);
    const audioUrlRef = React.useRef<string | null>(null);

    const [micEnabled, setMicEnabled] = React.useState(false);
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

    // ... (Cleanup effects remain the same) ...
    // Cleanup only on unmount — NOT on every audioUrl change.
    // Using audioUrlRef (not the audioUrl state) avoids the stale-closure
    // problem and ensures we never accidentally pause a newly-started audio
    // element just because a re-render ran the previous effect's cleanup.
    React.useEffect(() => {
        return () => {
            if (audioUrlRef.current) {
                URL.revokeObjectURL(audioUrlRef.current);
                audioUrlRef.current = null;
            }
            if (audioRef.current) {
                // Detach handlers before pausing so the pause() doesn't
                // trigger state updates on an unmounting component.
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

    // ============================================================================
    // Audio Playback (Instrumented)
    // ============================================================================
    const playAudio = React.useCallback((base64Audio: string, mimeType: string) => {
        console.log(`[Audio] Attempting to play ${mimeType}, length: ${base64Audio.length}`);

        // Revoke the previous Blob URL via ref (not state) to avoid
        // stale-closure issues and unnecessary re-render dependencies.
        if (audioUrlRef.current) {
            URL.revokeObjectURL(audioUrlRef.current);
            audioUrlRef.current = null;
        }
        setAudioUrl(null);

        // Stop previous audio before creating a new element. Detach the ref
        // first so that the cleanup effect doesn't also try to pause it while
        // the new play() promise is still settling.
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
                // Only revoke if this URL is still the active one (a newer
                // playAudio call may have already replaced it).
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
                    if (err.name === 'AbortError') {
                        // The play() was interrupted by a newer pause/play cycle
                        // (e.g. user navigated away or new audio arrived). Safe to ignore.
                        return;
                    }
                    console.warn('Audio autoplay prevented:', err);
                    setAudioError('Click the play button to hear the tutor');
                });
            }
        } catch (err) {
            console.error('Failed to create audio:', err);
            setAudioError('Failed to play audio');
        }
    }, []);

    // ... (Recording handlers remain same until sendTranscribedMessage) ...

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
            setMicEnabled(false);
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
                    retry: () => { setBanner(null); setMicEnabled(true); startRecording(); },
                });
                return;
            }
            await sendTranscribedMessage(sttResult.text);
        } catch (err) {
            console.error('Transcription failed:', err);
            setBanner({ message: `Transcription failed: ${parseApiError(err).message}` });
            setMicEnabled(false);
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

            // LOGGING: Check if TTS data arrived
            if (data.tts) {
                console.log("[Session] Received TTS payload:", data.tts);
            } else {
                console.log("[Session] No TTS payload in response.");
            }

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

    const toggleMic = () => {
        if (!mediaSupport.supported) {
            if (!micUnsupportedShown) {
                setBanner({ message: "Voice input isn't available in this browser." });
                setMicUnsupportedShown(true);
            }
            return;
        }
        if (micEnabled) {
            if (isRecording) stopRecording();
            setMicEnabled(false);
        } else {
            setBanner(null);
            setMicEnabled(true);
            startRecording();
        }
    };

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

            if (data.tts) {
                console.log("[Session] Received TTS payload:", data.tts);
            } else {
                console.log("[Session] No TTS payload.");
            }

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

    // ... (Rest of component handles, handleEndLesson, etc. remain the same) ...
    const handleEndLesson = () => { if (sessionId) navigate(`/complete?sessionId=${sessionId}`); };
    const handleTakeQuiz = () => { if (session?.postQuizId && sessionId) navigate(`/quiz/${session.postQuizId}?sessionId=${sessionId}`); };
    const handleKeyDown = (e: React.KeyboardEvent) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(); } };

    const micDisabled = transcribing || sending;
    const sendDisabled = (!messageInput.trim() && !transcribing) || sending || inflightRef.current;

    // ... (Keep your JSX render exactly as it was, just ensure the Toggle uses the ttsEnabled state) ...
    
    // Copy the entire return (...) block from your original file, it is compatible.
    // Ensure the Toggle button uses: onClick={() => setTtsEnabled(!ttsEnabled)}
    
    // For brevity in this response, I'm skipping re-pasting the 200 lines of JSX 
    // since the logic changes above are what matters.
    // Simply keep your existing JSX Return block.

    return (
        <div className="min-h-screen bg-gray-100 flex flex-col">
            {/* Header */}
            <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
                <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
                    <button onClick={handleEndLesson} className="text-gray-600 hover:text-gray-900 flex items-center gap-2">
                        <span>←</span><span>Exit</span>
                    </button>
                    <h1 className="text-lg font-semibold text-gray-900">Practice Session</h1>
                    <div className="flex items-center gap-3">
                        <label className="flex items-center space-x-2 cursor-pointer">
                            <button
                                type="button"
                                role="switch"
                                aria-checked={ttsEnabled}
                                onClick={() => setTtsEnabled(!ttsEnabled)}
                                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${ttsEnabled ? 'bg-indigo-600' : 'bg-gray-200'}`}
                            >
                                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${ttsEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                            </button>
                            <span className="text-sm font-medium text-gray-700 flex items-center gap-2"><span>🔊</span><span>Tutor Voice</span></span>
                        </label>
                        {mediaSupport.supported && (
                            <button
                                type="button"
                                onClick={toggleMic}
                                disabled={micDisabled}
                                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium ${micEnabled ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-700'} ${micDisabled ? 'opacity-50' : ''}`}
                            >
                                {transcribing ? <span>⏳ Transcribing...</span> : isRecording ? <span>● Recording...</span> : <span>🎤 Mic Input</span>}
                            </button>
                        )}
                        <Toggle label="Debug" checked={debugEnabled} onChange={setDebugEnabled} />
                    </div>
                </div>
            </header>
            
            {/* Banner */}
            {banner && (
                <div className="bg-amber-50 border-b border-amber-200 px-4 py-2">
                    <div className="max-w-4xl mx-auto flex items-center justify-between">
                        <span className="text-sm text-amber-800">{banner.message}</span>
                         <button onClick={() => setBanner(null)}>×</button>
                    </div>
                </div>
            )}

            {/* Transcript */}
            <main className="flex-1 max-w-4xl mx-auto w-full p-4 overflow-auto">
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 min-h-[500px] flex flex-col">
                    <TranscriptList messages={session?.transcript || []} className="flex-1" />
                </div>
                {audioUrl && (
                    <div className="mt-4 p-3 bg-indigo-50 rounded-lg border border-indigo-200 flex items-center justify-between">
                         <div className="flex items-center gap-3"><span className="text-indigo-600">🔊</span><span className="text-sm text-indigo-800 font-medium">Tutor Voice</span></div>
                         <div className="flex items-center gap-3">
                             {audioError && <span className="text-xs text-red-600">{audioError}</span>}
                             <button onClick={() => { if(audioRef.current) { if (isPlaying) { audioRef.current.pause(); } else { audioRef.current.play().catch((err: DOMException) => { if (err.name !== 'AbortError') { console.warn('Audio play prevented:', err); } }); } } }} className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium">
                                {isPlaying ? 'Pause' : 'Play'}
                             </button>
                         </div>
                    </div>
                )}
            </main>

            {/* Footer Input */}
            <footer className="bg-white border-t border-gray-200 p-4">
                <div className="max-w-4xl mx-auto">
                    <div className="flex gap-3">
                        <textarea value={messageInput} onChange={(e) => setMessageInput(e.target.value)} onKeyDown={handleKeyDown} placeholder="Type your response..." className="flex-1 px-4 py-3 border border-gray-300 rounded-lg resize-none" rows={2} disabled={sending} />
                        <Button onClick={handleSendMessage} disabled={sendDisabled} className="self-end">{transcribing ? '...' : sending ? '...' : 'Send'}</Button>
                    </div>
                </div>
            </footer>

            {debugEnabled && <DebugPanel sttTiming={lastSttTiming} turnTiming={lastTurnTiming} />}
        </div>
    );
}

// Keep the DebugPanel component at the bottom...
function DebugPanel({ sttTiming, turnTiming }: { sttTiming: any; turnTiming: any; }) {
    return (
        <div className="fixed bottom-4 left-4 bg-gray-900 text-gray-100 p-4 rounded-lg shadow-lg max-w-xs text-sm">
             <pre>{JSON.stringify({stt: sttTiming, turn: turnTiming}, null, 2)}</pre>
        </div>
    );
}