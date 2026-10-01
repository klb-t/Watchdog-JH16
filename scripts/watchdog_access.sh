#!/usr/bin/env bash
# Sourced by watchdogctl; reuses its root isolation and installation lock.
set_access_env() {
  # Values, including SMTP secrets, travel on stdin, never a process argument.
  printf '%s' "$2" | python3 -c '
import os,sys
path,key=sys.argv[1:]; value=sys.stdin.read()
if "\n" in value or "\r" in value: sys.exit("Environment values cannot contain newlines")
lines=open(path).read().splitlines() if os.path.exists(path) else []
lines=[s for s in lines if not s.startswith(key+"=")]
if value: lines.append(key+"="+value)
tmp=path+".tmp"
with open(tmp,"w") as f: f.write("\n".join(lines)+"\n")
os.chmod(tmp,0o600); os.replace(tmp,path)
' "$root/etc/watchdog/app.env" "$1"
}
access_ready() {
  local attempt
  for attempt in {1..60}; do
    if curl --fail --silent --max-time 2 http://127.0.0.1:8080/api/auth/config >/dev/null; then return 0; fi
    sleep 2
  done
  die 'Application did not become ready; inspect watchdogctl logs. Public activation stopped.'
}
access_command() {
  require_admin
  case "$1" in
    proxy-logs) require_commands journalctl; journalctl -u watchdog-proxy.service -n 150 --no-pager; return ;;
    people|grant|invite|open-link|signin-link)
      require_commands docker; lock
      docker exec watchdog node dist/watchdog-admin.cjs "$@"; return ;;
  esac
  require_commands systemctl curl; lock
  [[ ! -e $root/etc/watchdog/recovery-required ]] || die 'Recover the installation before changing access.'
  case "$1" in
    enable-accounts)
      local email=${2:-}; email=${email,,}
      [[ $email =~ ^[^[:space:]@\"\\]+@[^[:space:]@\"\\]+\.[^[:space:]@\"\\]+$ ]] || die 'Usage: watchdogctl enable-accounts EMAIL'
      # Preserve every existing operator grant. The new owner is an explicit addition.
      local grants
      grants=$(python3 -c 'import json,sys; rows=open(sys.argv[1]).read().splitlines(); raw=next((s.split("=",1)[1] for s in rows if s.startswith("WATCHDOG_GRANTS=")),"{}"); g=json.loads(raw or "{}"); g[sys.argv[2]]="developer"; print(json.dumps(g,separators=(",",":")))' "$root/etc/watchdog/app.env" "$email")
      set_access_env WATCHDOG_GRANTS "$grants"
      set_access_env WATCHDOG_AUTH accounts
      set_access_env WATCHDOG_ALLOW_OPEN_INSTANCE ''
      systemctl restart watchdog.service; access_ready
      printf 'Closed accounts enabled. Existing ownership and grants retained.\n'
      if [[ ${3:-} != --no-link ]]; then require_commands docker; docker exec watchdog node dist/watchdog-admin.cjs signin-link "$email"; fi ;;
    enable-public)
      local host=${2:-}; host=${host,,}
      [[ $host =~ ^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$ ]] || die 'Usage: watchdogctl enable-public HOST'
      grep -qsx 'WATCHDOG_AUTH=accounts' "$root/etc/watchdog/app.env" || die 'Refusing public access: enable accounts first.'
      [[ -f $root/etc/systemd/system/watchdog-proxy.service ]] || die 'Proxy unit missing; update the installation.'
      install -d -m 0700 "$root/var/lib/watchdog-proxy/data" "$root/var/lib/watchdog-proxy/config"
      printf '%s {\n\tencode zstd gzip\n\theader Strict-Transport-Security "max-age=31536000"\n\treverse_proxy 127.0.0.1:8080\n}\n' "$host" > "$root/etc/watchdog/Caddyfile.tmp"
      chmod 0644 "$root/etc/watchdog/Caddyfile.tmp"; mv "$root/etc/watchdog/Caddyfile.tmp" "$root/etc/watchdog/Caddyfile"
      printf '%s\n' "$host" > "$root/etc/watchdog/public-host"
      set_access_env WATCHDOG_PUBLIC_URL "https://$host"
      set_access_env WATCHDOG_TRUST_PROXY 'loopback,uniquelocal'
      systemctl restart watchdog.service; access_ready
      if command -v ufw >/dev/null; then require_commands ufw; ufw allow 80/tcp; ufw allow 443/tcp; fi
      systemctl enable watchdog-proxy.service; systemctl restart watchdog-proxy.service
      printf 'HTTPS configured: https://%s — certificate and external reachability still require live acceptance.\n' "$host" ;;
    disable-public)
      systemctl disable --now watchdog-proxy.service
      if command -v ufw >/dev/null; then require_commands ufw; ufw delete allow 80/tcp || true; ufw delete allow 443/tcp || true; fi
      rm -f "$root/etc/watchdog/public-host"
      set_access_env WATCHDOG_PUBLIC_URL ''; set_access_env WATCHDOG_TRUST_PROXY ''
      systemctl restart watchdog.service ;;
    set-public-url)
      [[ ${2:-} =~ ^https://[^[:space:]/]+$ ]] || die 'Usage: watchdogctl set-public-url https://HOST'
      set_access_env WATCHDOG_PUBLIC_URL "$2"; systemctl restart watchdog.service ;;
    set-mail)
      local from smtp
      read -r -p 'From address: ' from
      read -r -s -p 'SMTP URL: ' smtp; printf '\n'
      [[ $smtp =~ ^smtps?:// && -n $from ]] || die 'SMTP URL and From address are required.'
      set_access_env MAIL_FROM "$from"; set_access_env SMTP_URL "$smtp"; unset smtp
      systemctl restart watchdog.service ;;
    *) die 'Unknown access command' ;;
  esac
}
