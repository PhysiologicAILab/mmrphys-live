const fs = require('fs');
const path = require('path');

// Configuration
const ORT_VERSION = '1.14.0';
const WASM_FILES = [
    'ort-wasm.wasm',
    'ort-wasm-simd.wasm',
    'ort-wasm-threaded.wasm'
];

// Paths
const ORT_PATH = path.join(process.cwd(), 'node_modules', 'onnxruntime-web', 'dist');
const PUBLIC_PATH = path.join(process.cwd(), 'public', 'ort');

// Ensure target directory exists
if (!fs.existsSync(PUBLIC_PATH)) {
    fs.mkdirSync(PUBLIC_PATH, { recursive: true });
}

// Copy WASM files
WASM_FILES.forEach(file => {
    const src = path.join(ORT_PATH, file);
    const dest = path.join(PUBLIC_PATH, file);

    if (fs.existsSync(src)) {
        fs.copyFileSync(src, dest);
        console.log(`✓ Copied ${file} to ${dest}`);
    } else {
        console.warn(`⚠ Source file not found: ${src}`);
    }
});