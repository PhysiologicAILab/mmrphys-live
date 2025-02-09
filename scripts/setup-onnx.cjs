const fs = require('fs');
const path = require('path');

async function setupOnnxRuntime() {
    try {
        const nodeModulesPath = path.resolve('./node_modules');
        const ortPath = path.join(nodeModulesPath, 'onnxruntime-web');
        const publicPath = path.resolve('./public');
        const ortPublicPath = path.join(publicPath, 'ort');

        // Create ort directory if it doesn't exist
        if (!fs.existsSync(ortPublicPath)) {
            fs.mkdirSync(ortPublicPath, { recursive: true });
        }

        // Define all possible paths where WASM files might be located
        const searchPaths = [
            path.join(ortPath, 'dist'),
            path.join(ortPath, 'lib'),
            path.join(ortPath, 'node')
        ];

        const wasmFiles = [
            { name: 'ort-wasm.wasm', js: true },
            { name: 'ort-wasm-simd.wasm', js: true },
            { name: 'ort-wasm-threaded.wasm', js: true },
            { name: 'ort-wasm-simd-threaded.wasm', js: true }
        ];

        // Search for and copy WASM files
        for (const wasmFile of wasmFiles) {
            let found = false;
            for (const searchPath of searchPaths) {
                const srcPath = path.join(searchPath, wasmFile.name);
                if (fs.existsSync(srcPath)) {
                    // Copy WASM file
                    const destPath = path.join(ortPublicPath, wasmFile.name);
                    fs.copyFileSync(srcPath, destPath);
                    console.log(`Copied ${wasmFile.name} to public/ort/`);

                    // Copy corresponding JS file if it exists
                    if (wasmFile.js) {
                        const jsSrcPath = srcPath.replace('.wasm', '.js');
                        if (fs.existsSync(jsSrcPath)) {
                            const jsDestPath = destPath.replace('.wasm', '.js');
                            fs.copyFileSync(jsSrcPath, jsDestPath);
                            console.log(`Copied ${wasmFile.name.replace('.wasm', '.js')} to public/ort/`);
                        }
                    }
                    found = true;
                    break;
                }
            }
            if (!found) {
                console.warn(`Warning: ${wasmFile.name} not found in any search path`);
            }
        }

        // List all files in onnxruntime-web to help with debugging
        console.log('\nListing contents of onnxruntime-web package:');
        searchPaths.forEach(searchPath => {
            if (fs.existsSync(searchPath)) {
                console.log(`\nContents of ${searchPath}:`);
                fs.readdirSync(searchPath).forEach(file => {
                    console.log(`  ${file}`);
                });
            }
        });

    } catch (error) {
        console.error('Error setting up ONNX Runtime:', error);
        process.exit(1);
    }
}

setupOnnxRuntime();