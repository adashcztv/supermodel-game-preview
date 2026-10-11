FROM nginxinc/nginx-unprivileged:stable-alpine
USER root
RUN rm -rf /usr/share/nginx/html/* \
    && wget -q -O /tmp/release.zip https://github.com/adashcztv/supermodel-game-preview/releases/download/runtime-v8/supermodel-root-v8.zip \
    && echo "4163b3ef0bdd39262b4358e8e91683e2be066fa55b8943d4d562a82636a10978  /tmp/release.zip" | sha256sum -c - \
    && unzip -q /tmp/release.zip -d /usr/share/nginx/html \
    && rm /tmp/release.zip
COPY nginx.conf /etc/nginx/conf.d/default.conf
USER 101
EXPOSE 8080
