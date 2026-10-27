FROM oven/bun:1
WORKDIR /app
COPY package.json lib.js server.js ./
COPY public ./public
EXPOSE 5173
CMD ["bun", "server.js"]
