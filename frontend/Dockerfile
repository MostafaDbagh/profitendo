FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile
COPY . .
ARG APP_ORIGIN
ENV REACT_APP_AUTH_API_URL=$APP_ORIGIN REACT_APP_B2B_PRIMARY=true
RUN test -n "$APP_ORIGIN" && yarn build
FROM nginx:stable-alpine
COPY --from=build /app/build /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
