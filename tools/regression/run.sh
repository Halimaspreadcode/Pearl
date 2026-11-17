#!/bin/bash
# Test de non-régression différentiel.
#
# Lance côte à côte une version de référence (BASELINE, un commit git) et le
# code courant, sur deux copies identiques de données de démo, puis compare :
#   api     112 réponses GET (JSON normalisé, PPTX/XLSX décompressés, PDF)
#   writes  une séquence de ~50 écritures : réponses puis fichiers de données
#   ui      le texte affiché et les nouvelles erreurs JS de chaque page (admin)
#
# Usage :
#   tools/regression/run.sh                 # tout, contre origin/main
#   BASELINE=<commit> tools/regression/run.sh api writes
#   PLAYWRIGHT_CORE=/chemin/playwright-core CHROME=/chemin/chrome tools/regression/run.sh ui
#
# Un écart n'est pas forcément une régression : une correction voulue en
# produit aussi. Le rapport montre l'endroit exact pour en juger.
set -u
DIR="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$DIR/../.." && pwd)"
export WORK="${WORK:-$DIR/.work}"
BASELINE="${BASELINE:-origin/main}"
export PO="${PO:-4001}" PN="${PN:-4002}"
export DA="$WORK/data-a" DB="$WORK/data-b"
PARTS="${*:-api writes ui}"
mkdir -p "$WORK"

# ── Garde-fou : jamais les vraies données ───────────────────────
# Le 27/09, un lien symbolique posé dans une copie de travail a fait écrire
# les données de démo dans le vrai data/. On refuse tout dossier de travail
# qui, liens résolus, tombe dans le data/ du dépôt principal.
MAIN_REPO="$(git -C "$REPO" worktree list --porcelain | sed -n '1s/^worktree //p')"
REAL_DATA="$(cd "$MAIN_REPO/data" 2>/dev/null && pwd -P)"
reel() { python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$1"; }
for d in "$WORK" "$WORK/seed" "$DA" "$DB"; do
  r="$(reel "$d")"
  if [ -n "$REAL_DATA" ] && { [ "$r" = "$REAL_DATA" ] || [[ "$r" == "$REAL_DATA"/* ]]; }; then
    echo "REFUS : $d pointe vers les vraies données ($REAL_DATA). Rien n'a été lancé." >&2
    exit 2
  fi
done
if [ -L "$REPO/data" ]; then
  echo "REFUS : $REPO/data est un lien symbolique. Copiez un jeu de démo à la place, ne liez jamais data/." >&2
  exit 2
fi

# ── Version de référence : une copie git (worktree) au commit demandé ──
REF="$(git -C "$REPO" rev-parse "$BASELINE")" || exit 2
if [ ! -d "$WORK/baseline" ]; then
  git -C "$REPO" worktree add -q --detach "$WORK/baseline" "$REF" || exit 2
else
  git -C "$WORK/baseline" checkout -q --detach "$REF" || exit 2
fi
[ -e "$WORK/baseline/node_modules" ] || ln -s "$REPO/node_modules" "$WORK/baseline/node_modules"

# ── Données de démo, préparées une fois ────────────────────────
if [ ! -d "$WORK/seed" ]; then
  (cd "$REPO" && node scripts/seed-demo.js --dir "$WORK/seed" >/dev/null) || exit 2
  # Jamais de vrai mail depuis un test : serveur SMTP injoignable, envoi désactivé.
  echo '{"smtp":{"host":"127.0.0.1","port":1,"user":"","pass":"","from":"test@local"},"groups":[{"id":"g1","name":"Test","emails":["t@local.test"]}],"schedules":[{"id":"s1","report":"daily","group_id":"g1","freq":"daily","hour":8,"minute":0,"enabled":false,"subject":"{report} {date}"}]}' > "$WORK/seed/mailing.json"
  # Quelques absences, pour couvrir les routes et le PDF d'absences.
  node -e "
    const cfg=require('$WORK/seed/config.json');const fo=cfg.fo_list||['Agent'];
    const T=['Congés payés','Maladie','RTT','Formation','Absence injustifiée','Maladie'];
    const S=['Validée','Validée','Demandée','Refusée'];const N=['Prévenu à l\'avance','Prévenu le jour même',''];
    let s=7;const r=()=>(s=(s*16807)%2147483647)/2147483647;const out=[];
    for(let i=0;i<24;i++){const f=new Date(Date.UTC(2026,Math.floor(r()*9),1+Math.floor(r()*25)));
      const t=new Date(f.getTime()+Math.floor(r()*4)*86400000);
      out.push({id:'abs-'+i,fo_name:fo[i%fo.length],type:T[i%T.length],date_from:f.toISOString().slice(0,10),
        date_to:t.toISOString().slice(0,10),status:S[i%S.length],notice:N[i%N.length],reason:'demo '+i,created_at:'2026-01-01T00:00:00Z'});}
    require('fs').writeFileSync('$WORK/seed/absences.json',JSON.stringify(out,null,1));"
fi

start() {
  lsof -ti:$PO,$PN | xargs kill 2>/dev/null; sleep 0.5
  rm -rf "$DA" "$DB" && cp -R "$WORK/seed" "$DA" && cp -R "$WORK/seed" "$DB"
  local HASH; HASH=$(cd "$REPO" && node -e "console.log(require('bcryptjs').hashSync('x',4))")
  (cd "$WORK/baseline" && PORT=$PO DATA_DIR="$DA" CONFIG_PW_HASH="$HASH" ABSENCE_PW_HASH="$HASH" SMTP_PASS= node server/index.js > "$WORK/old.log" 2>&1 &)
  (cd "$REPO" && PORT=$PN DATA_DIR="$DB" CONFIG_PW_HASH="$HASH" ABSENCE_PW_HASH="$HASH" SMTP_PASS= node server/index.js > "$WORK/new.log" 2>&1 &)
  for _ in $(seq 1 60); do
    curl -s "localhost:$PO/api/status" >/dev/null && curl -s "localhost:$PN/api/status" >/dev/null && return 0
    sleep 0.25
  done
  echo "Un des serveurs ne démarre pas — voir $WORK/old.log et $WORK/new.log"; return 1
}

rc=0
echo "Référence : $BASELINE ($(git -C "$REPO" log -1 --format='%h %s' "$REF"))"
for part in $PARTS; do
  start || exit 2
  case $part in api) f=compare-api.js;; writes) f=compare-writes.js;; ui) f=compare-ui.js;; *) echo "partie inconnue : $part"; exit 2;; esac
  node "$DIR/$f" | tail -"${TAIL:-40}"; [ "${PIPESTATUS[0]}" = 0 ] || rc=1
done
lsof -ti:$PO,$PN | xargs kill 2>/dev/null
echo "=== RÉSULTAT : $([ $rc = 0 ] && echo IDENTIQUE || echo ÉCARTS)"
exit $rc
