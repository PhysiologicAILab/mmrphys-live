import { useState, useEffect } from 'react';

interface DeviceCapabilities {
    hasCamera: boolean;
    hasWebGL: boolean;
    hasWebAssembly: boolean;
    performance: {
        memory: number;
        cores: number;
        connection: string;
    };
    isCompatible: boolean;
}

export const useDeviceCapabilities = () => {
    const [capabilities, setCapabilities] = useState<DeviceCapabilities | null>(null);
    const [isChecking, setIsChecking] = useState(true);

    useEffect(() => {
        const checkDeviceCapabilities = async () => {
            try {
                // Check camera
                const devices = await navigator.mediaDevices.enumerateDevices();
                const hasCamera = devices.some(device => device.kind === 'videoinput');

                // Check WebGL
                const canvas = document.createElement('canvas');
                const hasWebGL = !!(
                    window.WebGLRenderingContext &&
                    (canvas.getContext('webgl') || canvas.getContext('experimental-webgl'))
                );

                // Check WebAssembly
                const hasWebAssembly = typeof WebAssembly === 'object';

                // Get performance capabilities
                const performance = {
                    memory: (navigator as any).deviceMemory || 4,
                    cores: navigator.hardwareConcurrency || 2,
                    connection: ((navigator as any).connection as any)?.effectiveType || '4g'
                };

                const capabilities: DeviceCapabilities = {
                    hasCamera,
                    hasWebGL,
                    hasWebAssembly,
                    performance,
                    isCompatible: hasCamera && hasWebGL && hasWebAssembly
                };

                setCapabilities(capabilities);
            } catch (error) {
                console.error('Error checking device capabilities:', error);
                setCapabilities(null);
            } finally {
                setIsChecking(false);
            }
        };

        checkDeviceCapabilities();
    }, []);

    return { capabilities, isChecking };
};