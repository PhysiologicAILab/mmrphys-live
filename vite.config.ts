import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';

// Function to copy ONNX Runtime WASM files
function copyOrtWasmFiles() {
    return {
        name: 'copy-ort-wasm',
        buildStart() {
            // Get absolute paths
            const ortPath = path.resolve(__dirname, 'node_modules/onnxruntime-web/dist');
            const publicPath = path.resolve(__dirname, 'public/ort');

            // Ensure target directory exists
            if (!fs.existsSync(publicPath)) {
                fs.mkdirSync(publicPath, { recursive: true });
            }

            const wasmFiles = [
                'ort-wasm.wasm',
                'ort-wasm-simd.wasm',
                'ort-wasm-threaded.wasm',
                'ort-wasm-simd-threaded.wasm'
            ];

            // Copy files and log each operation
            wasmFiles.forEach(file => {
                const src = path.join(ortPath, file);
                const dest = path.join(publicPath, file);

                try {
                    if (fs.existsSync(src)) {
                        fs.copyFileSync(src, dest);
                        console.log(`✓ Copied ${file} to ${dest}`);
                    } else {
                        // Try alternate path for newer versions of onnxruntime-web
                        const altSrc = path.join(ortPath, '..', 'lib', file);
                        if (fs.existsSync(altSrc)) {
                            fs.copyFileSync(altSrc, dest);
                            console.log(`✓ Copied ${file} from alternate path to ${dest}`);
                        } else {
                            console.warn(`⚠ Source file not found: ${src} or ${altSrc}`);
                        }
                    }
                } catch (error) {
                    console.error(`Error copying ${file}:`, error);
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
        plugins: [],
        rollupOptions: {
            output: {
                format: 'es',
                chunkFileNames: 'assets/worker-[hash].js'
            }
        },
        tsconfigFilePath: './tsconfig.worker.json',
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
            'Cross-Origin-Isolation': 'require-corp'
        },
        allowedHosts: true,
        middlewares: [
            (req, res, next) => {
                if (req.url?.endsWith('.wasm')) {
                    res.setHeader('Content-Type', 'application/wasm');
                    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
                    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
                }
                next();
            }
        ],
        proxy: {
            '/ort': {
                target: 'http://localhost:3000',
                changeOrigin: true,
                secure: false,
                ws: true
            }
        }
    }
});