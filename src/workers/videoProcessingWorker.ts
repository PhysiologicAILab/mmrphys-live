// src/workers/videoProcessingWorker.ts

/// <reference lib="webworker" />

let isInitialized = false;

interface InitMessage {
    type: 'init';
}

interface ProcessMessage {
    type: 'process';
    imageData: ImageData;
    faceBox?: {
        x: number;
        y: number;
        width: number;
        height: number;
    } | null;
}

type WorkerMessage = InitMessage | ProcessMessage;

interface InitResponse {
    type: 'init';
    status: 'success';
}

interface ProcessResponse {
    type: 'process';
    status: 'success' | 'error';
    processedData?: ImageData;
    error?: string;
}

type WorkerResponse = InitResponse | ProcessResponse;

// Declare the self with the correct type
declare const self: DedicatedWorkerGlobalScope;

// Process video frame to 9x9 resolution
function processVideoFrame(imageData: ImageData, faceBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
} | null): ImageData {
    // Create an offscreen canvas for processing
    const canvas = new OffscreenCanvas(9, 9);
    const ctx = canvas.getContext('2d');

    if (!ctx) {
        throw new Error('Failed to get 2D rendering context');
    }

    // Process frame to 9x9 for rPhys
    if (faceBox && faceBox.width > 0 && faceBox.height > 0) {
        // Use face box for cropping
        ctx.drawImage(
            createImageBitmap(imageData, {
                sx: faceBox.x,
                sy: faceBox.y,
                sw: faceBox.width,
                sh: faceBox.height
            }),
            0,
            0,
            9,
            9
        );
    } else {
        // Use center crop
        const size = Math.min(imageData.width, imageData.height);
        const x = Math.floor((imageData.width - size) / 2);
        const y = Math.floor((imageData.height - size) / 2);

        ctx.drawImage(
            createImageBitmap(imageData, {
                sx: x,
                sy: y,
                sw: size,
                sh: size
            }),
            0,
            0,
            9,
            9
        );
    }

    // Return processed image data
    return ctx.getImageData(0, 0, 9, 9);
}

// Message event handler
self.onmessage = async (e: MessageEvent<WorkerMessage>) => {
    try {
        switch (e.data.type) {
            case 'init':
                // Initialize the worker
                isInitialized = true;
                self.postMessage({
                    type: 'init',
                    status: 'success'
                });
                break;

            case 'process':
                // Validate initialization
                if (!isInitialized) {
                    throw new Error('Worker not initialized');
                }

                // Process the video frame
                const processedData = await processVideoFrame(
                    e.data.imageData,
                    e.data.faceBox
                );

                // Send processed data back to main thread
                self.postMessage({
                    type: 'process',
                    status: 'success',
                    processedData
                }, [processedData.data.buffer]);
                break;

            default:
                throw new Error('Unknown message type');
        }
    } catch (error) {
        // Handle any errors during processing
        self.postMessage({
            type: 'process',
            status: 'error',
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};

// Export to prevent TypeScript compilation errors
export { };