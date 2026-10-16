FROM nginxinc/nginx-unprivileged:stable-alpine@sha256:56b8272e43a0525f67aed68d1e0794a712d10e3e45a563e118e9a77c817e6f86
USER root
RUN rm -rf /usr/share/nginx/html/* \
    && wget -q -O /tmp/release.zip https://github.com/eleventake/supermodel-game-preview/releases/download/core-v18-stable-ui-native-v36/supermodel-core-v18.zip \
    && echo "b6f5bd7a1a91abe72b05093354bd34b0a47df7adee60bdd154bdcddf31d49616  /tmp/release.zip" | sha256sum -c - \
    && unzip -q /tmp/release.zip -d /usr/share/nginx/html \
    && rm /tmp/release.zip
COPY nginx.conf /etc/nginx/conf.d/default.conf
USER 101
EXPOSE 8080
