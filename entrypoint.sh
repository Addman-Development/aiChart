#!/bin/bash

# all env vars used in the client app need to be set here as well
export VITE_APP_API_HOST=${VITE_APP_API_HOST}
export VITE_APP_CLIENT_HOST=${VITE_APP_CLIENT_HOST}
export VITE_APP_CLIENT_PORT=${VITE_APP_CLIENT_PORT}

cd server
NODE_ENV=production nohup node index.js &

cd ../client
echo "The UI is rebuilding. Please wait..."
bun run build
echo "UI built successfully!"

# Serve the UI
bunx serve -s dist -l ${VITE_APP_CLIENT_PORT}
