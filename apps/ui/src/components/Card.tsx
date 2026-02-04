import React from 'react';

interface CardProps {
    children: React.ReactNode;
    className?: string;
    onClick?: () => void;
}

export function Card({ children, className = '', onClick }: CardProps) {
    return (
        <div
            onClick={onClick}
            className={`
                bg-white rounded-xl shadow-sm border border-gray-200 p-6
                ${onClick ? 'cursor-pointer hover:shadow-md hover:border-gray-300 transition-all' : ''}
                ${className}
            `}
        >
            {children}
        </div>
    );
}

export function CardHeader({ children, className = '' }: { children: React.ReactNode; className?: string }) {
    return <div className={`mb-4 ${className}`}>{children}</div>;
}

export function CardTitle({ children, className = '' }: { children: React.ReactNode; className?: string }) {
    return <h3 className={`text-lg font-semibold text-gray-900 ${className}`}>{children}</h3>;
}

export function CardDescription({ children, className = '' }: { children: React.ReactNode; className?: string }) {
    return <p className={`text-sm text-gray-600 mt-1 ${className}`}>{children}</p>;
}

export function CardContent({ children, className = '' }: { children: React.ReactNode; className?: string }) {
    return <div className={className}>{children}</div>;
}

export function CardFooter({ children, className = '' }: { children: React.ReactNode; className?: string }) {
    return <div className={`mt-4 pt-4 border-t border-gray-100 ${className}`}>{children}</div>;
}
