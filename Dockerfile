# Accepted stateless v20 image; ID and rootfs prefix are independently verified.
FROM local/super-model-preview:core-v20-delivery-20261017
USER root
RUN wget -q -O /tmp/preview-layer.zip https://github.com/eleventake/supermodel-game-preview/releases/download/core-v22-image-native-v39/core-v22-native-v39-layer.zip \
    && echo "970ddc1d507ca4dceba701ef4de40b141c8d71454509392e14dbcd3dd935fd67  /tmp/preview-layer.zip" | sha256sum -c - \
    && unzip -qo /tmp/preview-layer.zip -d /usr/share/nginx/html \
    && rm /tmp/preview-layer.zip
COPY nginx.conf /etc/nginx/conf.d/default.conf
USER 101
EXPOSE 8080
