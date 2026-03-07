#!/bin/bash
set -e
echo "Installing client dependencies..."
cd client && npm install && npm run build && cd ..
echo "Installing server dependencies..."
cd server && npm install && cd ..
echo "Build complete."
