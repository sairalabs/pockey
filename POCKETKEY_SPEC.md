# Pocketkey : spécification technique v0.1

> Embedded wallets + auth pour indie devs et side projects web3. Usage-based dès le premier dollar, pas de falaise de prix.
> Ce document est la source de vérité pour les agents de dev. Toute décision non listée ici se prend en respectant les principes de la section 2, puis se documente dans `DECISIONS.md`.

---

## 1. Contexte et positionnement

- **Problème** : Privy passe de gratuit à 299 $/mois sans palier. Les devs indé, side projects et petites teams se retrouvent éjectés dès qu'ils dépassent le free tier.
- **Cible** : devs solo, hackathons, side projects, studios de 1 à 5 personnes. Gaming, TCG, rewards, consumer apps.
- **Promesse** : `npm i @pocketkey/react`, 3 hooks, un modal, wallets EVM + Solana, facturé à l'usage. Zéro minimum.
- **Ce qu'on n'est PAS** : pas un custodian, pas un concurrent enterprise de Privy/Dynamic. On délègue la sécurité des clés à un provider audité (Turnkey) et on vend le DX, l'UI et le pricing.
- **Modèle** : SDK open source (MIT), backend privé, hosted service payant.

## 2. Principes non négociables

1. **Jamais de clé privée dans notre infra.** Les clés vivent chez le key provider (Turnkey). Notre backend ne voit jamais de private key, seed, ou share.
2. **Tout provider externe est derrière une interface.** Key provider, DB, email, gas sponsoring : chacun a un port TypeScript et au moins une implémentation. Switcher un provider ne touche pas le domaine.
3. **Le moins cher qui marche.** Cloudflare Workers + D1 par défaut. On ne monte en gamme que sur signal réel.
4. **Le SDK est le produit.** Le DX du SDK et le modal UI sont prioritaires sur la richesse backend. Un hook mal nommé est un bug.
5. **Usage-based partout.** Aucun plan flat. Le coût du client suit sa croissance, le nôtre aussi.
6. **TypeScript strict de bout en bout.** Types partagés entre SDK et backend via un package `@pocketkey/types`.
7. **Pas de tirets longs (em dash) dans la doc, les commits, ni l'UI.**

## 3. Décisions prises

| Sujet              | Décision                                                                              | Pourquoi                                                      |
| ------------------ | ------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Key management     | Turnkey via abstraction `KeyProvider`                                                 | Audité, TEE, usage-based, API propre. Para en second candidat |
| Chains lancement   | EVM (viem) + Solana (@solana/web3.js)                                                 | Couvre 90 % de la cible                                       |
| Plateformes SDK    | Web (React) + React Native                                                            | Core JS partagé, wrappers par plateforme                      |
| Auth               | Better Auth (self-hosted, MIT)                                                        | Open source, tourne sur Workers, gère OTP/OAuth/passkeys      |
| Méthodes login MVP | Email OTP, Google, Apple, Passkeys, wallet externe (MetaMask, Phantom, WalletConnect) |                                                               |
| Scope wallet MVP   | Sign + send tx, session signers, gas sponsoring                                       |                                                               |
| Backend runtime    | Cloudflare Workers + Hono                                                             | Coût quasi nul, edge                                          |
| DB                 | D1 (SQLite) via Drizzle ORM                                                           | Gratuit, migrable vers Neon Postgres via Drizzle              |
| Billing            | Stripe usage-based (metered)                                                          |                                                               |
| Monorepo           | pnpm + Turborepo                                                                      |                                                               |
| Open source        | `packages/sdk-*` et `packages/types` en MIT. `apps/api` et `apps/dashboard` privés    |                                                               |
| Nom de travail     | Pocketkey (pocketkey.dev, pocketkey.so libres au 15/09/2026)                          |                                                               |

## 4. Architecture

```
                 ┌──────────────────────────────┐
                 │  App cliente (React / RN)    │
                 │  @pocketkey/react | /react-native
                 │  ┌────────────────────────┐  │
                 │  │ @pocketkey/core (JS)   │  │
                 │  │ - auth client          │  │
                 │  │ - wallet client        │  │
                 │  │ - session mgmt         │  │
                 │  └───────────┬────────────┘  │
                 └──────────────┼───────────────┘
                                │ HTTPS (JWT app-scoped)
                 ┌──────────────▼───────────────┐
                 │  apps/api (Hono on Workers)  │
                 │  - Better Auth               │
                 │  - Wallet service            │
                 │  - Session signer service    │
                 │  - Gas sponsor service       │
                 │  - Usage metering            │
                 │  - Admin API (dashboard)     │
                 └──┬─────────┬─────────┬───────┘
                    │         │         │
              ┌─────▼───┐ ┌───▼────┐ ┌──▼──────────┐
              │ D1 / DZ │ │Turnkey │ │ Paymaster / │
              │ (Drizzle)│ │(KeyProv│ │ Solana fee  │
              └─────────┘ └────────┘ │ payer       │
                                     └─────────────┘
                 ┌──────────────────────────────┐
                 │  apps/dashboard (Next.js)    │
                 │  apps, clés API, usage,      │
                 │  billing Stripe, config UI   │
                 └──────────────────────────────┘
```

### 4.1 Isolation du modal

Le modal d'auth/signature tourne dans un **iframe** servi depuis `embed.pocketkey.dev` (web) ou une WebView / écran natif (RN). Le token de session utilisateur vit dans l'iframe, jamais dans le contexte de l'app cliente. L'app cliente parle à l'iframe via `postMessage` typé. Ça évite qu'un XSS chez le client ne vole la session wallet.

### 4.2 Modèle multi-tenant

- Un **Developer** (compte dashboard) possède N **Apps**.
- Une **App** a un `appId` public, une `apiKey` secrète (server-side), un domaine autorisé, une config (méthodes login activées, chains, thème du modal, policies).
- Un **EndUser** appartient à une App. Un même email chez deux apps = deux EndUsers distincts. Pas de wallet partagé entre apps au MVP.
- Chaque EndUser a 0..N **Wallets** (un par chain family : `evm`, `solana`).

## 5. Monorepo

```
pocketkey/
├── apps/
│   ├── api/                # Hono + Workers. Privé.
│   ├── dashboard/          # Next.js 15, App Router. Privé.
│   ├── embed/              # Iframe UI (Vite + React). Servi sur embed.pocketkey.dev. Privé.
│   ├── docs/               # Fumadocs ou Mintlify. Public.
│   └── playground/         # App de démo consommant le SDK. Public.
├── packages/
│   ├── types/              # @pocketkey/types. Zod schemas + types. MIT.
│   ├── core/               # @pocketkey/core. Client JS sans UI. MIT.
│   ├── react/              # @pocketkey/react. Provider + hooks + modal web. MIT.
│   ├── react-native/       # @pocketkey/react-native. Provider + hooks + écrans natifs. MIT.
│   ├── chains-evm/         # Adapter viem. MIT.
│   ├── chains-solana/      # Adapter @solana/web3.js. MIT.
│   ├── key-provider/       # Interface KeyProvider + impl turnkey/. Privé.
│   ├── db/                 # Drizzle schema + migrations. Privé.
│   └── config/             # tsconfig, eslint, prettier partagés.
├── DECISIONS.md
├── CLAUDE.md               # Instructions agents (copie de la section 12)
└── turbo.json
```

Deux dépôts Git à terme (public `pocketkey-sdk`, privé `pocketkey`) synchronisés via `git subtree`. Au MVP : un seul repo privé, split au moment du lancement public.

## 6. Packages SDK : API publique

### 6.1 `@pocketkey/react`

```tsx
import { PocketkeyProvider, usePocketkey, useWallet, useSign } from '@pocketkey/react';

<PocketkeyProvider
  appId="pk_app_xxx"
  config={{
    loginMethods: ['email', 'google', 'apple', 'passkey', 'wallet'],
    chains: { evm: [base, arbitrum], solana: ['mainnet-beta'] },
    appearance: { theme: 'dark', accent: '#7c3aed', logo: '/logo.svg' },
    embeddedWallets: { createOnLogin: 'all' | 'evm' | 'solana' | 'off' },
  }}
>
  <App />
</PocketkeyProvider>;
```

```ts
// Auth
const { ready, authenticated, user, login, logout } = usePocketkey();
// login() ouvre le modal. login({ method: 'email', email }) skip le choix.

// Wallets
const { wallets, evm, solana, createWallet, exportWallet } = useWallet();
// evm: { address, chainId, switchChain, getProvider() } -> EIP-1193 provider
// solana: { publicKey, signTransaction, signMessage, sendTransaction }

// Signature (unifié)
const { signMessage, signTypedData, sendTransaction } = useSign();
await sendTransaction({ chain: 'evm', to, value, data, sponsored: true });

// Session signers
const { createSession, revokeSession, sessions } = useSessionSigners();
await createSession({
  chain: 'evm',
  policy: { maxValuePerTx: '0.01', allowedContracts: [addr], expiresIn: '7d' },
});
```

### 6.2 `@pocketkey/core`

Client sans UI. Tout ce que `react` fait, `core` le fait en impératif. Utilisé par `react`, `react-native`, et par les devs qui veulent leur propre UI.

```ts
const pk = createPocketkey({ appId, baseUrl? });
await pk.auth.loginWithEmail(email); await pk.auth.verifyOtp(code);
const w = await pk.wallets.list();
await pk.wallets.evm.sign({ ... });
```

### 6.3 `@pocketkey/react-native`

Même surface que `react`. Modal = bottom sheet natif (`@gorhom/bottom-sheet`) qui charge l'embed en WebView. Passkeys via `react-native-passkey`. Stockage session via `expo-secure-store` / Keychain.

### 6.4 Interop

- `evm.getProvider()` retourne un provider **EIP-1193**. Compatible wagmi via un connector `@pocketkey/wagmi` (post-MVP).
- `solana` expose l'interface **Wallet Standard**, compatible `@solana/wallet-adapter`.

## 7. Backend : `apps/api`

### 7.1 Stack

Hono, Cloudflare Workers, Drizzle + D1, Better Auth, Zod, Stripe SDK. Tests : Vitest + Miniflare.

### 7.2 Routes

```
POST   /v1/auth/*                     Better Auth (OTP, OAuth, passkeys)
POST   /v1/auth/wallet/nonce          Nonce pour SIWE / SIWS
POST   /v1/auth/wallet/verify         Vérifie signature, crée session

GET    /v1/me                          EndUser + wallets
POST   /v1/wallets                     Crée un wallet (chain family)
GET    /v1/wallets
POST   /v1/wallets/:id/sign-message
POST   /v1/wallets/:id/sign-typed-data
POST   /v1/wallets/:id/sign-transaction
POST   /v1/wallets/:id/send-transaction   sign + broadcast, sponsored optionnel
POST   /v1/wallets/:id/export             flow d'export (voir 8.4)

POST   /v1/sessions                    Crée un session signer (policy)
GET    /v1/sessions
DELETE /v1/sessions/:id
POST   /v1/sessions/:id/sign           Signature sous policy, sans interaction

GET    /v1/apps/:appId/config          Config publique (login methods, thème)

# Server-side (apiKey secrète)
POST   /v1/server/users/:id/wallets/:wid/sign   Signature déléguée avec session signer
GET    /v1/server/users
POST   /v1/server/webhooks/test

# Admin (dashboard, session developer)
CRUD   /admin/apps
GET    /admin/apps/:id/usage
POST   /admin/apps/:id/api-keys
GET    /admin/billing/portal
```

Toutes les routes `/v1/*` exigent un header `X-Pocketkey-App-Id`. Les routes user exigent un JWT EndUser (court, 15 min, refresh 30 j). Les routes `/v1/server/*` exigent `Authorization: Bearer pk_sk_xxx`.

### 7.3 KeyProvider (port)

```ts
export interface KeyProvider {
  createSubOrganization(input: {
    endUserId: string;
    auth: AuthCredential;
  }): Promise<{ subOrgId: string }>;
  createWallet(input: {
    subOrgId: string;
    curve: 'secp256k1' | 'ed25519';
  }): Promise<{ walletId: string; address: string; publicKey: string }>;
  signRaw(input: {
    subOrgId: string;
    walletId: string;
    payload: Uint8Array;
    encoding: 'hash' | 'raw';
  }): Promise<{ signature: Uint8Array }>;
  createPolicy(input: { subOrgId: string; policy: SigningPolicy }): Promise<{ policyId: string }>;
  deletePolicy(input: { subOrgId: string; policyId: string }): Promise<void>;
  exportWallet(input: {
    subOrgId: string;
    walletId: string;
    targetPublicKey: string;
  }): Promise<{ encryptedBundle: string }>;
}
```

Implémentation `packages/key-provider/src/turnkey/`. Toute méthode Turnkey-spécifique reste dans ce dossier. Le domaine ne dépend que de l'interface. Une implémentation `mock/` sert aux tests et au mode dev local.

### 7.4 Session signers

- Un session signer = une **policy Turnkey** attachée à la sub-org de l'EndUser + une clé API Turnkey dédiée que notre backend détient et utilise pour signer sous contrainte.
- Policy stockée chez Turnkey (enforcement) ET en miroir dans notre DB (affichage, révocation).
- Contraintes MVP : `expiresAt`, `maxValuePerTx`, `maxValueTotal`, `allowedContracts[]`, `allowedChains[]`, `allowedPrograms[]` (Solana).
- Notre backend vérifie la policy avant d'appeler Turnkey (fail fast), Turnkey re-vérifie (source de vérité).
- Révocation = suppression de la policy Turnkey + flag DB. Effet immédiat.

### 7.5 Gas sponsoring

Port `GasSponsor` avec deux implémentations :

- **EVM** : ERC-4337 via un bundler/paymaster tiers (Pimlico ou Alchemy). Le wallet embarqué devient signer d'un smart account (Kernel ou Safe). Au MVP : EOA par défaut, smart account uniquement si `sponsored: true` est demandé sur l'app. Documenter clairement les deux adresses.
- **Solana** : fee payer = un keypair Pocketkey par app (chez Turnkey, sub-org système). On co-signe la tx. Limites par app (SOL/jour) configurables dans le dashboard.

Le sponsoring est **prépayé** : le dev charge un solde (Stripe), on décrémente à l'usage avec marge. Jamais de sponsoring à découvert.

### 7.6 Usage metering

Événements : `wallet.created`, `user.active` (première action du mois), `tx.signed`, `tx.sponsored` (avec montant gas), `session.signed`.

Table `usage_events` en append-only, agrégée par `(appId, month)` via cron Workers toutes les heures. Envoi à Stripe Meters chaque nuit.

## 8. Sécurité

### 8.1 Menaces couvertes

| Menace                  | Mitigation                                                                |
| ----------------------- | ------------------------------------------------------------------------- |
| XSS chez l'app cliente  | Iframe isolée, session dans l'iframe, `postMessage` avec origin check     |
| Vol de clé API dev      | Clés hashées en DB, scope par app, rotation, rate limit                   |
| Notre backend compromis | Ne détient aucune clé. Les session signers sont bornés par policy Turnkey |
| Phishing OTP            | OTP 6 chiffres, 10 min, 5 essais, lié au device fingerprint               |
| Replay                  | Nonces SIWE/SIWS one-shot, JWT courts                                     |
| Abus gas sponsoring     | Budget par app, rate limit par EndUser, policy allowlist                  |

### 8.2 Non couvert au MVP (à documenter publiquement)

- Pas de 2FA sur le compte developer (V2).
- Pas de recovery social. Recovery = même méthode de login (email/OAuth/passkey).
- Pas d'audit externe. On s'appuie sur ceux de Turnkey. Le dire explicitement sur la landing.

### 8.3 Secrets

Wrangler secrets uniquement. Jamais de `.env` commité. Liste : `TURNKEY_API_PUBLIC_KEY`, `TURNKEY_API_PRIVATE_KEY`, `TURNKEY_ORG_ID`, `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_*`, `APPLE_*`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`, `PIMLICO_API_KEY`.

### 8.4 Export de wallet

Obligatoire pour la confiance. Flow : l'EndUser génère une keypair éphémère côté client (dans l'iframe), envoie la clé publique, Turnkey chiffre le bundle vers cette clé, le client déchiffre localement. Notre backend ne voit que du chiffré.

## 9. Données (Drizzle, D1)

```ts
developers        id, email, name, stripeCustomerId, createdAt
apps              id, developerId, name, slug, allowedOrigins[], config(json), createdAt
api_keys          id, appId, hash, prefix, scopes[], lastUsedAt, revokedAt
end_users         id, appId, keyProviderSubOrgId, createdAt, lastActiveAt
end_user_identities id, endUserId, type('email'|'google'|'apple'|'passkey'|'wallet'), identifier, verifiedAt
wallets           id, endUserId, chainFamily('evm'|'solana'), address, keyProviderWalletId, smartAccountAddress?, createdAt
sessions_signers  id, walletId, keyProviderPolicyId, policy(json), expiresAt, revokedAt, createdAt
usage_events      id, appId, endUserId?, type, amount?, meta(json), createdAt
usage_monthly     appId, month, activeUsers, walletsCreated, txSigned, gasSponsoredWei, gasSponsoredLamports
sponsor_balances  appId, balanceCents, updatedAt
webhooks          id, appId, url, secret, events[]
```

Better Auth gère ses propres tables (`user`, `session`, `account`, `verification`, `passkey`) avec un préfixe `ba_`.

## 10. Dashboard : `apps/dashboard`

Next.js 15, Tailwind, shadcn/ui. Pages MVP :

1. `/login` : Better Auth (email OTP + GitHub OAuth pour les devs).
2. `/apps` : liste, création.
3. `/apps/[id]` : config (login methods, chains, thème live preview du modal), origines autorisées.
4. `/apps/[id]/keys` : clés API, rotation.
5. `/apps/[id]/users` : liste EndUsers, wallets, sessions actives.
6. `/apps/[id]/usage` : graphes MAW, tx, gas.
7. `/apps/[id]/sponsoring` : solde, recharge Stripe, limites.
8. `/billing` : Stripe customer portal.

## 11. Pricing (à valider avec les coûts réels Turnkey)

- **Free** : 500 MAW / mois, toutes features.
- **Pay as you go** : 0,06 $ / MAW au-delà. Minimum 0 $.
- **Gas sponsoring** : prépayé, coût réel + 15 %.
- **Session signers** : inclus.

Hypothèse de marge : coût Turnkey estimé 0,02 à 0,03 $ / wallet actif. **À vérifier avec la grille Turnkey en vigueur avant de figer le prix.** Si le coût dépasse 0,04 $, passer à 0,08 $ / MAW.

Vérification à faire aussi : le free tier de Turnkey et ses limites de requêtes, pour savoir combien de MAW on absorbe gratuitement avant de payer nous-mêmes.

## 12. Instructions pour les agents (à copier dans `CLAUDE.md`)

```
Tu travailles sur Pocketkey, un SDK d'embedded wallets. Lis POCKETKEY_SPEC.md avant toute tâche.

Règles :
- TypeScript strict. Pas de `any`. Zod pour toute entrée externe.
- Aucune clé privée, seed ou share ne transite par notre code. Si une tâche semble l'exiger, arrête-toi et demande.
- Tout appel à un service externe passe par une interface dans packages/ (KeyProvider, GasSponsor, Mailer, Db). N'importe jamais le SDK Turnkey en dehors de packages/key-provider/src/turnkey/.
- Chaque route API a un schema Zod d'entrée et de sortie, et un test Vitest.
- Les packages publics (types, core, react, react-native, chains-*) ne dépendent d'aucun package privé.
- Conventional commits. Une PR = une tâche de la roadmap.
- Pas de tirets longs (em dash) nulle part.
- Quand une décision n'est pas dans la spec : choisis la solution la moins chère et la plus simple, note-la dans DECISIONS.md avec la date et la raison.
- Ne modifie jamais le pricing, les policies de sécurité ou l'interface KeyProvider sans le signaler explicitement.
```

## 13. Roadmap en tâches agent

Chaque tâche est autonome, testable, et tient dans une session d'agent. Ordre = dépendances.

### Phase 0 : fondations (semaine 1)

- [x] **T0.1** Init monorepo pnpm + Turborepo, packages `config`, `types`. Lint, prettier, tsconfig strict, CI GitHub Actions (typecheck + test).
- [x] **T0.2** `packages/db` : schema Drizzle section 9, migrations D1, script de seed, adapter Better Auth.
- [x] **T0.3** `apps/api` : Hono skeleton sur Workers, middleware `appId`, error handling unifié, healthcheck, Miniflare tests.
- [x] **T0.4** `packages/key-provider` : interface + impl `mock`. Tests.
- [ ] **T0.5** `packages/key-provider/turnkey` : impl réelle (createSubOrg, createWallet secp256k1 + ed25519, signRaw). Tests contre Turnkey sandbox.

### Phase 1 : auth (semaine 2)

- [x] **T1.1** Better Auth dans `apps/api` : email OTP (Resend), Google, Apple. Multi-tenant par appId.
- [x] **T1.2** Passkeys via plugin Better Auth. Test WebAuthn en Miniflare avec mocks.
- [x] **T1.3** Login wallet externe : SIWE (EVM) + SIWS (Solana). Routes nonce/verify.
- [x] **T1.4** JWT EndUser (access 15 min, refresh 30 j), rotation, révocation.
- [x] **T1.5** Route `/v1/apps/:appId/config` publique + cache edge.

### Phase 2 : wallets (semaine 3)

- [x] **T2.1** `packages/chains-evm` : adapter viem. sign message, typed data, tx. Chains : Base, Arbitrum, Ethereum, Polygon.
- [x] **T2.2** `packages/chains-solana` : adapter. sign message, tx, versioned tx.
- [x] **T2.3** Service wallets `apps/api` : création à la login (config `createOnLogin`), routes sign-*, send-transaction avec broadcast RPC (Alchemy/Helius, clés par app ou fallback Pocketkey).
- [x] **T2.4** Export wallet (section 8.4).
- [x] **T2.5** Usage events : émission sur chaque action, table + cron d'agrégation.

### Phase 3 : SDK web (semaine 4)

- [ ] **T3.1** `packages/core` : client HTTP typé, gestion session, auth, wallets. Tests unitaires.
- [ ] **T3.2** `apps/embed` : iframe UI. Écrans : choix méthode, email OTP, OAuth redirect, passkey, wallet externe, confirmation signature, export. Thémable via config. `postMessage` protocol typé dans `types`.
- [ ] **T3.3** `packages/react` : Provider, `usePocketkey`, `useWallet`, `useSign`, modal wrapper iframe. EIP-1193 provider. Wallet Standard Solana.
- [ ] **T3.4** `apps/playground` : app Next.js qui exerce tout le SDK. Sert de test E2E (Playwright).

### Phase 4 : session signers + gas (semaine 5)

- [ ] **T4.1** Policies Turnkey : mapping `SigningPolicy` -> policy Turnkey. Création, suppression.
- [ ] **T4.2** Routes sessions + `/v1/server/*` signature déléguée. Vérification locale avant Turnkey.
- [ ] **T4.3** `useSessionSigners` dans react/core.
- [ ] **T4.4** `GasSponsor` port + impl Solana (fee payer par app, budget).
- [ ] **T4.5** `GasSponsor` impl EVM : ERC-4337 via Pimlico, smart account Kernel, `sponsored: true` sur sendTransaction.
- [ ] **T4.6** Prépaiement sponsoring : Stripe checkout, `sponsor_balances`, décrément à l'usage.

### Phase 5 : dashboard + billing (semaine 6)

- [ ] **T5.1** `apps/dashboard` : auth dev, CRUD apps, clés API.
- [ ] **T5.2** Config app avec preview live du modal.
- [ ] **T5.3** Pages users, usage (graphes), sponsoring.
- [ ] **T5.4** Stripe : customer, meters, subscription usage-based, portal, webhooks.
- [ ] **T5.5** Rate limiting par app et par EndUser (Workers KV ou Durable Objects).

### Phase 6 : React Native (semaines 7 et 8)

- [ ] **T6.1** `packages/react-native` : Provider, hooks, bottom sheet WebView chargeant embed.
- [ ] **T6.2** Passkeys natives (react-native-passkey), secure storage session.
- [ ] **T6.3** OAuth via `expo-auth-session`, deep links.
- [ ] **T6.4** App exemple Expo dans `apps/playground-rn`.

### Phase 7 : lancement (semaine 9)

- [ ] **T7.1** `apps/docs` : quickstart React, quickstart RN, référence hooks, guide migration depuis Privy.
- [ ] **T7.2** Split repo public `pocketkey-sdk`, publish npm sous `@pocketkey/*`.
- [ ] **T7.3** Landing page pocketkey.dev : pitch, pricing calculator vs Privy, demo live.
- [ ] **T7.4** Post de lancement : "Privy m'a coûté 299 $ pour 600 users".

## 14. Post-MVP (ne pas implémenter sans demande)

- Connector wagmi officiel.
- 2FA developer, recovery social.
- Webhooks (user.created, wallet.created, tx.sent).
- Bitcoin, Cosmos, Sui.
- Provider Para en second KeyProvider.
- Migration D1 vers Neon Postgres.
- Wallet partagé cross-apps (identité Pocketkey globale).
- Self-hosting du backend (licence commerciale).

## 15. Questions ouvertes

1. Grille tarifaire Turnkey exacte : impacte le prix MAW (section 11).
2. Smart account EVM par défaut ou EOA ? EOA au MVP pour la simplicité, mais deux adresses par user si sponsoring activé. À trancher après retours playground.
3. Résidence des données : D1 est global. Si un client EU l'exige, migrer vers Neon EU. Pas au MVP.
4. Nom définitif : Pocketkey ou autre. Acheter `pocketkey.dev` et `pocketkey.so` maintenant, ça coûte rien.
