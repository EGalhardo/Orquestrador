#!/bin/sh
# Wipes the local accounts database (dev only). The API must be restarted afterwards.
cd "$(dirname "$0")/../.." && rm -f .data/forge.db .data/forge.db-wal .data/forge.db-shm && rm -rf projects/projeto-* && echo "database reset"
