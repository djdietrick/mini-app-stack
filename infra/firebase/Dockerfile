# Firebase emulator suite for local development of the cloud path.
#
# Only used by the `emulators` compose profile — the default docker compose up
# runs the Postgres/Fastify stack and never builds this image.
#
# Debian rather than Alpine because the Firestore and Auth emulators are Java
# programs and need a glibc JRE.
#
# firebase-tools refuses to run them on anything older than Java 21, and
# bookworm's default-jre-headless is 17, so the JRE is copied in from the
# Temurin image instead of installed from apt.
FROM eclipse-temurin:21-jre AS jre

FROM node:20-bookworm-slim

COPY --from=jre /opt/java/openjdk /opt/java/openjdk
ENV JAVA_HOME=/opt/java/openjdk
ENV PATH="${JAVA_HOME}/bin:${PATH}"

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Pinned so a background release cannot change local behaviour mid-week.
RUN npm install -g firebase-tools@15.25.1

WORKDIR /workspace

# Bind to 0.0.0.0 inside the container so the ports published to the host are
# reachable; the emulators default to localhost-only.
CMD ["firebase", "emulators:start", \
  "--only", "auth,firestore,functions,hosting", \
  "--project", "demo-local"]
