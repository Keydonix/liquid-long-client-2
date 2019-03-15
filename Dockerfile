FROM node:10.15.3-alpine as builder

WORKDIR /app

# cache dependencies in a layer
COPY package.json /app/package.json
COPY package-lock.json /app/package-lock.json
RUN npm install

COPY . /app
RUN npm run build

VOLUME /export

ENTRYPOINT rm -rf /export/liquid-long-client; cp -r -p /app/output /export/liquid-long-client
