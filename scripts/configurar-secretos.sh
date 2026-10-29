#!/usr/bin/env bash
# Carga los secretos de las Edge Functions de SuenaBA en Supabase SIN mostrarlos en pantalla.
#
# Requisitos: Supabase CLI instalada y con sesión iniciada (`supabase login`), Node (para generar claves VAPID).
# Uso:        bash scripts/configurar-secretos.sh            (pregunta lo que falta)
#             bash scripts/configurar-secretos.sh --dry-run  (muestra qué haría, sin cambiar nada)
# Variables opcionales (evitan la pregunta): SUPABASE_PROJECT_REF APP_URL CONTACT_EMAIL RESEND_API_KEY EMAIL_FROM
#             MP_ACCESS_TOKEN MP_WEBHOOK_SECRET MP_SANDBOX ROTATE_VAPID=1 ROTATE_WORKER=1 NO_PROMPT=1
# Lo que deja listo: WORKER_SECRET, claves VAPID (push), APP_URL, Resend y Mercado Pago (si los pasás).
# Al final imprime (1) la clave pública VAPID para el front y (2) un SQL para pegar en el SQL Editor de Supabase.
set -euo pipefail

REF="${SUPABASE_PROJECT_REF:-dncmdvxcxizbcjacpkoe}"
SB="${SUPABASE_BIN:-supabase}"
NPX="${NPX_BIN:-npx}"
DRY=0; [ "${1:-}" = "--dry-run" ] && DRY=1

command -v "$SB" >/dev/null 2>&1 || { echo "No encuentro la Supabase CLI ('$SB'). Instalala: https://supabase.com/docs/guides/cli" >&2; exit 1; }
command -v openssl >/dev/null 2>&1 || { echo "Falta openssl para generar el secreto del worker." >&2; exit 1; }

ask() { # ask VARIABLE "pregunta" [secreto]
  local var="$1" prompt="$2" secret="${3:-}" v=""
  [ -n "${!var:-}" ] && return 0
  [ "${NO_PROMPT:-0}" = "1" ] && return 0
  if [ -n "$secret" ]; then read -r -s -p "$prompt (Enter para omitir): " v; echo; else read -r -p "$prompt (Enter para omitir): " v; fi
  printf -v "$var" '%s' "$v"
}

echo "Proyecto Supabase: $REF"
ask APP_URL "URL pública de la app (ej. https://suenaba.netlify.app)"
[ -n "${APP_URL:-}" ] || { echo "APP_URL es obligatoria (la usan los links de los emails y el regreso de Mercado Pago)." >&2; exit 1; }
case "$APP_URL" in https://*) ;; *) echo "APP_URL debe empezar con https://" >&2; exit 1;; esac
ask CONTACT_EMAIL "Email de contacto para las notificaciones push"
ask RESEND_API_KEY "Resend API key" secret
ask EMAIL_FROM "Remitente de los emails (ej. SuenaBA <avisos@tudominio.com>)"
ask MP_ACCESS_TOKEN "Mercado Pago Access Token" secret
ask MP_WEBHOOK_SECRET "Mercado Pago clave secreta del webhook" secret
MP_SANDBOX="${MP_SANDBOX:-true}"

EXISTING="$("$SB" secrets list --project-ref "$REF" 2>/dev/null || true)"
has() { printf '%s' "$EXISTING" | grep -q "$1"; }

# --- secreto compartido de los workers
WORKER_NEW=0
if [ -n "${WORKER_SECRET:-}" ] || [ "${ROTATE_WORKER:-0}" = "1" ] || ! has WORKER_SECRET; then
  WORKER_SECRET="${WORKER_SECRET:-$(openssl rand -hex 24)}"; WORKER_NEW=1
fi

# --- claves VAPID (cambiarlas invalida los dispositivos que ya activaron avisos, por eso no se regeneran solas)
VAPID_NEW=0
if [ -n "${VAPID_PUBLIC_KEY:-}" ] && [ -n "${VAPID_PRIVATE_KEY:-}" ]; then VAPID_NEW=1
elif [ "${ROTATE_VAPID:-0}" = "1" ] || ! has VAPID_PRIVATE_KEY; then
  JSON="$("$NPX" --yes web-push generate-vapid-keys --json)"
  VAPID_PUBLIC_KEY="$(printf '%s' "$JSON" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).publicKey))')"
  VAPID_PRIVATE_KEY="$(printf '%s' "$JSON" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).privateKey))')"
  VAPID_NEW=1
else
  echo "Las claves VAPID ya existen: no se tocan (usá ROTATE_VAPID=1 para cambiarlas; los dispositivos deberán reactivar los avisos)."
fi

ARGS=("APP_URL=$APP_URL")
[ "$WORKER_NEW" = "1" ] && ARGS+=("WORKER_SECRET=$WORKER_SECRET")
if [ "$VAPID_NEW" = "1" ]; then ARGS+=("VAPID_PUBLIC_KEY=$VAPID_PUBLIC_KEY" "VAPID_PRIVATE_KEY=$VAPID_PRIVATE_KEY" "VAPID_SUBJECT=mailto:${CONTACT_EMAIL:-contacto@example.com}"); fi
[ -n "${RESEND_API_KEY:-}" ] && ARGS+=("RESEND_API_KEY=$RESEND_API_KEY")
[ -n "${EMAIL_FROM:-}" ] && ARGS+=("EMAIL_FROM=$EMAIL_FROM")
[ -n "${MP_ACCESS_TOKEN:-}" ] && ARGS+=("MP_ACCESS_TOKEN=$MP_ACCESS_TOKEN")
[ -n "${MP_WEBHOOK_SECRET:-}" ] && ARGS+=("MP_WEBHOOK_SECRET=$MP_WEBHOOK_SECRET")
[ -n "${MP_ACCESS_TOKEN:-}${MP_WEBHOOK_SECRET:-}" ] && ARGS+=("MP_SANDBOX=$MP_SANDBOX")

echo; echo "Se cargarán estos secretos (solo los nombres):"; for a in "${ARGS[@]}"; do echo "  - ${a%%=*}"; done
if [ "$DRY" = "1" ]; then echo; echo "(--dry-run: no se cambió nada)"; exit 0; fi
"$SB" secrets set --project-ref "$REF" "${ARGS[@]}" >/dev/null
echo "Listo: secretos cargados."

[ -z "${RESEND_API_KEY:-}" ] && echo "AVISO: no cargaste RESEND_API_KEY: los emails no se enviarán (el push y la bandeja siguen)."
[ -z "${MP_ACCESS_TOKEN:-}" ] && echo "AVISO: no cargaste MP_ACCESS_TOKEN: Mercado Pago no funcionará (el pago simulado sigue)."

echo
if [ "$VAPID_NEW" = "1" ]; then
  echo "== 1) Variable del front (Netlify / hosting): VITE_VAPID_PUBLIC_KEY"
  echo "   $VAPID_PUBLIC_KEY"
  echo
fi
if [ "$WORKER_NEW" = "1" ]; then
cat <<SQL
== 2) Pegá esto en el SQL Editor de Supabase (programa el envío de avisos y reembolsos):
do \$\$ declare sid uuid; begin
  select id into sid from vault.secrets where name = 'worker_secret';
  if sid is null then perform vault.create_secret('$WORKER_SECRET', 'worker_secret'); else perform vault.update_secret(sid, '$WORKER_SECRET'); end if;
end \$\$;
select cron.schedule('suenaba-avisos', '* * * * *', \$c\$ select net.http_post(
  url := 'https://$REF.supabase.co/functions/v1/notify-worker',
  headers := jsonb_build_object('x-worker-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'worker_secret'))) \$c\$);
select cron.schedule('suenaba-reembolsos', '*/5 * * * *', \$c\$ select net.http_post(
  url := 'https://$REF.supabase.co/functions/v1/process-refunds',
  headers := jsonb_build_object('x-worker-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'worker_secret'))) \$c\$);
SQL
fi
echo
echo "== 3) Mercado Pago > Webhooks: URL https://$REF.supabase.co/functions/v1/mp-webhook  (evento: Pagos)"
