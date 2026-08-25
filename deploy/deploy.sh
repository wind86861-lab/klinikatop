#!/usr/bin/env bash
#
# KlinikaTop — serverga yangilanish yuborish.
#
# Muhim tanlov: BUILD LOKAL MASHINADA bajariladi. Serverda 1 GB xotira bor
# va yonida banisa.uz ishlaydi — `tsc` va `vite build` u yerda ishga tushsa
# qo'shni sayt sekinlashadi. Serverga faqat tayyor natija boradi.
#
#   bash deploy/deploy.sh
set -euo pipefail

SERVER="${SERVER:-root@137.184.103.148}"
SSH_OPTS="-o StrictHostKeyChecking=no"
APP=/opt/klinikatop

echo "▸ Lokal tekshiruv"
npx tsc --noEmit -p server/tsconfig.json
npx tsc --noEmit -p webapp/tsconfig.json
npx tsx server/src/test/run.ts | tail -1

echo "▸ Build"
npm run build

echo "▸ Yuborish"
rsync -az --delete -e "ssh $SSH_OPTS" server/dist/  "$SERVER:$APP/dist/"
rsync -az --delete -e "ssh $SSH_OPTS" webapp/dist/  "$SERVER:$APP/webapp/"
rsync -az          -e "ssh $SSH_OPTS" package.json package-lock.json "$SERVER:$APP/"
rsync -az          -e "ssh $SSH_OPTS" server/package.json "$SERVER:$APP/server/"

echo "▸ Bog'liqliklar va migratsiya"
ssh $SSH_OPTS "$SERVER" bash -s <<'REMOTE'
set -e
cd /opt/klinikatop

# Zaxira nusxa — migratsiyadan OLDIN. Nimadir noto'g'ri ketsa qaytish mumkin.
systemctl start klinikatop-backup.service

npm ci --omit=dev --workspace=server --silent
chown -R klinikatop:klinikatop /opt/klinikatop/dist /opt/klinikatop/webapp

systemctl restart klinikatop
sleep 3
systemctl is-active klinikatop
curl -sf -o /dev/null -w 'API: %{http_code}\n' http://127.0.0.1:8791/api/health
REMOTE

echo "✓ Tayyor"
