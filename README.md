# mmrphys.github.io
Real Time Remote Physiological Sensing

# Video-based Vital Signs Monitor

A web application that monitors vital signs (heart rate and respiratory rate) using facial video analysis.

## Features

- Real-time video capture and face detection
- Blood Volume Pulse (BVP) and respiratory signal extraction
- Heart rate and respiratory rate estimation
- Real-time signal visualization
- Data export functionality
- Cross-platform compatibility (PC and mobile browsers)

## Prerequisites

- Node.js (v14 or higher)
- npm (v6 or higher)
- Modern web browser with camera access

## Installation

1. Clone the repository:

```bash
git clone <repository-url>
cd video-vital-signs
```

2. Install dependencies:

```bash
npm install
```

3. Place your PyTorch model in the appropriate directory:

```bash
src/models/vital-signs/model.onnx
src/models/vital-signs/config.json
```

4. Download face-api.js models:

```bash
mkdir -p src/models/face-api
# Download tiny face detector model files from face-api.js repository
```

## Development

Start the development server:

```bash
npm run dev
```

## Building for Production

Build the application:

```bash
npm run build
```

Preview the production build:

```bash
npm run preview
```

## Project Structure

```
project-root/
├── src/
│   ├── index.html
│   ├── styles/
│   │   └── main.css
│   ├── js/
│   │   ├── app.js
│   │   ├── videoProcessor.js
│   │   ├── faceDetector.js
│   │   ├── signalProcessor.js
│   │   ├── modelInference.js
│   │   └── charts.js
│   ├── models/
│   │   ├── face-api/
│   │   └── vital-signs/
│   └── workers/
│       └── inferenceWorker.js
```

## Configuration

Update the configuration in `src/models/vital-signs/config.json`:

```json
{
    "sampling_rate": 30,
    "buffer_duration": 10,
    "detection_interval": 1000
}
```

## Browser Support

- Chrome (recommended)
- Firefox
- Safari
- Edge

## Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Create a new Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.
