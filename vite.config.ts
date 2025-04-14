import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';
import type { Plugin } from 'vite';

function copyOrtWasmFiles(): Plugin {
    return {
        name: 'copy-ort-wasm',
        buildStart() {
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

            // Copy files from ONNX Runtime Web package
            wasmFiles.forEach(file => {
                const src = path.join(ortPath, file);
                const dest = path.join(publicPath, file);

                if (fs.existsSync(src)) {
                    fs.copyFileSync(src, dest);
                    console.log(`✓ Copied ${file} to public/ort/`);
                } else {
                    console.warn(`⚠ Source file not found: ${file}`);
                }
            });
        }
    };
}

function wasmContentTypePlugin(): Plugin {
    return {
        name: 'wasm-content-type',
        configureServer(server) {
            server.middlewares.use((req, res, next) => {
                if (req.url?.endsWith('.wasm')) {
                    res.setHeader('Content-Type', 'application/wasm');
                }
                next();
            });
        }
    };
}

// Determine base path dynamically
function getGitHubPagesBase() {
    // For GitHub Pages, use an empty string when deploying to CDN
    return process.env.GITHUB_PAGES === 'true' ? '' : '/mmrphys-live/';
}

export default defineConfig({
    base: getGitHubPagesBase(),
    plugins: [
        react(),
        copyOrtWasmFiles(),
        wasmContentTypePlugin()
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
        sourcemap: true
    },
    optimizeDeps: {
        exclude: ['onnxruntime-web']
    },
    server: {
        headers: {
            'Cross-Origin-Embedder-Policy': 'require-corp',
            'Cross-Origin-Opener-Policy': 'same-origin'
        },
        allowedHosts: true
    }
});