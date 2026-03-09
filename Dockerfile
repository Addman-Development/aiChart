FROM oven/bun:1 AS base

WORKDIR /code
COPY . .

RUN cd client && bun install && cd ../server && bun install
RUN cd client && bun run build

EXPOSE 4018
EXPOSE 4019

ENTRYPOINT ["./entrypoint.sh"]
