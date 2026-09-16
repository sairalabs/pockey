-- Local fixture, mirrors packages/db/src/seed.ts (keep both in sync).
-- Apply with: pnpm --filter @pocketkey/api db:seed
INSERT OR IGNORE INTO developers (id, email, name)
VALUES ('dev_seed00000000000000000001', 'dev@pocketkey.local', 'Local Developer');

INSERT INTO apps (id, public_id, developer_id, name, slug, allowed_origins, config)
VALUES (
  'app_seed00000000000000000001',
  'pk_app_seed00000000000000000001',
  'dev_seed00000000000000000001',
  'Playground',
  'playground',
  '["http://localhost:3810","http://localhost:3800"]',
  '{"loginMethods":["email","google","apple","passkey","wallet"],"chains":{"evm":[8453,84532],"solana":["devnet"]},"appearance":{"theme":"system","accent":"#7c3aed"},"embeddedWallets":{"createOnLogin":"all"},"gasSponsoring":{"evm":false,"solana":false,"solanaDailyCapLamports":"0"}}'
)
ON CONFLICT(id) DO UPDATE SET allowed_origins = excluded.allowed_origins, config = excluded.config;

-- sha256('pk_sk_seed00000000000000000001')
INSERT OR IGNORE INTO api_keys (id, app_id, hash, prefix, name, scopes)
VALUES (
  'key_seed00000000000000000001',
  'app_seed00000000000000000001',
  '0c762d332206463027841f0d19b3ded80e5ba438dc18b9fad27f36e176d7ec8e',
  'pk_sk_seed00',
  'Local server key',
  '["server"]'
);

INSERT OR IGNORE INTO sponsor_balances (app_id, balance_cents) VALUES ('app_seed00000000000000000001', 0);
