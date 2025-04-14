// src/utils/paths.ts

// Define ModelPathConfig interface locally
interface ModelPathConfig {
    MODELS_REPO: string;
    MODELS_VERSION: string;
    CDN_BASE: string;
}

class PathManager {
    private static instance: PathManager;
    private readonly CDN_CONFIG: ModelPathConfig = {
        MODELS_REPO: 'jnj256/rphys-assets',
        MODELS_VERSION: 'main',
        CDN_BASE: 'https://cdn.jsdelivr.net/gh'
    };
    private readonly cache: Map<string, string> = new Map();

    public static getInstance(): PathManager {
        if (!PathManager.instance) {
            PathManager.instance = new PathManager();
        }
        return PathManager.instance;
    }

    private getBaseUrl(): string {
        // First, check if we're in a browser environment
        console.log('self:', self);
        console.log('self.location:', self.location);
        console.log('globalThis:', globalThis);

        if (typeof self !== 'undefined' && self.location) {
            // Use self for web workers
            const isLocal = self.location.hostname.includes('localhost');

            if (isLocal) {
                return '/';
            }
        }
        const { CDN_BASE, MODELS_REPO, MODELS_VERSION } = this.CDN_CONFIG;
        return `${CDN_BASE}/${MODELS_REPO}@${MODELS_VERSION}/`;
    }

    public getModelUrl(path: string): string {
        try {
            // Ensure path starts without a leading slash
            const cleanPath = path.replace(/^\//, '');

            // Determine base URL
            let baseUrl = this.getBaseUrl();

            // Special handling for CDN
            if (baseUrl.startsWith('https://cdn.jsdelivr.net/gh')) {
                const finalUrl = `${baseUrl}${cleanPath}`;
                return finalUrl;
            }

            // For local and other environments
            const finalUrl = `${baseUrl}${cleanPath}`;
            return finalUrl;
        } catch (error) {
            console.warn('URL generation error:', error);
            return path; // Fallback to original path
        }
    }

    public getRequiredModelUrls(): string[] {
        return [
            this.getModelUrl('models/face-api/tiny_face_detector_model-shard1'),
            this.getModelUrl('models/face-api/tiny_face_detector_model-weights_manifest.json'),
            this.getModelUrl('models/rphys/config.json'),
            this.getModelUrl('models/rphys/SCAMPS_Multi_72x72.onnx'),
            this.getModelUrl('ort/ort-wasm.wasm'),
            this.getModelUrl('ort/ort-wasm-simd.wasm'),
            this.getModelUrl('ort/ort-wasm-threaded.wasm'),
            this.getModelUrl('ort/ort-wasm-simd-threaded.wasm')
        ];
    }

    public async verifyModelUrls(timeout: number = 5000): Promise<boolean> {
        try {
            // Check if window is available
            if (typeof window === 'undefined') {
                return true; // Skip verification in non-browser environments
            }

            const urls = this.getRequiredModelUrls();
            const fetchPromises = urls.map(url =>
                Promise.race([
                    fetch(url, {
                        method: 'HEAD',
                        cache: 'no-cache',
                        credentials: 'same-origin'
                    }),
                    new Promise<Response>((_, reject) =>
                        setTimeout(() => reject(new Error('Timeout')), timeout)
                    )
                ])
            );

            const responses = await Promise.all(fetchPromises);
            const results = responses.map(response => response.ok);

            if (process.env.NODE_ENV === 'development') {
                console.log('URL Verification Results:',
                    urls.map((url, index) => `${url}: ${results[index]}`)
                );
            }

            return results.every(Boolean);
        } catch (error) {
            console.warn('Model URL verification failed:', error);
            return false;
        }
    }
}

// Initialize and export
export const Paths = {
    getModelUrl: (path: string) => PathManager.getInstance().getModelUrl(path),
    verifyModelUrls: () => PathManager.getInstance().verifyModelUrls(),
    getRequiredModelUrls: () => PathManager.getInstance().getRequiredModelUrls()
};

// Export helper functions
export function getModelPath(modelFile: string): string {
    return Paths.getModelUrl(`models/${modelFile}`);
}

export function getOrtPath(wasmFile: string): string {
    return Paths.getModelUrl(`ort/${wasmFile}`);
}

// Specific application paths
export const ApplicationPaths = {
    faceApiModel: () => Paths.getModelUrl('models/face-api/'),
    rphysConfig: () => Paths.getModelUrl('models/rphys/config.json'),
    rphysModel: () => Paths.getModelUrl('models/rphys/SCAMPS_Multi_72x72.onnx'),
    ortWasm: (file: string) => Paths.getModelUrl(`ort/${file}`),
    getRequiredPaths: () => Paths.getRequiredModelUrls()
};