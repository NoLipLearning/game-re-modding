# Runs the Zero Hour page, multiplayer relay and mod storage on one port.
# Uses the committed engine build in prebuilt/, so no compiler is needed.
FROM node:22-slim
WORKDIR /app
COPY server/package.json server/package-lock.json server/
RUN cd server && npm ci --omit=dev
COPY server server
COPY web web
COPY prebuilt prebuilt
COPY tools/assemble-web.sh tools/
RUN tools/assemble-web.sh prebuilt && mkdir -p /data/mods && chown node /data/mods
ENV PORT=8080 MODS_DIR=/data/mods
EXPOSE 8080
USER node
CMD ["node", "server/server.mjs"]
