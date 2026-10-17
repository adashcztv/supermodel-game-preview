# Accepted stateless v19 image, verified by ID and rootfs-layer prefix before use.
FROM local/super-model-preview:core-v19-stable-sami-20261016
USER root
RUN wget -q -O /tmp/native-delivery.zip https://github.com/eleventake/supermodel-game-preview/releases/download/core-v20-delivery-native-v38/native-delivery-v38.zip \
    && echo "2c0e411cf73a799b4c67ea9ccc4d54e17ef2b0028128a6aa12ecedc18f05299a  /tmp/native-delivery.zip" | sha256sum -c - \
    && unzip -qo /tmp/native-delivery.zip -d /usr/share/nginx/html \
    && rm /tmp/native-delivery.zip
COPY nginx.conf /etc/nginx/conf.d/default.conf
USER 101
EXPOSE 8080
