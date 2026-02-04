import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/Button';

export function Menu() {
    const navigate = useNavigate();

    return (
        <div className="min-h-screen bg-gradient-to-b from-indigo-50 to-white flex flex-col items-center justify-center p-4">
            <div className="max-w-md w-full text-center">
                {/* Logo/Header */}
                <div className="mb-8">
                    <div className="inline-flex items-center justify-center w-20 h-20 bg-indigo-600 rounded-2xl mb-4">
                        <span className="text-4xl">💬</span>
                    </div>
                    <h1 className="text-4xl font-bold text-gray-900 mb-2">
                        Conversational
                    </h1>
                    <p className="text-lg text-gray-600">
                        Practice Spanish through real-world conversations
                    </p>
                </div>

                {/* Main CTA */}
                <div className="mb-8">
                    <Button
                        size="lg"
                        className="w-full py-4 text-lg"
                        onClick={() => navigate('/levels')}
                    >
                        Start Learning
                    </Button>
                </div>

                {/* Features */}
                <div className="grid grid-cols-1 gap-4 text-left">
                    <div className="flex items-start gap-3 p-4 bg-white rounded-xl shadow-sm border border-gray-100">
                        <span className="text-2xl">🎯</span>
                        <div>
                            <h3 className="font-medium text-gray-900">Real Scenarios</h3>
                            <p className="text-sm text-gray-600">Practice everyday conversations</p>
                        </div>
                    </div>
                    <div className="flex items-start gap-3 p-4 bg-white rounded-xl shadow-sm border border-gray-100">
                        <span className="text-2xl">🤖</span>
                        <div>
                            <h3 className="font-medium text-gray-900">AI Tutor</h3>
                            <p className="text-sm text-gray-600">Get instant feedback on your Spanish</p>
                        </div>
                    </div>
                    <div className="flex items-start gap-3 p-4 bg-white rounded-xl shadow-sm border border-gray-100">
                        <span className="text-2xl">📊</span>
                        <div>
                            <h3 className="font-medium text-gray-900">Track Progress</h3>
                            <p className="text-sm text-gray-600">See your improvement over time</p>
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <p className="mt-8 text-sm text-gray-500">
                    Select a level to begin your journey
                </p>
            </div>
        </div>
    );
}
