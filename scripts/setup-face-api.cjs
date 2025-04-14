const fs = require('fs');
const path = require('path');
const https = require('https');

// Configuration
const MODELS_DIR = path.join(process.cwd(), 'public', 'models', 'face-api');
const MODEL_FILES = {
    manifest: {
        filename: 'tiny_face_detector_model-weights_manifest.json',
        // url: 'https://justadudewhohacks.github.io/face-api.js/models/tiny_face_detector_model-weights_manifest.json'
        url: 'https://cdn.jsdelivr.net/gh/jnj256/rphys-assets@main/models/face-api/tiny_face_detector_model-weights_manifest.json'
    },
    shard: {
        filename: 'tiny_face_detector_model-shard1',
        // url: 'https://justadudewhohacks.github.io/face-api.js/models/tiny_face_detector_model-shard1'
        url: 'https://cdn.jsdelivr.net/gh/jnj256/rphys-assets@main/models/face-api/tiny_face_detector_model-shard1'
    }
};

// Utility function to download a file
async function downloadFile(url, destPath) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(destPath);

        const request = https.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        }, (response) => {
            if (response.statusCode === 302 || response.statusCode === 301) {
                file.close();
                fs.unlinkSync(destPath);
                downloadFile(response.headers.location, destPath)
                    .then(resolve)
                    .catch(reject);
                return;
            }

            if (response.statusCode !== 200) {
                file.close();
                fs.unlinkSync(destPath);
                reject(new Error(`Failed to download: ${response.statusCode}`));
                return;
            }

            response.pipe(file);
        });

        file.on('finish', () => {
            file.close();
            resolve();
        });

        request.on('error', (err) => {
            fs.unlink(destPath, () => reject(err));
        });

        // Set a timeout of 30 seconds
        request.setTimeout(30000, () => {
            request.destroy();
            fs.unlink(destPath, () => reject(new Error('Request timeout')));
        });
    });
}

// Function to verify model files
function verifyModelFiles() {
    try {
        const manifestPath = path.join(MODELS_DIR, MODEL_FILES.manifest.filename);
        const shardPath = path.join(MODELS_DIR, MODEL_FILES.shard.filename);

        // Check if files exist
        if (!fs.existsSync(manifestPath) || !fs.existsSync(shardPath)) {
            console.log('Model files missing');
            return false;
        }

        // Verify manifest content
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        if (!Array.isArray(manifest) || manifest.length === 0 ||
            !manifest[0].weights || !manifest[0].paths) {
            console.log('Invalid manifest structure');
            return false;
        }

        // Verify shard file exists and has content
        const shardStats = fs.statSync(shardPath);
        if (shardStats.size === 0) {
            console.log('Empty shard file');
            return false;
        }

        return true;
    } catch (error) {
        console.error('Verification failed:', error.message);
        return false;
    }
}

// Function to download model files
async function downloadModelFiles() {
    console.log('Downloading model files...');

    try {
        // Create directory if it doesn't exist
        if (!fs.existsSync(MODELS_DIR)) {
            fs.mkdirSync(MODELS_DIR, { recursive: true });
        }

        // Download manifest
        console.log(`Downloading manifest from ${MODEL_FILES.manifest.url}`);
        await downloadFile(
            MODEL_FILES.manifest.url,
            path.join(MODELS_DIR, MODEL_FILES.manifest.filename)
        );
        console.log('Manifest downloaded successfully');

        // Download shard
        console.log(`Downloading model shard from ${MODEL_FILES.shard.url}`);
        await downloadFile(
            MODEL_FILES.shard.url,
            path.join(MODELS_DIR, MODEL_FILES.shard.filename)
        );
        console.log('Model shard downloaded successfully');

        return true;
    } catch (error) {
        console.error('Download failed:', error.message);
        // Clean up any partially downloaded files
        const manifestPath = path.join(MODELS_DIR, MODEL_FILES.manifest.filename);
        const shardPath = path.join(MODELS_DIR, MODEL_FILES.shard.filename);

        if (fs.existsSync(manifestPath)) {
            fs.unlinkSync(manifestPath);
        }
        if (fs.existsSync(shardPath)) {
            fs.unlinkSync(shardPath);
        }
        return false;
    }
}

// Main setup function
async function setup() {
    try {
        // Check if valid files already exist
        if (verifyModelFiles()) {
            console.log('Valid model files already exist');
            return;
        }

        // Try downloading
        console.log('Attempting to download model files...');
        const downloadSuccess = await downloadModelFiles();

        // Verify after download
        if (downloadSuccess && verifyModelFiles()) {
            console.log('Setup completed successfully');
        } else {
            throw new Error('Failed to download or verify model files');
        }

    } catch (error) {
        console.error('Setup failed:', error);
        process.exit(1);
    }
}

// Run setup
setup();