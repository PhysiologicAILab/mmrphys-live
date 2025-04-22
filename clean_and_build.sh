# Description: This script is used to build the ORT website.

# Clear the npm cache
npm cache clean --force

# Clean the existing setup
rm -rf node_modules
rm -rf dist
rm -rf public/models/face-api/*
rm -rf public/ort
rm -rf .vite


file="package-lock.json"
if [ -f "$file" ] ; then
    rm "$file"
fi

# Install dependencies (if you haven't already)
npm install face-api.js@latest
npm install onnxruntime-web@1.17.0
npm ci

npm install

# Run the setup script
npm run setup

# Verify the setup
npm run verify-setup

export GITHUB_PAGES=false

# Build the website
npm run dev