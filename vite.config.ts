import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
    plugins: [react()],

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
        include: ['face-api.js', 'chart.js', 'onnxruntime-web', 'react-chartjs-2']
    },

    server: {
        port: 3000,
        cors: true,
        headers: {
            'Cross-Origin-Embedder-Policy': 'require-corp',
            'Cross-Origin-Opener-Policy': 'same-origin'
        }
    }
});