const fs = require('fs');
const path = require('path');

function copyWasmFiles() {
    const ortPath = path.resolve('./node_modules/onnxruntime-web/dist');
    const publicPath = path.resolve('./public/ort');

    // Create directory if it doesn't exist
    if (!fs.existsSync(publicPath)) {
        fs.mkdirSync(publicPath, { recursive: true });
    }

    // List all files in the source directory
    console.log('Checking directory:', ortPath);
    const sourceFiles = fs.readdirSync(ortPath);
    console.log('Available files:', sourceFiles);

    // Find and copy all WASM files
    const wasmFiles = sourceFiles.filter(file => file.endsWith('.wasm'));

    if (wasmFiles.length === 0) {
        console.error('No WASM files found in onnxruntime-web package');
        process.exit(1);
    }

    wasmFiles.forEach(file => {
        const src = path.join(ortPath, file);
        const dest = path.join(publicPath, file);

        try {
            fs.copyFileSync(src, dest);
            console.log(`Copied ${file} to public/ort/`);

            // Also copy any associated .js files
            const jsFile = file.replace('.wasm', '.js');
            const jsSrc = path.join(ortPath, jsFile);
            if (fs.existsSync(jsSrc)) {
                const jsDest = path.join(publicPath, jsFile);
                fs.copyFileSync(jsSrc, jsDest);
                console.log(`Copied ${jsFile} to public/ort/`);
            }
        } catch (error) {
            console.error(`Error copying ${file}:`, error);
        }
    });

    // Update the wasm paths configuration
    const wasmPathsConfig = wasmFiles.reduce((acc, file) => {
        acc[file] = `/ort/${file}`;
        return acc;
    }, {});

    // Write wasm paths configuration to a file
    const configPath = path.join(publicPath, 'wasm-paths.json');
    fs.writeFileSync(configPath, JSON.stringify(wasmPathsConfig, null, 2));
    console.log('Generated wasm-paths.json configuration');
}

// Execute the copy
try {
    copyWasmFiles();
    console.log('WASM files copied successfully');
} catch (error) {
    console.error('Error copying WASM files:', error);
    process.exit(1);
}