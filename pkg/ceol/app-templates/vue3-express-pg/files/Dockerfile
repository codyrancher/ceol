FROM node:22-alpine AS client-build
WORKDIR /app/client
COPY client/package.json ./
RUN npm install
COPY client/ .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY server/package.json ./
RUN npm install --omit=dev
COPY server/ .
COPY --from=client-build /app/client/dist ./public

# Express serves the built client from /public
ENV NODE_ENV=production
ENV PORT=80
EXPOSE 80
CMD ["node", "src/index.js"]
