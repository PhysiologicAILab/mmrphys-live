# MMRPhys-Live

Real-time remote physiological sensing application using deep learning models for non-contact vital signs monitoring.

## Overview

MMRPhys-Live is a web application that monitors vital signs (heart rate and respiratory rate) using facial video analysis. It currently deploys MMRPhys model trained using the [SCAMPS dataset](https://github.com/danmcduff/scampsdataset) to extract physiological signals from facial videos in real-time.

## Live Demo

Try the application here: [MMRPhys-Live Demo](https://physiologicailab.github.io/mmrphys-live/)

## Features

- Real-time video capture with face detection
- Blood Volume Pulse (BVP) signal extraction
- Respiratory signal extraction
- Heart rate and respiratory rate monitoring
- Real-time signal visualization with Chart.js
- Data export functionality
- Cross-platform compatibility (works on desktop and mobile browsers)
- Web Worker-based processing for improved performance

## Technology Stack

- React (TypeScript)
- ONNX Runtime Web for model inference
- Face-API.js for face detection
- Chart.js for real-time data visualization
- Vite for development and bundling
- Tailwind CSS for styling

## Prerequisites

- Node.js (v16 or higher)
- npm (v7 or higher)
- Modern web browser with camera access

## Installation

1. Clone the repository:

```bash
git clone https://github.com/PhysiologicAILab/mmrphys-live.git
cd mmrphys-live
```

2. Install dependencies:

```bash
npm install
```

3. Set up models (face-api.js and ONNX models):

```bash
npm run setup
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

## Deployment

The application can be deployed to GitHub Pages using:

```bash
npm run deploy
```

The current deployment is available at: [https://physiologicailab.github.io/mmrphys-live/](https://physiologicailab.github.io/mmrphys-live/)

## Project Structure

```
mmrphys-live/
├── public/                   # Static assets
│   ├── models/               # Model files
│   │   ├── face-api/         # Face detection models
│   │   └── rphys/            # Physiological sensing models
│   └── ort/                  # ONNX Runtime Web assets
├── src/
│   ├── components/           # React components
│   │   ├── Controls/         # Capture control components
│   │   ├── StatusMessage/    # Status notifications
│   │   ├── VideoDisplay/     # Video feed display
│   │   └── VitalSignsChart/  # Charts for vital signs
│   ├── hooks/                # Custom React hooks
│   ├── services/             # Service layer
│   ├── styles/               # CSS and styling
│   ├── types/                # TypeScript type definitions
│   ├── utils/                # Utility functions
│   ├── workers/              # Web Workers
│   │   ├── inferenceWorker.ts # ONNX model inference
│   │   └── videoProcessingWorker.ts # Video frame processing
│   ├── App.tsx               # Main application component
│   └── main.tsx              # Entry point
├── scripts/                  # Build and setup scripts
├── python_scripts/           # Python utilities to read and process the acquired data
└── torch2onnx/               # PyTorch to ONNX conversion tools
```

## Configuration

The application uses configuration files for the physiological sensing models in `public/models/rphys/config.json`. The key parameters include:

- Frame buffer size
- Sampling rate
- Physiological signal parameters (min/max rates)
- Model input/output specifications

## Browser Support

- Chrome (recommended)
- Firefox
- Safari
- Edge

The application works best on devices with good camera quality and processing power.

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Repository

[GitHub Repository](https://github.com/PhysiologicAILab/mmrphys-live)
