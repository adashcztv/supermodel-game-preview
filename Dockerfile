FROM nginxinc/nginx-unprivileged:stable-alpine
USER root
RUN rm -rf /usr/share/nginx/html/* \
    && wget -q -O /tmp/release.zip https://github.com/adashcztv/supermodel-game-preview/releases/download/core-v12-native-v30/supermodel-core-v12.zip \
    && echo "4cdfc70098bfbd1b3402a659f3b474ca54664fccb1db5c404f2d3ac254ac50f8  /tmp/release.zip" | sha256sum -c - \
    && unzip -q /tmp/release.zip -d /usr/share/nginx/html \
    && rm /tmp/release.zip
COPY nginx.conf /etc/nginx/conf.d/default.conf
USER 101
EXPOSE 8080
