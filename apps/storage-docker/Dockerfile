FROM node:24-bookworm-slim
WORKDIR /runtime
RUN npm install --omit=dev workerd@1.20260921.1 && mkdir /data && chown node:node /data
COPY entrypoint.mjs /runtime/entrypoint.mjs
USER node
EXPOSE 8787
VOLUME ["/data"]
ENTRYPOINT ["node", "/runtime/entrypoint.mjs"]
