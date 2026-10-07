#!/bin/sh
# First start of the dev container: toolchain, dependencies, then the same
# one-time setup as on a laptop (env files, Docker services, schema, demo lab).
set -eu

# The container runs as the `node` user; linking pnpm into /usr/local/bin
# needs root.
sudo corepack enable
npm install --global bun
pnpm install

# The Docker daemon from the docker-in-docker feature may still be starting.
wait_for_docker() {
  for _ in $(seq 1 30); do
    docker info >/dev/null 2>&1 && return 0
    sleep 2
  done
  return 1
}

if ! wait_for_docker; then
  # The feature runs Docker with legacy iptables, which hosts whose kernel only
  # has nftables (recent Arch, Fedora…) lack: switch backends and start again.
  sudo update-alternatives --set iptables /usr/sbin/iptables-nft
  sudo update-alternatives --set ip6tables /usr/sbin/ip6tables-nft
  /usr/local/share/docker-init.sh true
  wait_for_docker
fi

pnpm setup:dev
