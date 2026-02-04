import React from 'react';

interface TagProps {
    children: React.ReactNode;
    variant?: 'default' | 'success' | 'warning' | 'info';
    size?: 'sm' | 'md';
    className?: string;
}

export function Tag({
    children,
    variant = 'default',
    size = 'md',
    className = '',
}: TagProps) {
    const variantStyles = {
        default: 'bg-gray-100 text-gray-700',
        success: 'bg-green-100 text-green-700',
        warning: 'bg-yellow-100 text-yellow-700',
        info: 'bg-blue-100 text-blue-700',
    };

    const sizeStyles = {
        sm: 'px-2 py-0.5 text-xs',
        md: 'px-2.5 py-1 text-sm',
    };

    return (
        <span
            className={`
                inline-flex items-center font-medium rounded-full
                ${variantStyles[variant]}
                ${sizeStyles[size]}
                ${className}
            `}
        >
            {children}
        </span>
    );
}

/**
 * Tag variant helpers for convenience
 */
export function LevelTag({ level }: { level: string }) {
    return <Tag variant="info">{level}</Tag>;
}

export function QuizTag() {
    return <Tag variant="success">Quiz Available</Tag>;
}
