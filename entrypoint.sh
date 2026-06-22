#!/bin/bash
set -uo pipefail

# Vite reads VITE_* env vars at build time, so the build has to run inside the
# container where the runtime env is available. The Dockerfile no longer
# bakes a build (it would have empty env vars anyway).
export VITE_APP_API_HOST=${VITE_APP_API_HOST}
export VITE_APP_CLIENT_HOST=${VITE_APP_CLIENT_HOST}
export VITE_APP_CLIENT_PORT=${VITE_APP_CLIENT_PORT}

cd /code

# Start the API immediately. Don't wait for the UI build; the API doesn't
# depend on it, and starting it first means /health responds during build.
NODE_ENV=production node server/index.js &
API_PID=$!
echo "API started (pid $API_PID)"

# Build the client UI with the runtime env baked in.
echo "The UI is rebuilding. Please wait..."
(cd client && bun run build)
echo "UI built successfully!"

# If deployed under a sub-path (e.g. /smart-chart), create a symlink inside
# dist/ so that requests with the prefix still resolve to the correct assets.
BASEPATH=$(node -e "try{const u=new URL(process.env.VITE_APP_CLIENT_HOST||'');const p=u.pathname.replace(/^\/|\/$/g,'');if(p)console.log(p)}catch{}")
if [ -n "$BASEPATH" ]; then
  ln -sfn . "client/dist/$BASEPATH"
  echo "Sub-path symlink created: client/dist/$BASEPATH -> ."
fi

# Serve the UI in the background so we can supervise both processes from the
# foreground bash script.
bunx serve -s client/dist -l "${VITE_APP_CLIENT_PORT}" &
UI_PID=$!
echo "UI server started (pid $UI_PID)"

# Forward SIGTERM/SIGINT to children, then wait for them to exit cleanly.
shutdown() {
  echo "Forwarding shutdown signal to children..."
  kill -TERM "$API_PID" "$UI_PID" 2>/dev/null || true
  wait "$API_PID" "$UI_PID" 2>/dev/null || true
  exit 0
}
trap shutdown SIGTERM SIGINT

# Wait for either child to exit. If one dies, kill the other and exit
# non-zero so Docker's restart policy kicks in. This prevents the
# zombie-API-but-UI-still-running scenario where the container looks healthy
# but requests get 503.
wait -n
EXIT_CODE=$?
echo "A child process exited (code $EXIT_CODE). Stopping the other and exiting."
kill -TERM "$API_PID" "$UI_PID" 2>/dev/null || true
wait 2>/dev/null || true
exit "$EXIT_CODE"
