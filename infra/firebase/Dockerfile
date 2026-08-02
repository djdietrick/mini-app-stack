# Firebase emulator suite for local development of the cloud path.
#
# Only used by the `emulators` compose profile — the default docker compose up
# runs the Postgres/Fastify stack and never builds this image.
#
# Debian rather than Alpine because the Firestore and Auth emulators are Java
# programs and need a JRE.
FROM node:20-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends default-jre-headless ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Pinned so a background release cannot change local behaviour mid-week.
RUN npm install -g firebase-tools@15.25.1

WORKDIR /workspace

# Bind to 0.0.0.0 inside the container so the ports published to the host are
# reachable; the emulators default to localhost-only.
CMD ["firebase", "emulators:start", \
  "--only", "auth,firestore,functions,hosting", \
  "--project", "demo-local"]
