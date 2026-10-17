# Accepted v22 image; exact ID and parent layer prefix are independently verified.
FROM local/super-model-preview:core-v22-image-20261017
USER root
RUN wget -q -O /tmp/preview-layer.zip https://github.com/eleventake/supermodel-game-preview/releases/download/core-v23-stable-native-v40/core-v23-native-v40-layer.zip \
    && echo "1d046f12906884722b00a03bdacece4c8dbc9e3caa266c04b406d5a5b7b2f064  /tmp/preview-layer.zip" | sha256sum -c - \
    && unzip -qo /tmp/preview-layer.zip -d /usr/share/nginx/html \
    && rm /tmp/preview-layer.zip
COPY nginx.conf /etc/nginx/conf.d/default.conf
USER 101
EXPOSE 8080
