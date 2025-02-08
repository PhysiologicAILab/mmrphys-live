const https = require('https');
const fs = require('fs');
const path = require('path');

const models = [
    {
        url: 'https://raw.githubusercontent.com/vladmandic/face-api/master/weights/tiny_face_detector_model-weights_manifest.json',
        filename: 'tiny_face_detector_model-weights_manifest.json'
    },
    {
        url: 'https://raw.githubusercontent.com/vladmandic/face-api/master/weights/tiny_face_detector_model.weights',
        filename: 'tiny_face_detector_model.weights'
    }
];

const modelDir = path.join(__dirname, '..', 'src', 'models', 'face-api');

// Create directory if it doesn't exist
if (!fs.existsSync(modelDir)) {
    fs.mkdirSync(modelDir, { recursive: true });
}

models.forEach(model => {
    const filePath = path.join(modelDir, model.filename);
    const file = fs.createWriteStream(filePath);

    https.get(model.url, response => {
        response.pipe(file);
        file.on('finish', () => {
            file.close();
            console.log(`Downloaded ${model.filename}`);
        });
    }).on('error', err => {
        fs.unlink(filePath);
        console.error(`Error downloading ${model.filename}:`, err.message);
    });
});