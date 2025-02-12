#!/usr/bin/env sh

# Abort on errors
set -e

# Build the project
npm run build

# Navigate to the build output directory
cd dist

# If you are deploying to a personal repository
git init
git add -A
git commit -m 'deploy'

# If deploying to https://<USERNAME>.github.io/<REPO>
git push -f git@github.com:jnj256/mmrphys.github.io.git main:gh-pages

# Return to the project root
cd -