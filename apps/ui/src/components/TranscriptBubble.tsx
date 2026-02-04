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
        <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4`}>
            <div
                className={`
                    max-w-[80%] rounded-2xl px-4 py-3
                    ${isUser
                        ? 'bg-indigo-600 text-white rounded-br-md'
                        : 'bg-gray-100 text-gray-900 rounded-bl-md'
                    }
                `}
            >
                <p className="text-sm leading-relaxed">{text}</p>
                {ts && (
                    <p className={`text-xs mt-1 ${isUser ? 'text-indigo-200' : 'text-gray-400'}`}>
                        {new Date(ts).toLocaleTimeString()}
                    </p>
                )}
            </div>
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
