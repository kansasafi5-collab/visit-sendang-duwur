#!/bin/sh
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Node.js belum terpasang. Unduh versi LTS di https://nodejs.org"; exit 1; }
npm install || exit 1
echo "Situs berjalan di http://localhost:3000 (Ctrl+C untuk berhenti)"
npm start
