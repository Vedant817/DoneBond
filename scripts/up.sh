#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> 1. Checking database configuration..."
echo "   DoneBond uses a hosted Supabase Postgres project, not a local Docker database."
echo "   Create one at https://supabase.com and paste its direct connection string"
echo "   (Project Settings -> Database -> Connection string -> URI, port 5432) into"
echo "   DATABASE_URL in .env before continuing."

echo "==> 2. Generating .env (if missing)..."
if [ ! -f .env ]; then
  AUTH_SECRET=$(node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64url'))")
  CLI_TOKEN_SECRET=$(node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64url'))")
  VERIFIER_KEY=$(node -e "
    const { randomBytes } = require('crypto');
    process.stdout.write('0x' + randomBytes(32).toString('hex'))
  ")
  cp .env.example .env
  if [[ "$OSTYPE" == "darwin"* ]]; then
    sed -i '' "s|^AUTH_SECRET=$|AUTH_SECRET=$AUTH_SECRET|" .env
    sed -i '' "s|^CLI_TOKEN_SECRET=$|CLI_TOKEN_SECRET=$CLI_TOKEN_SECRET|" .env
    sed -i '' "s|^VERIFIER_PRIVATE_KEY=$|VERIFIER_PRIVATE_KEY=$VERIFIER_KEY|" .env
  else
    sed -i "s|^AUTH_SECRET=$|AUTH_SECRET=$AUTH_SECRET|" .env
    sed -i "s|^CLI_TOKEN_SECRET=$|CLI_TOKEN_SECRET=$CLI_TOKEN_SECRET|" .env
    sed -i "s|^VERIFIER_PRIVATE_KEY=$|VERIFIER_PRIVATE_KEY=$VERIFIER_KEY|" .env
  fi
  echo "   Created .env with random secrets"
fi

echo "==> 3. Checking DATABASE_URL is set..."
if ! grep -q '^DATABASE_URL=.\+' .env 2>/dev/null; then
  echo "   WARNING: DATABASE_URL is empty in .env — paste your Supabase connection"
  echo "   string before running migrations, or the next step will fail."
fi

echo "==> 4. Installing dependencies..."
pnpm install --frozen-lockfile 2>/dev/null || pnpm install

echo "==> 5. Running database migrations..."
if ! pnpm db:migrate; then
  echo "   ERROR: Migration failed — check DATABASE_URL in .env"
  exit 1
fi

echo ""
echo "============================================"
echo "  DoneBond is ready!"
echo "  Run:  pnpm dev"
echo "  or:   pnpm --filter @donebond/web dev"
echo "============================================"
