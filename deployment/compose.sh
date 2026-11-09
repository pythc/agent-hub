#!/bin/sh
set -eu
roppo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$roppo_root"
compose(){
  if [ -n "${ROPPO_SUBNET:-}" ]; then
    docker compose -f compose.yaml -f deployment/compose.network.yaml "$@"
  else
    docker compose "$@"
  fi
}
control(){ compose exec -T roppo node --import tsx src/container-cli.ts "$@"; }
build_or_pull(){
  roppo_target_image=$(compose config --images)
  if [ "${ROPPO_BUILD:-auto}" = local ]; then docker image inspect "$roppo_target_image" >/dev/null; return; fi
  if [ "${ROPPO_BUILD:-auto}" = 1 ] || { [ "${ROPPO_BUILD:-auto}" = auto ] && [ "$roppo_target_image" = roppo:local ]; }; then compose build roppo; else compose pull roppo; fi
}
roppo_action=${1:-up}
if [ "$#" -gt 0 ]; then shift; fi
case "$roppo_action" in
  up)
    if [ -n "$(compose ps --all -q roppo)" ]; then
      compose start --wait --wait-timeout 120 roppo
    else
      build_or_pull
      compose run --rm --no-deps --entrypoint node roppo --import tsx src/container-cli.ts inspect
      compose run --rm --no-deps roppo backup-if-existing
      compose up -d --no-build --wait --wait-timeout 120 roppo
    fi
    control open
    ;;
  start) compose start --wait --wait-timeout 120 roppo ;;
  stop) compose stop roppo ;;
  down) compose down ;;
  status) compose ps ;;
  logs) compose logs --tail 100 "$@" roppo ;;
  open) control open ;;
  check) control doctor ;;
  finish) control finish-upgrade ;;
  abort) control abort-upgrade ;;
  backup|upgrade)
    compose config --quiet
    roppo_id=$(compose ps -q roppo)
    [ -n "$roppo_id" ] || { echo 'Start the instance before maintenance.' >&2; exit 1; }
    roppo_old_image=$(docker inspect --format '{{.Image}}' "$roppo_id")
    roppo_prepared=false
    roppo_target_started=false
    roppo_ok=false
    cleanup(){
      roppo_result=$?
      trap - EXIT INT TERM
      if [ "$roppo_ok" = false ] && [ "$roppo_prepared" = true ]; then
        if [ "$roppo_target_started" = false ]; then
          compose start --wait --wait-timeout 120 roppo && control abort-upgrade || true
        else
          echo 'Upgrade did not finish. Data and the maintenance pause are retained. Inspect logs; no database or code rollback was attempted.' >&2
        fi
      fi
      exit "$roppo_result"
    }
    trap cleanup EXIT
    trap 'exit 130' INT
    trap 'exit 143' TERM
    if [ "$roppo_action" = upgrade ]; then
      build_or_pull
      # This helper only reads the existing config/database. It cannot acquire
      # Runtime ownership, recover files or start model work.
      compose run --rm --no-deps --entrypoint node roppo --import tsx src/container-cli.ts inspect
    fi
    control prepare-upgrade
    roppo_prepared=true
    compose stop roppo
    # Use the exact old image and volume, even if the target tag was replaced.
    docker run --rm --init --network none --cap-drop ALL --security-opt no-new-privileges --user 1000:1000 \
      --volumes-from "$roppo_id":rw --entrypoint python3 "$roppo_old_image" /opt/roppo/deployment/container-entrypoint.py backup
    if [ "$roppo_action" = upgrade ]; then
      compose run --rm --no-deps --entrypoint node roppo --import tsx src/container-cli.ts inspect
      roppo_target_started=true
      compose up -d --no-build --wait --wait-timeout 120 roppo
    else
      compose start --wait --wait-timeout 120 roppo
    fi
    control finish-upgrade
    roppo_ok=true
    ;;
  *) echo 'Usage: deployment/compose.sh up|start|stop|down|status|logs|open|check|backup|upgrade|finish|abort' >&2; exit 2 ;;
esac
