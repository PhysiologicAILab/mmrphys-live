import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import type { Plugin } from 'vite';

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
    return process.env.GITHUB_PAGES === 'true' ? '' : '/';
}

export default defineConfig({
    base: getGitHubPagesBase(),
    plugins: [
        react(),
        wasmContentTypePlugin()
    ],
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src')
        }
    },
    build: {
        outDir: 'dist',
        assetsDir: 'assets',
        sourcemap: true,
        rollupOptions: {
            output: {
                assetFileNames: (assetInfo) => {
                    // Preserve paths for model-specific files
                    if (/\.(wasm|onnx|json|model)$/.test(assetInfo.name || '')) {
                        return `${assetInfo.name}`;
                    }
                    return 'assets/[name]-[hash][extname]';
                },
                chunkFileNames: 'assets/[name]-[hash].js',
                entryFileNames: 'assets/[name]-[hash].js',
            }
        }
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