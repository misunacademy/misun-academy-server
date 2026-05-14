FROM node:20-alpine AS base

WORKDIR /app

COPY package*.json ./
RUN npm install

FROM base AS builder
COPY . .
RUN npm run build

FROM base AS dev
ENV NODE_ENV=development
COPY . .
EXPOSE 5000
CMD ["npm", "run", "dev"]

FROM node:20-alpine AS production

WORKDIR /app

COPY --from=builder /app ./

ENV NODE_ENV=production

EXPOSE 5000

CMD ["npm", "start"]