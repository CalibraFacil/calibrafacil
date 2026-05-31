# Gotenberg document/PDF conversion service, deployed as a Cloudflare Container.
# Cloudflare Containers require linux/amd64 images (build host here is amd64).
#
# Pin to a specific patch (e.g. gotenberg/gotenberg:8.21.1) for reproducibility
# once you've validated a version; ":8" tracks the latest v8.
FROM gotenberg/gotenberg:8

# Gotenberg's HTTP API listens on :3000; the fronting Worker forwards to it.
EXPOSE 3000
