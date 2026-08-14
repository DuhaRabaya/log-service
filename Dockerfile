FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY tsconfig.json ./
COPY src ./src
COPY migrations ./migrations

RUN npm run build

EXPOSE 8080

CMD ["node", "dist/index.js"]