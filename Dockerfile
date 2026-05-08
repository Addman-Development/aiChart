FROM oven/bun:1 AS base

WORKDIR /code
COPY . .

RUN sed -i 's/\r$//' entrypoint.sh && chmod +x entrypoint.sh
RUN cd client && bun install && cd ../server && bun install
RUN cd server && bunx playwright install --with-deps chromium
# Note: client `bun run build` is intentionally NOT run here. Vite reads
# VITE_* env vars at build time, so the build has to happen at container
# start in entrypoint.sh, where the runtime env is available. Building here
# would just produce a bundle with empty env vars that gets overwritten.

EXPOSE 4018
EXPOSE 4019

# Lightweight readiness probe: bun has a built-in fetch we can use. The API
# binds 4019; /health returns 200 once migrations finish, 503 otherwise.
HEALTHCHECK --interval=15s --timeout=5s --start-period=120s --retries=3 \
  CMD bun -e "fetch('http://localhost:4019/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

ENTRYPOINT ["./entrypoint.sh"]
