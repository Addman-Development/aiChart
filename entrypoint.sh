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

# If deployed under a sub-path (e.g. /smart-chart), create a symlink inside
# dist/ so that requests with the prefix still resolve to the correct assets.
BASEPATH=$(node -e "try{const u=new URL(process.env.VITE_APP_CLIENT_HOST||'');const p=u.pathname.replace(/^\/|\/$/g,'');if(p)console.log(p)}catch{}")
if [ -n "$BASEPATH" ]; then
  ln -sfn . "dist/$BASEPATH"
  echo "Sub-path symlink created: dist/$BASEPATH -> ."
fi

# Serve the UI
bunx serve -s dist -l ${VITE_APP_CLIENT_PORT}
