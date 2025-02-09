# Description: This script is used to build the ORT website.

# Clean the existing setup
rm -rf node_modules
rm -rf public/ort/*
rm package-lock.json

# Clear the npm cache
npm cache clean --force

# Install dependencies (if you haven't already)
npm i onnxruntime-web

# Run the setup script
npm run setup

# Verify the setup
npm run verify-setup

# Build the website
npm run dev