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
    targetWidth?: number;
    targetHeight?: number;
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
async function processVideoFrame(imageData: ImageData, faceBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
} | null, targetWidth: number = 9, targetHeight: number = 9): Promise<ImageData> {
    // Create an offscreen canvas for processing
    const canvas = new OffscreenCanvas(targetWidth, targetHeight);
    const ctx = canvas.getContext('2d');

    if (!ctx) {
        throw new Error('Failed to get 2D rendering context');
    }

    try {
        // Process frame to target resolution
        if (faceBox && faceBox.width > 0 && faceBox.height > 0) {
            // Use face box for cropping - await the bitmap creation
            const bitmap = await createImageBitmap(imageData,
                faceBox.x,
                faceBox.y,
                faceBox.width,
                faceBox.height
            );

            ctx.drawImage(
                bitmap,
                0,
                0,
                targetWidth,
                targetHeight
            );

            // Clean up bitmap after use
            bitmap.close();
        } else {
            // Use center crop
            const size = Math.min(imageData.width, imageData.height);
            const x = Math.floor((imageData.width - size) / 2);
            const y = Math.floor((imageData.height - size) / 2);

            // Create and await the bitmap
            const bitmap = await createImageBitmap(imageData,
                x,
                y,
                size,
                size
            );

            ctx.drawImage(
                bitmap,
                0,
                0,
                targetWidth,
                targetHeight
            );

            // Clean up bitmap after use
            bitmap.close();
        }

        // Return processed image data
        return ctx.getImageData(0, 0, targetWidth, targetHeight);
    } catch (error) {
        console.error('Error processing frame:', error);
        // Return a blank image on error
        return new ImageData(targetWidth, targetHeight);
    }
}

// Message event handler
self.onmessage = async (e: MessageEvent) => {
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

                // Get target dimensions from message if provided
                const targetWidth = e.data.targetWidth || 9;
                const targetHeight = e.data.targetHeight || 9;

                try {
                    // Process the video frame and await the result
                    const processedData = await processVideoFrame(
                        e.data.imageData,
                        e.data.faceBox,
                        targetWidth,
                        targetHeight
                    );

                    // Send processed data back to main thread
                    self.postMessage({
                        type: 'process',
                        status: 'success',
                        processedData
                    }, [processedData.data.buffer]);
                } catch (processError) {
                    self.postMessage({
                        type: 'process',
                        status: 'error',
                        error: processError instanceof Error ? processError.message : 'Frame processing failed'
                    });
                }
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