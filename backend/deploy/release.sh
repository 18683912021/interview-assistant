#!/usr/bin/env bash
# Run on the reviewed Linux server as root. Never source .env or enable shell tracing.
set -Eeuo pipefail
umask 077

ROOT=${INTERVIEW_ROOT:-/www/wwwroot/interview-assistant}
BACKUPS=${INTERVIEW_BACKUPS:-/www/backups/interview-assistant}
SERVICE=${INTERVIEW_SERVICE:-interview-assistant.service}
PG_CONTAINER=${INTERVIEW_PG_CONTAINER:-iv-interview-pg}
REDIS_CONTAINER=${INTERVIEW_REDIS_CONTAINER:-iv-interview-redis}
PYTHON=${INTERVIEW_PYTHON:-python3}
HEALTH_URL=http://127.0.0.1:8010/health
EXPECTED_VERSION=0.5.0
COMMAND=${1:-}
ID=${2:-}
SOURCE=${3:-}
STOP_ATTEMPTED=0
SWITCH_BEGUN=0

say() { printf '%s\n' "[interview-release] $*"; }
fail() { say "$*" >&2; exit 1; }

[[ "$COMMAND" =~ ^(prepare|deploy|rollback)$ ]] || fail 'Usage: release.sh prepare ID SOURCE | deploy ID | rollback ID'
[[ "$ID" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$ ]] || fail 'Invalid release ID'
[[ "$ROOT" == /* && "$ROOT" != / && -d "$ROOT" && ! -L "$ROOT" ]] || fail 'Invalid project root'
[[ "$BACKUPS" == /* && "$BACKUPS" != / ]] || fail 'Invalid backup root'
[[ "$SERVICE" =~ ^[A-Za-z0-9._@-]+\.service$ ]] || fail 'Invalid systemd unit name'
[[ $EUID -eq 0 ]] || fail 'Run as root on the reviewed deployment server'
[[ "$(uname -s)" == Linux ]] || fail 'This script targets the reviewed Linux server only'
for tool in flock realpath tar sha256sum systemctl docker curl; do command -v "$tool" >/dev/null || fail "Missing command: $tool"; done
ROOT=$(realpath "$ROOT")
mkdir -p "$BACKUPS"
BACKUPS=$(realpath "$BACKUPS")
[[ "$BACKUPS/" != "$ROOT/"* ]] || fail 'Backups must be outside the web project directory'
chmod 700 "$BACKUPS"
mkdir -p "$ROOT/.deploy-releases"
[[ ! -L "$ROOT/.deploy-releases" ]] || fail '.deploy-releases must not be a symlink'
RELEASE="$ROOT/.deploy-releases/$ID"
BACKUP="$BACKUPS/$ID"
OLD_APP="$ROOT/.app-previous-$ID"
OLD_VENV="$ROOT/.venv-previous-$ID"
NEW_APP="$ROOT/.app-new-$ID"

# One lock covers prepare, deployment and rollback, including manual recovery.
exec 9>"$ROOT/.deploy.lock"
flock -n 9 || fail 'Another deployment or rollback is active'

unit_preflight() {
  [[ -f "$ROOT/.env" && -d "$ROOT/data" && -d "$ROOT/app" && -x "$ROOT/.venv/bin/python" ]] || fail 'Existing .env/data/app/.venv are required'
  [[ "$(systemctl show "$SERVICE" --property=LoadState --value)" == loaded ]] || fail 'Existing unit is not loaded'
  [[ "$(systemctl show "$SERVICE" --property=WorkingDirectory --value)" == "$ROOT" ]] || fail 'Unit WorkingDirectory differs; review the unit before release'
  local exec_start
  exec_start=$(systemctl show "$SERVICE" --property=ExecStart --value)
  [[ "$exec_start" == *"$ROOT/.venv/bin/"* && "$exec_start" == *uvicorn* && "$exec_start" == *"127.0.0.1"* && "$exec_start" == *"8010"* ]] || fail 'Unit must use the project .venv and uvicorn on 127.0.0.1:8010; review it first'
  # No systemd or nginx mutations are made here. Root reviews one-worker settings.
  [[ "$exec_start" != *"--reload"* ]] || fail 'Production unit must not use --reload'
  SERVICE_USER=$(systemctl show "$SERVICE" --property=User --value)
  SERVICE_GROUP=$(systemctl show "$SERVICE" --property=Group --value)
  SERVICE_USER=${SERVICE_USER:-root}
  SERVICE_GROUP=${SERVICE_GROUP:-$(id -gn "$SERVICE_USER")}
}

health() {
  local version=${1:-}
  local health_file="$RELEASE/health-response.json"
  for ((attempt=1; attempt<=60; attempt++)); do
    if systemctl is-active --quiet "$SERVICE" &&
       curl --noproxy '*' --silent --show-error --fail --max-time 2 "$HEALTH_URL" >"$health_file" 2>/dev/null &&
       "$ROOT/.venv/bin/python" - "$health_file" "$version" <<'PY'
import json, sys
try:
    response = json.load(open(sys.argv[1]))
    assert response.get("status") == "ok"
    if sys.argv[2]:
        assert response.get("version") == sys.argv[2]
except Exception:
    raise SystemExit(1)
PY
    then return 0; fi
    sleep 1
  done
  return 1
}

restore_previous() {
  # Restore code/runtime only. Additive DB migrations and new user writes remain.
  # Never automatically restore a dump, drop a database, or erase migration markers.
  systemctl stop "$SERVICE" || return 1
  if [[ -e "$OLD_APP" ]]; then
    if [[ -e "$ROOT/app" ]]; then mv "$ROOT/app" "$RELEASE/failed-app-$(date -u +%s)" || return 1; fi
    mv "$OLD_APP" "$ROOT/app" || return 1
  fi
  if [[ -e "$OLD_VENV" || -L "$OLD_VENV" ]]; then
    if [[ -e "$ROOT/.venv" || -L "$ROOT/.venv" ]]; then
      [[ -L "$ROOT/.venv" && "$(readlink "$ROOT/.venv")" == "$RELEASE/venv" ]] || return 1
      rm "$ROOT/.venv" || return 1
    fi
    mv "$OLD_VENV" "$ROOT/.venv" || return 1
  fi
  if [[ -f "$BACKUP/requirements.previous.txt" ]]; then
    cp -a "$BACKUP/requirements.previous.txt" "$ROOT/requirements.txt" || return 1
  elif [[ -f "$BACKUP/requirements.absent" ]]; then
    rm -f "$ROOT/requirements.txt" || return 1
  fi
  systemctl start "$SERVICE" || return 1
  health || return 1
  printf 'rolled-back\n' >"$RELEASE/status"
}

on_error() {
  local status=${1:-1}
  trap - EXIT INT TERM
  if (( status == 0 )); then return; fi
  if (( SWITCH_BEGUN )); then
    say 'Deployment failed; restoring previous app/runtime. Database is not reverted.' >&2
    if restore_previous >>"$BACKUP/recovery.log" 2>&1; then
      say 'Previous application is healthy again; inspect private backup logs.' >&2
    else
      say "Automatic application rollback failed. Inspect $BACKUP/recovery.log before further actions." >&2
    fi
  elif (( STOP_ATTEMPTED )); then
    systemctl start "$SERVICE" >/dev/null 2>&1 || true
    say 'Release failed before code switch; attempted to restart unchanged previous service.' >&2
  fi
  exit "$status"
}
trap 'on_error "$?"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

unit_preflight

if [[ "$COMMAND" == prepare ]]; then
  SOURCE=${SOURCE:-$RELEASE/source}
  [[ -n "$SOURCE" && -d "$SOURCE/app" && -f "$SOURCE/requirements.txt" ]] || fail 'SOURCE must contain app/ and requirements.txt'
  [[ ! -L "$RELEASE" ]] || fail 'Release path must not be a symlink'
  [[ ! -L "$ROOT/.venv" || "$(readlink "$ROOT/.venv")" != "$RELEASE/venv" ]] || fail 'Cannot prepare the active runtime'
  if [[ -f "$RELEASE/status" ]]; then
    [[ "$(cat "$RELEASE/status")" =~ ^(preparing|prepared)$ ]] || fail 'Release already used for a deployment; use a fresh ID'
  fi
  mkdir -p "$RELEASE"
  chmod 755 "$ROOT/.deploy-releases" "$RELEASE"
  printf 'preparing\n' >"$RELEASE/status"
  SOURCE=$(realpath "$SOURCE")
  if [[ "$SOURCE" != "$RELEASE/source" ]]; then
    [[ ! -e "$RELEASE/source" ]] || fail 'Staged source already exists; review it instead of overwriting'
    mkdir "$RELEASE/source"
    cp -a "$SOURCE/app" "$RELEASE/source/app"
    cp -a "$SOURCE/requirements.txt" "$RELEASE/source/requirements.txt"
  fi
  # Always build at its permanent path: venv entry-point shebangs use absolute paths.
  if [[ ! -x "$RELEASE/venv/bin/python" ]]; then
    "$PYTHON" -m venv "$RELEASE/venv" >"$RELEASE/prepare.log" 2>&1
  fi
  "$RELEASE/venv/bin/python" -m pip install --disable-pip-version-check -r "$RELEASE/source/requirements.txt" >>"$RELEASE/prepare.log" 2>&1
  "$RELEASE/venv/bin/python" -m pip check >>"$RELEASE/prepare.log" 2>&1
  "$RELEASE/venv/bin/python" -m pip freeze >"$RELEASE/requirements.resolved.txt"
  (
    cd "$RELEASE/source"
    "$RELEASE/venv/bin/python" - "$ROOT" "$EXPECTED_VERSION" <<'PY'
import os, sys
from pathlib import Path
from dotenv import load_dotenv
load_dotenv(Path(sys.argv[1]) / ".env", override=True)
if os.getenv("LOCAL_DEV", "").lower() in ("1", "true", "yes"):
    raise SystemExit("LOCAL_DEV is enabled; production PostgreSQL release aborted")
if not os.getenv("DATABASE_URL") or not os.getenv("REDIS_URL"):
    raise SystemExit("Production DATABASE_URL and REDIS_URL must be explicitly configured")
from sqlalchemy.engine import make_url
database = make_url(os.environ["DATABASE_URL"])
if database.drivername != "postgresql+asyncpg" or not database.database:
    raise SystemExit("Production DATABASE_URL must name a PostgreSQL/asyncpg database")
Path("../database.name").write_text(database.database)
from app.main import app
assert app.version == sys.argv[2], "Unexpected application version"
# Import only: no FastAPI lifespan, migrations, model, ASR or email requests.
print("Application import and expected version passed; no services contacted")
PY
  ) >>"$RELEASE/prepare.log" 2>&1
  sha256sum "$ROOT/.env" | cut -d' ' -f1 >"$RELEASE/environment.sha256"
  chmod 755 "$RELEASE/source"
  chown -R "$SERVICE_USER:$SERVICE_GROUP" "$RELEASE/source/app" "$RELEASE/venv"
  # The service needs only code/runtime access; keep logs/manifests root-private.
  chmod -R u+rX "$RELEASE/source/app" "$RELEASE/venv"
  (cd "$RELEASE/source" && tar --exclude='__pycache__' --exclude='*.pyc' -cf - app requirements.txt) | sha256sum | cut -d' ' -f1 >"$RELEASE/prepared.sha256"
  printf 'prepared\n' >"$RELEASE/status"
  say "Prepared $ID. No service stopped and no database migration executed. Review private prepare.log before deploy."
  exit 0
fi

[[ -d "$RELEASE" && ! -L "$RELEASE" ]] || fail 'Prepared release does not exist'

if [[ "$COMMAND" == rollback ]]; then
  [[ -d "$BACKUP" && -e "$OLD_APP" && ( -e "$OLD_VENV" || -L "$OLD_VENV" ) ]] || fail 'Previous application/runtime are not available for this release'
  [[ -L "$ROOT/.venv" && "$(readlink "$ROOT/.venv")" == "$RELEASE/venv" ]] || fail 'This release is not currently active; refuse out-of-order rollback'
  SWITCH_BEGUN=1
  restore_previous >>"$BACKUP/manual-rollback.log" 2>&1
  SWITCH_BEGUN=0
  say "Rolled back application/runtime from $ID. PostgreSQL and data/ were retained."
  exit 0
fi

[[ "$(cat "$RELEASE/status")" == prepared ]] || fail 'Only a prepared release can be deployed'
[[ ! -e "$BACKUP" && ! -e "$OLD_APP" && ! -e "$OLD_VENV" && ! -L "$OLD_VENV" && ! -e "$NEW_APP" ]] || fail 'Backup/switch paths already exist; inspect previous attempt'
[[ -x "$RELEASE/venv/bin/python" ]] || fail 'Prepared venv is missing'
PREPARED_HASH=$(cat "$RELEASE/prepared.sha256")
CURRENT_HASH=$( (cd "$RELEASE/source" && tar --exclude='__pycache__' --exclude='*.pyc' -cf - app requirements.txt) | sha256sum | cut -d' ' -f1)
[[ "$CURRENT_HASH" == "$PREPARED_HASH" ]] || fail 'Prepared source changed; prepare a new release'
[[ "$(sha256sum "$ROOT/.env" | cut -d' ' -f1)" == "$(cat "$RELEASE/environment.sha256")" ]] || fail '.env changed after preflight; prepare again'
systemctl is-active --quiet "$SERVICE" || fail 'Previous service is not active; inspect it before deployment'
[[ "$(docker inspect --format '{{.State.Running}}' "$PG_CONTAINER")" == true ]] || fail 'PostgreSQL container is not running'
[[ "$(docker inspect --format '{{.State.Running}}' "$REDIS_CONTAINER")" == true ]] || fail 'Redis container is not running'
CONTAINER_DATABASE=$(docker exec "$PG_CONTAINER" sh -eu -c 'user=${POSTGRES_USER:-postgres}; printf "%s" "${POSTGRES_DB:-$user}"')
[[ "$CONTAINER_DATABASE" == "$(cat "$RELEASE/database.name")" ]] || fail 'Application DB differs from container default DB; review backup target before release'
mkdir -p "$BACKUP"
chmod 700 "$BACKUP"
systemctl cat "$SERVICE" >"$BACKUP/systemd-unit.snapshot"
systemctl show "$SERVICE" >"$BACKUP/systemd-properties.snapshot"
docker inspect "$PG_CONTAINER" "$REDIS_CONTAINER" >"$BACKUP/container-config.snapshot.json"
cp -a "$ROOT/.env" "$BACKUP/environment.env"
chmod 600 "$BACKUP/environment.env"
if [[ -f "$ROOT/requirements.txt" ]]; then cp -a "$ROOT/requirements.txt" "$BACKUP/requirements.previous.txt"; else touch "$BACKUP/requirements.absent"; fi
for nginx_path in /www/server/panel/vhost/nginx/interview.iyouzi.cc.conf /www/server/panel/vhost/nginx/extension/interview.iyouzi.cc; do
  if [[ -e "$nginx_path" ]]; then cp -a "$nginx_path" "$BACKUP/"; fi
done
tar --exclude='./data' --exclude='./.venv' --exclude='./.git' --exclude='./.deploy-releases' \
  --exclude='./.deploy.lock' --exclude='./.app-previous-*' --exclude='./.venv-previous-*' \
  --exclude='./.app-new-*' --exclude='__pycache__' --exclude='*.pyc' \
  -czf "$BACKUP/code-config.tar.gz" -C "$ROOT" .
tar -tzf "$BACKUP/code-config.tar.gz" >/dev/null
cp -a "$RELEASE/source/app" "$NEW_APP"

# Query credentials inside the container; no passwords appear in host argv/stdout.
STOP_ATTEMPTED=1
systemctl stop "$SERVICE"
! systemctl is-active --quiet "$SERVICE" || fail 'Previous service did not stop'
docker exec "$PG_CONTAINER" sh -eu -c '
  user=${POSTGRES_USER:-postgres}
  database=${POSTGRES_DB:-$user}
  if [ -n "${POSTGRES_PASSWORD_FILE:-}" ]; then PGPASSWORD=$(cat "$POSTGRES_PASSWORD_FILE");
  else PGPASSWORD=${POSTGRES_PASSWORD:-}; fi
  export PGPASSWORD
  exec pg_dump --username="$user" --dbname="$database" --format=custom --no-owner --no-privileges
' >"$BACKUP/postgresql.dump.partial" 2>"$BACKUP/pg-dump.log"
[[ -s "$BACKUP/postgresql.dump.partial" ]]
docker exec -i "$PG_CONTAINER" pg_restore --list <"$BACKUP/postgresql.dump.partial" >"$BACKUP/postgresql.dump.list" 2>>"$BACKUP/pg-dump.log"
mv "$BACKUP/postgresql.dump.partial" "$BACKUP/postgresql.dump"
# Only application-owned audio files: pgdata/redisdata are live database mounts
# and must never be included in a filesystem tar while their containers run.
if [[ -d "$ROOT/data/audio-captures" ]]; then
  [[ ! -L "$ROOT/data/audio-captures" ]] || fail 'Audio capture directory is a symlink; review its backup target'
  tar -czf "$BACKUP/audio-captures.tar.gz.partial" -C "$ROOT/data" audio-captures
  tar -tzf "$BACKUP/audio-captures.tar.gz.partial" >/dev/null
  mv "$BACKUP/audio-captures.tar.gz.partial" "$BACKUP/audio-captures.tar.gz"
fi
sha256sum "$BACKUP/postgresql.dump" "$BACKUP/code-config.tar.gz" >"$BACKUP/SHA256SUMS"
if [[ -f "$BACKUP/audio-captures.tar.gz" ]]; then sha256sum "$BACKUP/audio-captures.tar.gz" >>"$BACKUP/SHA256SUMS"; fi
SWITCH_BEGUN=1
mv "$ROOT/app" "$OLD_APP"
mv "$NEW_APP" "$ROOT/app"
mv "$ROOT/.venv" "$OLD_VENV"
ln -s "$RELEASE/venv" "$ROOT/.venv"
cp -a "$RELEASE/source/requirements.txt" "$ROOT/requirements.txt"
printf 'starting\n' >"$RELEASE/status"
systemctl start "$SERVICE"
health "$EXPECTED_VERSION"
printf 'active\n' >"$RELEASE/status"
SWITCH_BEGUN=0
STOP_ATTEMPTED=0
say "Deployed $ID: loopback /health is healthy at version $EXPECTED_VERSION. Private backup: $BACKUP"
say 'Next: verify nginx HTTPS, authentication, migrations and WebSocket/streaming through the public domain.'
