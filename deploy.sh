#!/usr/bin/env sh

# abort on errors
set -e

# Set GitHub Pages environment variable
export GITHUB_PAGES=true

# Ensure clean installation
rm -rf node_modules
rm -rf dist

# Install dependencies with explicit version for onnxruntime-web
npm install
npm install onnxruntime-web@1.17.0

# build
npm run build

# navigate into the build output directory
cd dist

# Create .nojekyll file to prevent GitHub Pages from ignoring files that begin with an underscore
touch .nojekyll

git init
git add -A
git commit -m 'deploy'

# if you are deploying to https://<USERNAME>.github.io/<REPO>
git push -f git@github.com:PhysiologicAILab/mmrphys-live.git main:gh-pages

cd -