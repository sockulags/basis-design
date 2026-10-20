# Basis in a container, for a team or a pipeline (see "Run it in a container" in README.md).
#
#   docker build -t basis .
#   docker run -p 5320-5324:5320-5324 -e BASIS_ACCESS_TOKEN=... -e BASIS_HOSTS=basis.internal \
#     -v basis-data:/data -v basis-home:/home/node basis
#
# Log Claude Code in once; the login stays in the /home/node volume:
#
#   docker exec -it <container> claude
FROM node:22-bookworm

# git for the workspaces' history, Playwright's Chromium (with its system libraries) for the screenshots, and Claude
# Code for the agent.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN apt-get update \
  && apt-get install -y --no-install-recommends git \
  && rm -rf /var/lib/apt/lists/* \
  && npx -y playwright@1.64.1 install --with-deps chromium \
  && npm install -g @anthropic-ai/claude-code

WORKDIR /app
COPY --chown=node:node package.json package-lock.json ./
RUN chown node:node /app && mkdir -p /data && chown node:node /data
USER node
RUN npm ci --omit=dev \
  # The ACP adapter Basis starts with npx, cached so the agent starts without fetching it.
  && npm cache add @agentclientprotocol/claude-agent-acp@0.92.0
COPY --chown=node:node . .

# Listen on every address, answer to the names in BASIS_HOSTS, and ask for BASIS_ACCESS_TOKEN (required here).
# Previews take ports 5321-5324, one per open project.
ENV HOST=0.0.0.0 \
  PORT=5320 \
  BASIS_PREVIEW_PORT=5321 \
  BASIS_PREVIEW_PORTS=4 \
  BASIS_HOME=/data
EXPOSE 5320 5321 5322 5323 5324
VOLUME ["/data", "/home/node"]
CMD ["npx", "tsx", "server/index.ts"]
