FROM oven/bun:1 AS base

WORKDIR /code
COPY . .

RUN sed -i 's/\r$//' entrypoint.sh && chmod +x entrypoint.sh
RUN cd client && bun install && cd ../server && bun install
RUN cd server && bunx playwright install --with-deps chromium
RUN cd client && bun run build

EXPOSE 4018
EXPOSE 4019

ENTRYPOINT ["./entrypoint.sh"]
