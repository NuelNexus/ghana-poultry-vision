#!/usr/bin/env bash
# HTTPS certificate for using the app from other devices on the network (phones
# need HTTPS before the browser lets a page use the microphone).
#
# Makes a private certificate authority once (.certs/ca.crt), then a server
# certificate for this Pi's name and current IP addresses, signed by it. Re-run
# whenever the IP changes; the HTTPS service does that on every start. Install
# ca.crt on a phone once (https://<pi>:8443/poultrygrid-ca.crt) and the warning
# goes away for good, even after the server certificate is renewed.
#   bash scripts/make-cert.sh
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
DIR="${PG_CERT_DIR:-$REPO/.certs}"
mkdir -p "$DIR"
cd "$DIR"

if [[ ! -f ca.key ]]; then
  echo "==> New certificate authority"
  openssl req -x509 -new -nodes -newkey rsa:2048 -sha256 -days 3650 \
    -keyout ca.key -out ca.crt -subj "/CN=PoultryGrid local CA ($(hostname))" \
    -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign,cRLSign" 2>/dev/null
  chmod 600 ca.key
fi

host="$(hostname)"
sans="DNS:localhost,DNS:$host,DNS:$host.local,IP:127.0.0.1,IP:::1"
for ip in $(hostname -I); do sans="$sans,IP:$ip"; done

if [[ -f server.crt && -f server.sans && "$(cat server.sans)" == "$sans" ]] \
   && openssl x509 -checkend 2592000 -noout -in server.crt >/dev/null; then
  echo "Certificate is current ($sans)"
  exit 0
fi

echo "==> Server certificate for $sans"
openssl req -new -nodes -newkey rsa:2048 -keyout server.key -out server.csr -subj "/CN=$host" 2>/dev/null
# 825 days is the longest validity iPhones accept
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial -sha256 -days 825 -out server.crt \
  -extfile <(printf "subjectAltName=%s\nextendedKeyUsage=serverAuth\nkeyUsage=critical,digitalSignature,keyEncipherment\n" "$sans") 2>/dev/null
rm -f server.csr
chmod 600 server.key
echo "$sans" > server.sans
