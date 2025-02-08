// src/workers/inferenceWorker.js
import { VitalSignsModel } from '../js/modelInference.js';

let model = null;

self.onmessage = async function (e) {
    const { type, data } = e.data;

    switch (type) {
        case 'init':
            try {
                model = new VitalSignsModel();
                await model.initialize();
                self.postMessage({ type: 'init', status: 'success' });
            } catch (error) {
                self.postMessage({ type: 'init', status: 'error', error: error.message });
            }
            break;

        case 'inference':
            try {
                if (!model) {
                    throw new Error('Model not initialized');
                }
                const results = await model.inference(data.frameBuffer);
                self.postMessage({ type: 'inference', status: 'success', results });
            } catch (error) {
                self.postMessage({ type: 'inference', status: 'error', error: error.message });
            }
            break;
    }
};