#!/bin/sh
set -e

npm run prisma:generate
npm run prisma:deploy
npm run start
