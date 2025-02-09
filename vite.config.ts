import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';

// Function to copy ONNX Runtime WASM files
function copyOrtWasmFiles() {
    return {
        name: 'copy-ort-wasm',
        buildStart() {
            const ortPath = path.resolve('./node_modules/onnxruntime-web/dist');
            const publicPath = path.resolve('./public');

            const wasmFiles = [
                'ort-wasm.wasm',
                'ort-wasm-simd.wasm',
                'ort-wasm-threaded.wasm',
                'ort-wasm-simd-threaded.wasm'
            ];

            // Create ort directory if it doesn't exist
            const ortDir = path.join(publicPath, 'ort');
            if (!fs.existsSync(ortDir)) {
                fs.mkdirSync(ortDir, { recursive: true });
            }

            // Copy WASM files
            wasmFiles.forEach(file => {
                const src = path.join(ortPath, file);
                const dest = path.join(ortDir, file);
                if (fs.existsSync(src)) {
                    fs.copyFileSync(src, dest);
                    console.log(`Copied ${file} to public/ort/`);
                }
            });
        }
    };
}

export default defineConfig({
    plugins: [
        react(),
        copyOrtWasmFiles()
    ],
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src')
        }
    },
    build: {
        target: 'esnext',
        outDir: 'dist',
        assetsDir: 'assets',
        sourcemap: true,
        rollupOptions: {
            output: {
                manualChunks: {
                    'face-api': ['face-api.js'],
                    'onnx': ['onnxruntime-web'],
                    'chart': ['chart.js', 'react-chartjs-2']
                }
            }
        }
    },
    worker: {
        format: 'es',
        plugins: []
    },
    optimizeDeps: {
        exclude: ['onnxruntime-web']
    },
    server: {
        port: 3000,
        headers: {
            'Cross-Origin-Embedder-Policy': 'require-corp',
            'Cross-Origin-Opener-Policy': 'same-origin',
            'Cross-Origin-Resource-Policy': 'same-site',
            'Cross-Origin-Isolation': 'require-corp'  // Added for SharedArrayBuffer support
        },
        allowedHosts: true,
        middleware: [
            (req, res, next) => {
                if (req.url?.endsWith('.wasm')) {
                    res.setHeader('Content-Type', 'application/wasm');
                    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
                    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
                }
                next();
            }
        ]
    }
});