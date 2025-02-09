<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <meta name="description" content="Real-time vital signs monitoring using computer vision">
    <meta name="theme-color" content="#2c3e50">
    <title>Vital Signs Monitor</title>
    <link rel="stylesheet" href="./styles/main.css">

    <!-- Preload critical resources -->
    <link rel="preload" href="/models/face-api/tiny_face_detector_model-weights_manifest.json" as="fetch" crossorigin>
    <link rel="preload" href="/models/rphys/config.json" as="fetch" crossorigin>

    <!-- Add iOS meta tags and icons -->
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <meta name="apple-mobile-web-app-title" content="Vital Signs">
</head>

<body>
    <div class="app-container">
        <header class="app-header">
            <h1>Vital Signs Monitor</h1>
            <div class="controls">
                <button id="startButton" class="btn primary" disabled>
                    <span class="btn-icon">▶</span>
                    Start Capture
                </button>
                <button id="stopButton" class="btn secondary" disabled>
                    <span class="btn-icon">⏹</span>
                    Stop Capture
                </button>
                <button id="exportButton" class="btn secondary" disabled>
                    <span class="btn-icon">⬇</span>
                    Export Data
                </button>
            </div>
        </header>

        <main class="app-main">
            <div class="video-section">
                <div class="oval-frame" aria-label="Face capture area">
                    <canvas id="croppedFace"></canvas>
                    <div class="face-guide"></div>
                </div>
                <div class="camera-status" aria-live="polite"></div>
            </div>

            <div class="charts-section">
                <div class="chart-container">
                    <canvas id="bvpChart"></canvas>
                    <div id="heartRate" class="metric" role="status" aria-live="polite"></div>
                </div>
                <div class="chart-container">
                    <canvas id="respChart"></canvas>
                    <div id="respRate" class="metric" role="status" aria-live="polite"></div>
                </div>
            </div>
        </main>

        <footer class="app-footer">
            <div id="status" class="status-message" role="status" aria-live="polite"></div>
            <div class="performance-metrics" aria-live="polite">
                <span id="fpsCounter"></span>
                <span id="processingTime"></span>
            </div>
        </footer>

        <!-- Feature detection and fallback -->
        <script>
            // Check for required features
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                document.body.innerHTML = '<div class="error-message">' +
                    'Your browser does not support camera access. ' +
                    'Please use a modern browser like Chrome, Firefox, or Safari.' +
                    '</div>';
            }
        </script>

        <script>
            async function verifyFiles() {
                const basePath = './models/face-api';
                const files = [
                    'tiny_face_detector_model-weights_manifest.json',
                    'tiny_face_detector_model-shard1'
                ];

                for (const file of files) {
                    const response = await fetch(`${basePath}/${file}`);
                    console.log(`${file}: ${response.ok ? 'OK' : 'Not Found'} (${response.status})`);
                    if (file.endsWith('.json')) {
                        const text = await response.text();
                        console.log('Manifest content:', text.substring(0, 100) + '...');
                    }
                }
            }

            verifyFiles().catch(console.error);
        </script>

        <!-- Load application -->
        <script type="module" src="./js/app.js"></script>
    </div>
</body>

</html>