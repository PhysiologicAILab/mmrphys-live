const fs = require('fs');
const path = require('path');

function setupOnnxRuntime() {
    const ortPath = path.resolve('./node_modules/onnxruntime-web/dist');
    const publicPath = path.resolve('./public');
    const ortPublicPath = path.join(publicPath, 'ort');

    // Create public/ort directory if it doesn't exist
    if (!fs.existsSync(ortPublicPath)) {
        fs.mkdirSync(ortPublicPath, { recursive: true });
    }

    // List of required WASM files
    const wasmFiles = [
        'ort-wasm.wasm',
        'ort-wasm-simd.wasm',
        'ort-wasm-threaded.wasm',
        'ort-wasm-simd-threaded.wasm'
    ];

    // Copy each WASM file
    wasmFiles.forEach(file => {
        const srcPath = path.join(ortPath, file);
        const destPath = path.join(ortPublicPath, file);

        if (fs.existsSync(srcPath)) {
            fs.copyFileSync(srcPath, destPath);
            console.log(`Copied ${file} to public/ort/`);
        } else {
            console.warn(`Warning: ${file} not found in onnxruntime-web package`);
        }
    });

    // Verify files were copied successfully
    const copiedFiles = fs.readdirSync(ortPublicPath);
    console.log('\nVerifying copied files:');
    wasmFiles.forEach(file => {
        const exists = copiedFiles.includes(file);
        console.log(`${file}: ${exists ? '✓' : '✗'}`);

        if (!exists) {
            console.error(`Error: ${file} was not copied successfully`);
            process.exit(1);
        }
    });

    console.log('\nONNX Runtime setup completed successfully');
}

try {
    setupOnnxRuntime();
} catch (error) {
    console.error('Error setting up ONNX Runtime:', error);
    process.exit(1);
}