/// <reference types="vite/client" />
/// <reference types="react" />
/// <reference types="react-dom" />

// Library type declarations
declare module 'face-api.js';
declare module 'onnxruntime-web';
declare module 'chart.js';
declare module 'react-chartjs-2';

// Environment variables interface
interface ImportMetaEnv {
    readonly VITE_APP_TITLE: string;
    readonly VITE_MODEL_PATH: string;
    readonly VITE_FACE_API_PATH: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}

// WASM module declaration
declare module '*.wasm' {
    const content: ArrayBuffer;
    export default content;
}

// Extend Window interface for custom properties
interface Window {
    fs?: {
        readFile: (path: string, options?: { encoding?: string }) => Promise<ArrayBuffer | string>;
    };
}