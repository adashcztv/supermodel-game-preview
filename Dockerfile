FROM nginxinc/nginx-unprivileged:stable-alpine
USER root
RUN rm -rf /usr/share/nginx/html/* \
    && wget -q -O /tmp/release.zip https://github.com/adashcztv/supermodel-game-preview/releases/download/runtime-v7/supermodel-root-v7.zip \
    && echo "53ed3ad3d23c2d5fdd7fcf02b9515b53a185bb7c9f80f92daca1393b660519c5  /tmp/release.zip" | sha256sum -c - \
    && unzip -q /tmp/release.zip -d /usr/share/nginx/html \
    && rm /tmp/release.zip
COPY nginx.conf /etc/nginx/conf.d/default.conf
USER 101
EXPOSE 8080
