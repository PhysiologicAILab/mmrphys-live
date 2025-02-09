import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Mock MediaDevices API
Object.defineProperty(window, 'MediaDevices', {
    value: class {
        getUserMedia = vi.fn().mockResolvedValue({
            getTracks: () => [{
                stop: vi.fn()
            }]
        });
    }
});

// Mock WebGL context
HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
    drawImage: vi.fn(),
    getImageData: vi.fn().mockReturnValue({
        data: new Uint8ClampedArray(324),
        width: 9,
        height: 9
    }),
    putImageData: vi.fn(),
    clearRect: vi.fn(),
    save: vi.fn(),
    beginPath: vi.fn(),
    clip: vi.fn(),
    ellipse: vi.fn()
});

// Mock WebAssembly
global.WebAssembly = {
    instantiate: vi.fn().mockResolvedValue({
        instance: {},
        module: {}
    }),
    compile: vi.fn().mockResolvedValue({}),
    Module: function () { },
    Instance: function () { }
};