const fs = require('fs');
const path = require('path');
const https = require('https');

const MODELS_DIR = path.join(__dirname, '../public/models/face-api');

// Create models directory if it doesn't exist
if (!fs.existsSync(MODELS_DIR)) {
    fs.mkdirSync(MODELS_DIR, { recursive: true });
}

// URLs for the model files
const MODEL_FILES = {
    manifest: {
        url: 'https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights/tiny_face_detector_model-weights_manifest.json',
        filename: 'tiny_face_detector_model-weights_manifest.json'
    },
    weights: {
        url: 'https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights/tiny_face_detector_model-shard1',
        filename: 'tiny_face_detector_model-shard1'
    }
};

// Download function
function downloadFile(url, filename) {
    return new Promise((resolve, reject) => {
        const filepath = path.join(MODELS_DIR, filename);
        const file = fs.createWriteStream(filepath);

        https.get(url, response => {
            if (response.statusCode !== 200) {
                reject(new Error(`Failed to download ${filename}: ${response.statusCode}`));
                return;
            }

            response.pipe(file);

            file.on('finish', () => {
                file.close();
                console.log(`Downloaded ${filename}`);
                resolve();
            });
        }).on('error', err => {
            fs.unlink(filepath, () => { });
            reject(err);
        });
    });
}

// Download all model files
async function downloadModels() {
    try {
        console.log('Downloading face-api.js model files...');

        // Download manifest first
        await downloadFile(MODEL_FILES.manifest.url, MODEL_FILES.manifest.filename);

        // Then download weights
        await downloadFile(MODEL_FILES.weights.url, MODEL_FILES.weights.filename);

        console.log('Model files downloaded successfully!');
    } catch (error) {
        console.error('Error downloading model files:', error);
        process.exit(1);
    }
}

// Run the download
downloadModels();