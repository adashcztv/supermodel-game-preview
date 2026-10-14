FROM nginxinc/nginx-unprivileged:stable-alpine
USER root
RUN rm -rf /usr/share/nginx/html/* \
    && wget -q -O /tmp/release.zip https://github.com/eleventake/supermodel-game-preview/releases/download/core-v14-combat-ui-native-v30/supermodel-core-v14.zip \
    && echo "8af3b3a935da48759bb26b71bae5c571ce68a2ff4347444850a046b1e03061b4  /tmp/release.zip" | sha256sum -c - \
    && unzip -q /tmp/release.zip -d /usr/share/nginx/html \
    && rm /tmp/release.zip
COPY nginx.conf /etc/nginx/conf.d/default.conf
USER 101
EXPOSE 8080
