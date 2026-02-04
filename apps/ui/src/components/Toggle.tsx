import React from 'react';

interface ToggleProps {
    label: string;
    checked: boolean;
    onChange: (checked: boolean) => void;
    disabled?: boolean;
    icon?: React.ReactNode;
}

export function Toggle({
    label,
    checked,
    onChange,
    disabled = false,
    icon,
}: ToggleProps) {
    return (
        <label className="flex items-center space-x-3 cursor-pointer">
            <button
                type="button"
                role="switch"
                aria-checked={checked}
                disabled={disabled}
                onClick={() => onChange(!checked)}
                className={`
                    relative inline-flex h-6 w-11 items-center rounded-full
                    transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2
                    ${checked ? 'bg-indigo-600' : 'bg-gray-200'}
                    ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
                `}
            >
                <span
                    className={`
                        inline-block h-4 w-4 transform rounded-full bg-white transition-transform
                        ${checked ? 'translate-x-6' : 'translate-x-1'}
                    `}
                />
            </button>
            <span className="text-sm font-medium text-gray-700 flex items-center gap-2">
                {icon && <span className="text-gray-500">{icon}</span>}
                {label}
            </span>
        </label>
    );
}

/**
 * Pre-configured toggles for session controls
 */
export function AudioToggle({ checked, onChange, disabled }: Omit<ToggleProps, 'label'>) {
    return (
        <Toggle
            label="Audio"
            checked={checked}
            onChange={onChange}
            disabled={disabled}
            icon={<span>🔊</span>}
        />
    );
}

export function MicToggle({ checked, onChange, disabled }: Omit<ToggleProps, 'label'>) {
    return (
        <Toggle
            label="Microphone"
            checked={checked}
            onChange={onChange}
            disabled={disabled}
            icon={<span>🎤</span>}
        />
    );
}
