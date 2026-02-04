import React from 'react';
import { Button } from './Button';

interface ErrorDisplayProps {
    message: string;
    details?: string;
    onRetry?: () => void;
}

export function ErrorDisplay({ message, details, onRetry }: ErrorDisplayProps) {
    return (
        <div className="flex flex-col items-center justify-center p-8 text-center">
            <div className="bg-red-50 border border-red-200 rounded-xl p-6 max-w-md">
                <div className="text-red-600 text-lg font-medium mb-2">
                    ⚠️ Something went wrong
                </div>
                <p className="text-red-700 mb-4">{message}</p>
                {details && (
                    <details className="text-left mb-4">
                        <summary className="text-sm text-red-600 cursor-pointer hover:text-red-800">
                            Show details
                        </summary>
                        <pre className="mt-2 text-xs text-red-600 bg-red-100 p-3 rounded overflow-auto">
                            {details}
                        </pre>
                    </details>
                )}
                {onRetry && (
                    <Button variant="outline" onClick={onRetry}>
                        Try Again
                    </Button>
                )}
            </div>
        </div>
    );
}

interface LoadingSpinnerProps {
    message?: string;
}

export function LoadingSpinner({ message = 'Loading...' }: LoadingSpinnerProps) {
    return (
        <div className="flex flex-col items-center justify-center p-8">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-600 mb-4" />
            <p className="text-gray-600">{message}</p>
        </div>
    );
}
