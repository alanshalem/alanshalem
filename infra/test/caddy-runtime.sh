#!/bin/sh
# The Caddyfile running in the pinned Caddy image (infra/caddy/Dockerfile), in the forms the compose files start it,
# against a stub API (the same image answering with the X-Forwarded-* and X-Proxy-Secret it received): production as
# the edge (plain VPS), staging and production behind a proxy (Dokploy's Traefik: trusted proxies + the proxy secret,
# which reaches neither the API nor Caddy's access log), and a SITE_ENV typo.
# Text tests (infra/test/caddy.test.ts) pin the directives; this proves what they do. CI's infra job runs it; locally,
# from anywhere: sh infra/test/caddy-runtime.sh (needs Docker and curl). Everything it creates is named
# caddy-runtime-<pid>-* and removed on exit; Caddy publishes a random port on 127.0.0.1 only.
set -eu
# Git Bash on Windows: container paths go to docker as they are.
export MSYS_NO_PATHCONV=1
cd "$(dirname "$0")/../.."

image=$(sed -n 's/^FROM \(caddy:[^ ]*\).*/\1/p' infra/caddy/Dockerfile)
test -n "$image"
run=caddy-runtime-$$
secret=runtime-test-proxy-secret-0123456789abcdef
# A documentation address (RFC 5737): what a forged X-Forwarded-For claims.
forged=203.0.113.7
failures=0
response=

cleanup() {
	# -v: also the image's anonymous volumes (/data, /config).
	docker rm -f -v "$run-caddy" "$run-api" >/dev/null 2>&1 || true
	docker network rm "$run" >/dev/null 2>&1 || true
}
trap cleanup EXIT
trap 'exit 130' INT TERM

docker network create "$run" >/dev/null
# The stub API: answers every path (Caddy's health check too) with what reached it.
docker run -d --name "$run-api" --network "$run" --network-alias api \
	--env 'STUB=:8080 {
	respond "xff={header.X-Forwarded-For} proto={header.X-Forwarded-Proto} secret={header.X-Proxy-Secret}"
}' "$image" sh -c 'printf "%s\n" "$STUB" >/tmp/Caddyfile && exec caddy run --config /tmp/Caddyfile --adapter caddyfile' >/dev/null

# Creates Caddy with the repo's Caddyfile and the given --env options, without starting it.
create_caddy() {
	docker rm -f -v "$run-caddy" >/dev/null 2>&1 || true
	docker create --name "$run-caddy" --network "$run" --publish 127.0.0.1::80 "$@" "$image" >/dev/null
	docker cp infra/caddy/Caddyfile "$run-caddy:/etc/caddy/Caddyfile"
}

# Starts it with a published site (a robots.txt and the 404 pages the build writes: one per language, plus the root
# /404.html Astro always writes, which Caddy must never serve) and waits until it answers.
start_caddy() {
	create_caddy "$@"
	docker start "$run-caddy" >/dev/null
	docker exec "$run-caddy" sh -c 'mkdir -p /srv/site/current/es /srv/site/current/en &&
		printf "User-agent: *\nAllow: /\n" >/srv/site/current/robots.txt &&
		printf "root 404 page\n" >/srv/site/current/404.html &&
		printf "es 404 page\n" >/srv/site/current/es/404.html &&
		printf "en 404 page\n" >/srv/site/current/en/404.html'
	address=$(docker port "$run-caddy" 80/tcp | head -n 1)
	for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
		# The shell discards the body: curl's own -o /dev/null fails on Git Bash without path conversion.
		curl -s "http://$address/" >/dev/null && return 0
		sleep 0.5
	done
	docker logs "$run-caddy" >&2
	echo "Caddy did not answer on $address" >&2
	exit 1
}

# GET path [curl options]: the whole response (status line, headers, body) without carriage returns.
get() {
	path=$1
	shift
	response=$(curl -sS -i "$@" "http://$address$path" | tr -d '\r')
}

headers() { printf '%s\n' "$response" | sed '/^$/q'; }
body() { printf '%s\n' "$response" | sed '1,/^$/d'; }
status_is() { [ "$(printf '%s\n' "$response" | head -n 1 | cut -d ' ' -f 2)" = "$1" ]; }
header_is() { headers | grep -Fqix "$1: $2"; }
no_header() { ! headers | grep -qi "^$1:"; }
body_is() { [ "$(body)" = "$1" ]; }
# Vary may come as several lines (file_server adds its own Accept-Encoding).
varies_by() { headers | grep -i '^vary:' | grep -Fqi "$1"; }
no_vary_by() { ! varies_by "$1"; }
body_matches() { body | grep -Eq "$1"; }
contains() { printf '%s\n' "$response" | grep -Fq "$1"; }
lacks() { ! contains "$1"; }

# check <description> <command...>: one line per check; a failure shows the response and fails the run at the end.
check() {
	description=$1
	shift
	if "$@"; then
		echo "ok   $description"
	else
		echo "FAIL $description"
		printf '%s\n' "$response" | sed 's/^/       /'
		failures=$((failures + 1))
	fi
}

echo "# production at the edge (plain VPS: no trusted proxies, no proxy secret)"
start_caddy --env SITE_ADDRESS=:80
get /
check '/ redirects by language' status_is 302
check '/ has no X-Robots-Tag' no_header X-Robots-Tag
get /robots.txt
check "robots.txt is the site's" body_is "$(printf 'User-agent: *\nAllow: /')"
check 'robots.txt has no X-Robots-Tag' no_header X-Robots-Tag
get /missing.txt
check 'a missing page is a 404' status_is 404
check 'the 404 has no X-Robots-Tag' no_header X-Robots-Tag
check 'the 404 is never cached' header_is Cache-Control no-store
check 'the 404 carries the security headers' header_is X-Content-Type-Options nosniff
# Without a language prefix: one 404 only, in the language of the first Accept-Language preference (the root rule).
check 'without Accept-Language the unprefixed 404 is the Spanish one only' body_is 'es 404 page'
check 'the unprefixed 404 varies by Accept-Language' varies_by Accept-Language
for language in en 'en-US,en;q=0.9' 'en-GB;q=0.8,es'; do
	for path in /missing.txt /admin-typo; do
		get "$path" -H "Accept-Language: $language"
		check "Accept-Language $language: $path is a 404" status_is 404
		check "Accept-Language $language: $path is the English 404 only" body_is 'en 404 page'
		check "Accept-Language $language: $path varies by Accept-Language" varies_by Accept-Language
	done
done
for language in es 'es-AR,en;q=0.9' fr 'fr,en'; do
	get /admin-typo -H "Accept-Language: $language"
	check "Accept-Language $language: /admin-typo is a 404" status_is 404
	check "Accept-Language $language: /admin-typo is the Spanish 404 only" body_is 'es 404 page'
	check "Accept-Language $language: /admin-typo varies by Accept-Language" varies_by Accept-Language
done
# Under a prefix the URL decides, whatever the browser prefers, and the response does not vary by it.
get /en/nope/ -H 'Accept-Language: es'
check '/en/nope/ is a 404' status_is 404
check '/en/nope/ is the English 404 even for a Spanish browser' body_is 'en 404 page'
check '/en/nope/ does not vary by Accept-Language' no_vary_by Accept-Language
get /es/nada/ -H 'Accept-Language: en'
check '/es/nada/ is a 404' status_is 404
check '/es/nada/ is the Spanish 404 even for an English browser' body_is 'es 404 page'
check '/es/nada/ does not vary by Accept-Language' no_vary_by Accept-Language
get / -H 'Accept-Language: en-US,en;q=0.9'
check 'an English browser at / goes to /en/' header_is Location /en/
get / -H 'Accept-Language: es-AR,en;q=0.9'
check 'a Spanish browser at / goes to /es/' header_is Location /es/
check '/ varies by Accept-Language' varies_by Accept-Language
get /api/echo -H "X-Forwarded-For: $forged"
check '/api reaches the API without X-Robots-Tag' no_header X-Robots-Tag
check 'a forged X-Forwarded-For is ignored: the API gets the connecting address' lacks "$forged"
check 'the API gets one address' body_matches '^xff=[0-9a-f.:]+ proto=http '
# Without PROXY_SECRET there is no gate: a client's X-Proxy-Secret is just a header, and it still stops at Caddy.
get /api/echo -H 'X-Proxy-Secret: stray'
check 'a stray X-Proxy-Secret is not refused' status_is 200
check 'a stray X-Proxy-Secret never reaches the API' body_matches '^xff=[0-9a-f.:]+ proto=http secret=$'

echo "# staging behind the proxy (Dokploy: trusted private ranges + proxy secret)"
start_caddy --env SITE_ADDRESS=:80 --env SITE_ENV=staging \
	--env 'CADDY_TRUSTED_PROXIES=trusted_proxies static private_ranges' --env "PROXY_SECRET=$secret"
for path in / /robots.txt /api/echo /missing.txt; do
	get "$path" -H "X-Forwarded-For: $forged"
	check "without the proxy secret $path is refused (403)" status_is 403
	check "without the proxy secret $path never reaches the API" lacks 'xff='
done
get /api/echo -H "X-Proxy-Secret: wrong-$secret" -H "X-Forwarded-For: $forged"
check 'a wrong proxy secret is refused (403)' status_is 403
get / -H "X-Proxy-Secret: $secret"
check 'through the proxy / redirects by language' status_is 302
check '/ says noindex, nofollow' header_is X-Robots-Tag 'noindex, nofollow'
get /robots.txt -H "X-Proxy-Secret: $secret"
check 'robots.txt disallows everything' body_is "$(printf 'User-agent: *\nDisallow: /')"
check 'robots.txt says noindex, nofollow' header_is X-Robots-Tag 'noindex, nofollow'
get /missing.txt -H "X-Proxy-Secret: $secret"
check 'a missing page is a 404' status_is 404
check 'the 404 says noindex, nofollow' header_is X-Robots-Tag 'noindex, nofollow'
get /api/echo -H "X-Proxy-Secret: $secret" -H "X-Forwarded-For: $forged" -H 'X-Forwarded-Proto: https'
check '/api says noindex, nofollow' header_is X-Robots-Tag 'noindex, nofollow'
check "the proxy's X-Forwarded-For and -Proto reach the API, and the secret does not" body_is "xff=$forged proto=https secret="
# Every request above sent the secret (or wrong-<secret>) and the access log records the request headers.
response=$(docker logs "$run-caddy" 2>&1)
check 'the access log records the requests and their headers' contains '"X-Forwarded-Proto":["https"]'
check 'the access log never carries the proxy secret' lacks "$secret"

echo "# production behind the proxy"
start_caddy --env SITE_ADDRESS=:80 --env SITE_ENV=production \
	--env 'CADDY_TRUSTED_PROXIES=trusted_proxies static private_ranges' --env "PROXY_SECRET=$secret"
get /
check 'without the proxy secret / is refused (403)' status_is 403
get / -H "X-Proxy-Secret: $secret"
check 'through the proxy / redirects by language' status_is 302
check '/ has no X-Robots-Tag' no_header X-Robots-Tag
get /robots.txt -H "X-Proxy-Secret: $secret"
check "robots.txt is the site's" body_is "$(printf 'User-agent: *\nAllow: /')"

echo "# a SITE_ENV that is neither production nor staging"
create_caddy --env SITE_ADDRESS=:80 --env SITE_ENV=prod
docker start "$run-caddy" >/dev/null
running() { [ "$(docker inspect --format '{{.State.Running}}' "$run-caddy")" = true ]; }
stopped() { ! running; }
for _ in 1 2 3 4 5 6 7 8 9 10; do
	running || break
	sleep 0.5
done
response=$(docker logs "$run-caddy" 2>&1)
check 'Caddy refuses to start' stopped
check 'it says why: no site-env-prod snippet' contains 'File to import not found: site-env-prod'

if [ "$failures" -gt 0 ]; then
	echo "$failures check(s) failed" >&2
	exit 1
fi
echo "all checks passed"
