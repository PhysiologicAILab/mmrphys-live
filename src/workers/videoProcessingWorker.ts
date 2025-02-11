// src/workers/videoProcessingWorker.ts

let isInitialized = false;

interface VideoProcessMessage {
    type: 'process';
    imageData: ImageData;
    faceBox?: {
        x: number;
        y: number;
        width: number;
        height: number;
    } | null;
}

self.onmessage = (e: MessageEvent<VideoProcessMessage>) => {
    if (e.data.type === 'init') {
        isInitialized = true;
        self.postMessage({ type: 'init', status: 'success' });
        return;
    }

    if (e.data.type === 'process') {
        if (!isInitialized) {
            self.postMessage({
                type: 'process',
                status: 'error',
                error: 'Worker not initialized'
            });
            return;
        }

        try {
            const { imageData, faceBox } = e.data;
            const processedData = processVideoFrame(imageData, faceBox);

            self.postMessage({
                type: 'process',
                status: 'success',
                processedData
            }, [processedData.data.buffer]);
        } catch (error) {
            self.postMessage({
                type: 'process',
                status: 'error',
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }
};



function processVideoFrame(imageData: ImageData, faceBox: any): ImageData {
    const canvas = new OffscreenCanvas(9, 9);
    const ctx = canvas.getContext('2d')!;

    // Process frame to 9x9 for rPhys
    if (faceBox) {
        ctx.drawImage(
            imageData as unknown as HTMLCanvasElement,
            faceBox.x,
            faceBox.y,
            faceBox.width,
            faceBox.height,
            0,
            0,
            9,
            9
        );
    } else {
        // Use center crop
        const size = Math.min(imageData.width, imageData.height);
        const x = (imageData.width - size) / 2;
        const y = (imageData.height - size) / 2;

        ctx.drawImage(
            imageData as unknown as HTMLCanvasElement,
            x,
            y,
            size,
            size,
            0,
            0,
            9,
            9
        );
    }

    return ctx.getImageData(0, 0, 9, 9);
}