FROM nginxinc/nginx-unprivileged:stable-alpine
USER root
RUN rm -rf /usr/share/nginx/html/* \
    && wget -q -O /tmp/release.zip https://github.com/eleventake/supermodel-game-preview/releases/download/core-v15-stateful-ui-native-v30/supermodel-core-v15.zip \
    && echo "3ab89db3b8b47d5379d74eeb4c97312555c96949421ffb2d807c332c6d0e1b4c  /tmp/release.zip" | sha256sum -c - \
    && unzip -q /tmp/release.zip -d /usr/share/nginx/html \
    && rm /tmp/release.zip
COPY nginx.conf /etc/nginx/conf.d/default.conf
USER 101
EXPOSE 8080
