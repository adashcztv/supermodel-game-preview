FROM nginxinc/nginx-unprivileged:stable-alpine@sha256:56b8272e43a0525f67aed68d1e0794a712d10e3e45a563e118e9a77c817e6f86
USER root
RUN rm -rf /usr/share/nginx/html/* \
    && wget -q -O /tmp/release.zip https://github.com/eleventake/supermodel-game-preview/releases/download/core-v16-stable-ui-native-v30/supermodel-core-v16.zip \
    && echo "e68d9e386750f8030742c49d523f8d55ba7baf3f44ec99b86dec043cbb6f1bf5  /tmp/release.zip" | sha256sum -c - \
    && unzip -q /tmp/release.zip -d /usr/share/nginx/html \
    && rm /tmp/release.zip
COPY nginx.conf /etc/nginx/conf.d/default.conf
USER 101
EXPOSE 8080
