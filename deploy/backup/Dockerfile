# The `backup` service of compose.yaml (profile "backup"): pg_dump and pg_restore
# from the same PostgreSQL major as the database, the AWS CLI to mirror the
# object store, and age to encrypt the dumps. Built from this directory:
#
#   docker compose --profile backup build backup
#
# Only plain, well-known packages: no service of ours and nothing that phones home.
FROM postgres:17-alpine

RUN apk add --no-cache aws-cli age tzdata

COPY backup.sh /usr/local/bin/backup.sh

# The postgres image's entrypoint starts a server; this image runs the script.
ENTRYPOINT ["/usr/local/bin/backup.sh"]
CMD ["loop"]
