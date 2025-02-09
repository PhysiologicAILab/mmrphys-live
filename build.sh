# Description: This script is used to build the ORT website.

# Clean the existing setup
rm -rf node_modules
rm -rf public/ort/*

# Clear the npm cache
npm cache clean --force

# Install dependencies (if you haven't already)
npm install

# Run the setup script
npm run setup

# Build the website
npm run dev