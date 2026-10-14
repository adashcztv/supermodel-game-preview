FROM nginxinc/nginx-unprivileged:stable-alpine
USER root
RUN rm -rf /usr/share/nginx/html/* \
    && wget -q -O /tmp/release.zip https://github.com/eleventake/supermodel-game-preview/releases/download/core-v13-support-audio-native-v30/supermodel-core-v13.zip \
    && echo "168c16424f1be40b367d9767b1344f83708ccab65a4cc1e07f6e4af076354241  /tmp/release.zip" | sha256sum -c - \
    && unzip -q /tmp/release.zip -d /usr/share/nginx/html \
    && rm /tmp/release.zip
COPY nginx.conf /etc/nginx/conf.d/default.conf
USER 101
EXPOSE 8080
