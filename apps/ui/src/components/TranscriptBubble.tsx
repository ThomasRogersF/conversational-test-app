import React from 'react';

export type MessageRole = 'user' | 'tutor';

interface TranscriptBubbleProps {
    role: MessageRole;
    text: string;
    ts?: string;
}

export function TranscriptBubble({ role, text, ts }: TranscriptBubbleProps) {
    const isUser = role === 'user';

    return (
        <div className={`flex items-end gap-2 ${isUser ? 'justify-end' : 'justify-start'} mb-3`}>
            {/* Tutor Avatar */}
            {!isUser && (
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-teal-100 flex items-center justify-center">
                    <span className="text-sm">🤖</span>
                </div>
            )}
            <div
                className={`
                    max-w-[75%] rounded-2xl px-4 py-2.5 shadow-sm
                    ${isUser
                        ? 'bg-indigo-600 text-white rounded-br-sm'
                        : 'bg-white text-gray-900 rounded-bl-sm border border-gray-100'
                    }
                `}
            >
                <p className="text-sm leading-relaxed whitespace-pre-wrap">{text}</p>
                {ts && (
                    <p className={`text-[10px] mt-1 ${isUser ? 'text-indigo-200' : 'text-gray-400'}`}>
                        {new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                )}
            </div>
            {/* User Avatar */}
            {isUser && (
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center">
                    <span className="text-sm">👤</span>
                </div>
            )}
        </div>
    );
}

/**
 * Container for transcript messages with scroll behavior
 */
interface TranscriptListProps {
    messages: Array<{
        role: MessageRole;
        text: string;
        ts?: string;
    }>;
    className?: string;
}

export function TranscriptList({ messages, className = '' }: TranscriptListProps) {
    const bottomRef = React.useRef<HTMLDivElement>(null);

    React.useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    return (
        <div className={`flex flex-col ${className}`}>
            {messages.map((msg, index) => (
                <TranscriptBubble
                    key={index}
                    role={msg.role}
                    text={msg.text}
                    ts={msg.ts}
                />
            ))}
            <div ref={bottomRef} />
        </div>
    );
}
