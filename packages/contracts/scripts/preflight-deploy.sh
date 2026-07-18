#!/usr/bin/env bash
set -euo pipefail

: "${MONAD_RPC_URL:?MONAD_RPC_URL is required}"
: "${DEPLOYER_ACCOUNT:?DEPLOYER_ACCOUNT is required (Foundry keystore account name)}"
: "${VERIFIER_ADDRESS:?VERIFIER_ADDRESS is required}"

if [[ ! "$VERIFIER_ADDRESS" =~ ^0x[0-9a-fA-F]{40}$ ]] ||
  [[ "$VERIFIER_ADDRESS" == "0x0000000000000000000000000000000000000000" ]]; then
  echo "VERIFIER_ADDRESS must be a nonzero EVM address" >&2
  exit 1
fi

chain_id="$(cast chain-id --rpc-url "$MONAD_RPC_URL")"
if [[ "$chain_id" != "10143" ]]; then
  echo "Refusing deployment: expected Monad Testnet chain 10143, received $chain_id" >&2
  exit 1
fi

deployer_address="$(cast wallet address --account "$DEPLOYER_ACCOUNT")"
deployer_address_lower="$(printf '%s' "$deployer_address" | tr '[:upper:]' '[:lower:]')"
verifier_address_lower="$(printf '%s' "$VERIFIER_ADDRESS" | tr '[:upper:]' '[:lower:]')"
if [[ "$deployer_address_lower" == "$verifier_address_lower" ]]; then
  echo "Refusing deployment: deployer and verifier must be separate accounts" >&2
  exit 1
fi

deployer_code="$(cast code "$deployer_address" --rpc-url "$MONAD_RPC_URL")"
verifier_code="$(cast code "$VERIFIER_ADDRESS" --rpc-url "$MONAD_RPC_URL")"
if [[ "$deployer_code" != "0x" ]] || [[ "$verifier_code" != "0x" ]]; then
  echo "Refusing deployment: deployer and verifier must both be EOAs" >&2
  exit 1
fi

balance_wei="$(cast balance "$deployer_address" --rpc-url "$MONAD_RPC_URL")"
if [[ "$balance_wei" == "0" ]]; then
  echo "Refusing deployment: deployer has no test MON" >&2
  exit 1
fi

echo "Monad Testnet deployment preflight passed"
echo "Chain ID: $chain_id"
echo "Deployer: $deployer_address"
echo "Verifier: $VERIFIER_ADDRESS"
echo "Deployer balance: $(cast from-wei "$balance_wei") MON"
