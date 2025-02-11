// src/workers/faceDetectionWorker.ts
/// <reference lib="webworker" />

import * as faceapi from 'face-api.js';

interface DetectionResponse {
    type: 'detect';
    status: 'success' | 'error' | 'fallback';
    detection?: {
        x: number;
        y: number;
        width: number;
        height: number;
    } | null;
    fallbackMode?: boolean;
    error?: string;
}

let isInitialized = false;
let model: faceapi.TinyFaceDetectorOptions;

async function initializeDetector() {
    try {
        // Configure environment
        const env = {
            Canvas: typeof OffscreenCanvas !== 'undefined' ? OffscreenCanvas : HTMLCanvasElement,
            Image: typeof Image !== 'undefined' ? Image : class { },
            ImageData: ImageData,
            createCanvasElement: () => new OffscreenCanvas(1, 1),
            createImageElement: () => ({ width: 0, height: 0 }),
        };

        // @ts-ignore - Patch environment
        if (!faceapi.env) faceapi.env = {};
        Object.assign(faceapi.env, env);

        // Load model
        await faceapi.nets.tinyFaceDetector.load('/models/face-api');

        // Initialize detector options
        model = new faceapi.TinyFaceDetectorOptions({
            inputSize: 320,
            scoreThreshold: 0.3
        });

        isInitialized = true;
        self.postMessage({ type: 'init', status: 'success' });
    } catch (error) {
        self.postMessage({
            type: 'init',
            status: 'error',
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
}

async function detectFace(imageData: ImageData): Promise<DetectionResponse> {
    if (!isInitialized) {
        return {
            type: 'detect',
            status: 'error',
            error: 'Face detector not initialized'
        };
    }

    try {
        // Create canvas and draw image
        const canvas = new OffscreenCanvas(imageData.width, imageData.height);
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Failed to get canvas context');

        ctx.putImageData(imageData, 0, 0);

        // Detect face
        const detection = await faceapi.detectSingleFace(canvas as any, model);

        if (detection) {
            return {
                type: 'detect',
                status: 'success',
                detection: {
                    x: detection.box.x,
                    y: detection.box.y,
                    width: detection.box.width,
                    height: detection.box.height
                }
            };
        }

        // Return fallback mode if no face detected
        return {
            type: 'detect',
            status: 'fallback',
            detection: null,
            fallbackMode: true
        };
    } catch (error) {
        return {
            type: 'detect',
            status: 'error',
            error: error instanceof Error ? error.message : 'Detection failed'
        };
    }
}

// Message handler
self.onmessage = async (e: MessageEvent) => {
    switch (e.data.type) {
        case 'init':
            await initializeDetector();
            break;

        case 'detect':
            if (!e.data.imageData) {
                self.postMessage({
                    type: 'detect',
                    status: 'error',
                    error: 'No image data provided'
                });
                return;
            }

            const response = await detectFace(e.data.imageData);
            self.postMessage(response);
            break;

        default:
            self.postMessage({
                type: 'error',
                status: 'error',
                error: 'Unknown message type'
            });
    }
};