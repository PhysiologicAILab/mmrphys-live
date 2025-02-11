// src/workers/faceDetectionWorker.ts
import * as faceapi from 'face-api.js';

interface FaceDetectionMessage {
    type: 'init' | 'detect';
    imageData?: ImageData;
    width?: number;
    height?: number;
}

// Robust environment configuration for web workers
const setupFaceAPIEnvironment = () => {
    // Create a type-safe environment configuration
    const env: Record<string, any> = {
        isNodejs: () => false,
        isBrowser: () => true,
        platform: 'browser',
        getEnv: () => ({
            Canvas: OffscreenCanvas,
            Image: typeof Image !== 'undefined' ? Image : class { } as any,
            ImageData: ImageData,
            createCanvasElement: (width = 1, height = 1) => {
                return new OffscreenCanvas(width, height);
            },
            createImageElement: () => {
                // Minimal image-like object
                return {
                    width: 0,
                    height: 0,
                    src: '',
                    addEventListener: () => { },
                    removeEventListener: () => { },
                    complete: true
                };
            }
        }),
        monkeyPatch: () => { } // Add explicit monkeyPatch method
    };

    // Patch the face-api environment
    try {
        // Use Object.assign to safely add properties
        Object.assign(faceapi.env, env);
    } catch (error) {
        console.error('Failed to configure face-api environment:', error);
    }

    return env;
};

const options = new faceapi.TinyFaceDetectorOptions({
    inputSize: 320,
    scoreThreshold: 0.3
});

let isInitialized = false;

self.onmessage = async (e: MessageEvent<FaceDetectionMessage>) => {
    try {
        switch (e.data.type) {
            case 'init':
                if (!isInitialized) {
                    // Explicitly set up the environment
                    setupFaceAPIEnvironment();

                    try {
                        // Manually create a mock canvas for environment
                        const mockCanvas = new OffscreenCanvas(320, 240);
                        mockCanvas.getContext('2d');

                        // Load model weights with explicit paths
                        const modelPath = '/models/face-api';
                        await faceapi.nets.tinyFaceDetector.load(modelPath);

                        isInitialized = true;
                        self.postMessage({ type: 'init', status: 'success' });
                    } catch (loadError) {
                        console.error('Model loading error:', loadError);
                        self.postMessage({
                            type: 'init',
                            status: 'error',
                            error: loadError instanceof Error ? loadError.message : 'Unknown model loading error'
                        });
                    }
                }
                break;

            case 'detect':
                if (!isInitialized) {
                    throw new Error('Face detector not initialized');
                }

                const { imageData, width, height } = e.data;
                if (!imageData || !width || !height) {
                    // Return center crop information when no face is detected
                    self.postMessage({
                        type: 'detect',
                        status: 'fallback',
                        detection: null,
                        fallbackMode: true
                    });
                    return;
                }

                // Create an offscreen canvas
                const canvas = new OffscreenCanvas(width, height);
                const ctx = canvas.getContext('2d');
                if (!ctx) {
                    throw new Error('Could not get canvas context');
                }

                // Draw image data to canvas
                ctx.putImageData(imageData, 0, 0);

                try {
                    // Attempt face detection
                    const detection = await faceapi.detectSingleFace(canvas as any, options);

                    self.postMessage({
                        type: 'detect',
                        status: 'success',
                        detection: detection ? {
                            x: detection.box.x,
                            y: detection.box.y,
                            width: detection.box.width,
                            height: detection.box.height
                        } : null,
                        fallbackMode: !detection
                    });
                } catch (detectionError) {
                    console.error('Face detection error:', detectionError);
                    self.postMessage({
                        type: 'detect',
                        status: 'error',
                        error: detectionError instanceof Error ? detectionError.message : 'Unknown detection error'
                    });
                }
                break;
        }
    } catch (error) {
        console.error('Face detection worker global error:', error);
        self.postMessage({
            type: e.data.type,
            status: 'error',
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};