# AF Game Hub — container image for a Node host (VPS, Fly, Railway, Koyeb, Docker).
#
# Two ports matter: 8099 serves the hub, /go/, Wisp, music, Scramjet, Ultraviolet
# and Rammerhead pages; 8100 is Rammerhead's cross-domain origin. A host that
# maps only one port should set AFHUB_RH=0 and keep the two service-worker lanes.

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8099 \
    HOST=0.0.0.0
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY scripts ./scripts
COPY src ./src
COPY server ./server
COPY public ./public
RUN node scripts/build.mjs
EXPOSE 8099 8100
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.mjs"]
