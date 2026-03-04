#!/bin/sh
set -e

npm run prisma:generate
npx prisma migrate dev --name init --skip-generate
npm run dev
