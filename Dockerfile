# --- build stage ---
FROM --platform=linux/amd64 node:20-alpine AS build

WORKDIR /app

# Prisma needs openssl on alpine.
RUN apk add --no-cache openssl

COPY package*.json ./
RUN npm ci

COPY . .

# Generate Prisma client (needed for tsc build) then compile.
RUN npx prisma generate
RUN npm run build

# --- production stage ---
FROM --platform=linux/amd64 node:20-alpine AS production

WORKDIR /app
ENV NODE_ENV=production

RUN apk add --no-cache openssl

COPY package*.json ./
# prisma CLI is a prod dependency → available for `prisma migrate deploy`.
RUN npm ci --omit=dev

# Schema + migrations (needed for generate + migrate deploy in the chart's Job).
COPY prisma ./prisma
RUN npx prisma generate

COPY --from=build /app/dist ./dist

USER node
EXPOSE 3000

CMD ["node", "dist/main.js"]
