FROM ubuntu:24.04 AS dependencies

RUN apt-get update && apt-get install -y --no-install-recommends \
    libarchive13t64 libcurl4t64 libfreetype6 libpng16-16t64 libsdl2-2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY dist/cloudflare/html-renderer /app/html-renderer

# Keep the ELF loader and the actual dependency closure. The headless path
# does not load SDL's optional graphics drivers.
RUN mkdir -p /app-root/tmp \
    && chmod 1777 /app-root/tmp \
    && ldd /app/html-renderer > /tmp/gea-libraries \
    && ! grep -q 'not found' /tmp/gea-libraries \
    && awk '$3 ~ /^\// {print $3} NF > 1 && $1 ~ /^\// {print $1}' /tmp/gea-libraries \
      | sort -u | xargs -r cp -L --parents -t /app-root

FROM scratch
COPY --from=dependencies /app-root/ /
COPY --from=dependencies /app /app
WORKDIR /app
ENV LD_LIBRARY_PATH=/usr/lib/x86_64-linux-gnu/pulseaudio
USER 65534:65534
EXPOSE 8080
ENTRYPOINT ["/app/html-renderer", "--gea-prerender-http"]
