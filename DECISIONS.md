# Decisions

Journal des décisions non couvertes par `POCKETKEY_SPEC.md`. Une entrée = date, décision, raison.

## 2026-09-15

- **Next.js 16 pour le dashboard** (spec : 15). Version stable courante, supportée par Better Auth et Vercel. Aucun code de la spec ne dépend d'une API retirée en 16.
- **Zod 4** partout. Version courante, plus rapide, API `z.object` inchangée pour nos usages. Les schémas `@pocketkey/types` sont la seule source des types partagés (`z.infer`).
- **TypeScript 5.9.3** plutôt que 7.x. TS 7 est le port natif, la chaîne d'outils (eslint, tsup, next) n'est pas encore alignée. À réévaluer.
- **Vitest 4.x** (et non 5) parce que `@cloudflare/vitest-pool-workers` exige `^4.1`. Une seule version de Vitest dans le monorepo.
- **Identifiants** : cuid2 préfixés par type (`dev_`, `app_`, `usr_`, `wlt_`, `ses_`, `key_`, `evt_`). L'`appId` public exposé au SDK est `pk_app_<cuid2>`, la clé secrète `pk_sk_<cuid2>` (seul le hash SHA-256 est stocké, plus le préfixe pour l'affichage).
- **Primitives UI du dashboard** : `@base-ui-components/react` (headless) + composants maison stylés en Tailwind 4, au lieu du CLI shadcn. Même philosophie (composants copiés dans le repo), moins de dépendances Radix, `--transform-origin` natif pour les popovers.
- **Motion** : `motion` (ex framer-motion) dans le dashboard uniquement pour les transitions d'icônes et les entrées mises en scène. Tout le reste en transitions CSS.
- **Tailwind 4** avec tokens en `@theme` (CSS variables), pas de `tailwind.config.js`.
- **Package `@pocketkey/config`** : contient uniquement les tsconfig partagés et la config ESLint flat. Prettier est configuré à la racine.
- **D1 local** : `wrangler d1 migrations apply --local` sur les migrations générées par `drizzle-kit generate`. Pas de `drizzle-kit push` (D1 ne le supporte pas proprement).
- **Ordre d'exécution phase 0** : T0.1 → T0.2 → T0.3 → T0.4 dans cette session, T0.5 (Turnkey réel) attend des clés sandbox.
- **Node 24 (nvm) obligatoire** : Wrangler 4.132 refuse Node 20. `.nvmrc` = 24, `engines.node >= 22`, CI sur Node 24.
- **`compatibility_date` 2026-08-15** dans `wrangler.jsonc` : le binaire workerd embarqué par Miniflare 5.20260815 ne connaît pas de date plus récente. À avancer quand Miniflare est mis à jour.
- **Vitest pool workers 0.22** : nouvelle API plugin (`cloudflareTest()` dans `plugins`, `readD1Migrations` depuis la racine du package, `env` depuis `cloudflare:workers`). `defineWorkersConfig` et `/config` n'existent plus.
- **Générateur cuid2 initialisé paresseusement** (`packages/db/src/ids.ts`) : workerd interdit tout tirage aléatoire au chargement du module, `init()` de cuid2 en fait un. Les tests passaient, `wrangler dev` plantait au boot.
- **Route `/v1/apps/:appId/config` livrée avec T0.3** (forme finale, sans cache edge). T1.5 ajoute uniquement le cache.
- **CORS** : reflète l'origine appelante et laisse `requireApp` appliquer l'allowlist par app, pour que le navigateur reçoive une erreur documentée (`origin_not_allowed`) plutôt qu'un échec CORS opaque.

## 2026-09-16

- **Turnkey simulé** jusqu'à obtention des clés sandbox (demande de Medhy). `MOCK_KEY_SEED` dérive les clés du mock (HMAC-SHA256 seed + walletId), donc les wallets stockés en D1 survivent à un redémarrage de `wrangler dev`. Refusé en production par la validation d'env.
- **Better Auth multi-tenant par adaptateur** : un seul pool Better Auth ne convient pas (section 4.2). `apps/api/src/auth/tenant-adapter.ts` enveloppe l'adaptateur Drizzle : filtre `appId` en AND sur le modèle `user`, préfixe `appId|binding|` sur les identifiants `verification`. Une instance Better Auth par requête (pas d'I/O à la construction). Les sessions, comptes et passkeys dépendent de l'id user, déjà isolé ; l'échange de session revérifie `appId`.
- **Liaison OTP à l'appareil** (section 8.1) : en-tête `X-Pocketkey-Device` (id aléatoire généré dans l'iframe), haché et inclus dans l'identifiant de l'OTP. Limite assumée : ça empêche d'utiliser un code depuis un autre navigateur, pas un phishing où la victime tape le code dans la page de l'attaquant. OTP stocké haché, 6 chiffres, 10 min, 5 essais.
- **Pont de cookies** : l'iframe est un contexte tiers où Safari bloque les cookies. L'API recopie les `Set-Cookie` de Better Auth dans `X-Pocketkey-Auth-Cookies` et les réinjecte côté serveur. Les valeurs restent dans l'origine de l'iframe, qui détient déjà les jetons.
- **OAuth en popup first-party** : `/v1/auth/oauth/:appId/:provider/start` ouvre le flux sur l'origine de l'API (cookies réels), l'état OAuth est associé à l'app dans `auth_challenges` pour que le callback unique `/v1/auth/callback/:provider` retrouve son tenant, puis `/complete` poste un code à usage unique (2 min) à l'iframe par `postMessage`, échangé contre des jetons. Google et Apple ne sont testés que jusqu'à la redirection (pas d'appel réseau en test).
- **Allowlist Better Auth** : seuls les endpoints OTP (type `sign-in` uniquement), passkeys, `get-session` et `sign-out` sont exposés. Mots de passe, update et delete user restent fermés.
- **Jetons Pocketkey** : access JWT HS256 15 min, clé dérivée de `BETTER_AUTH_SECRET` par HKDF (aucun secret Wrangler ajouté). Refresh opaque `pk_rt_` 30 j, SHA-256 en D1, rotation atomique (UPDATE conditionnel) et révocation de toute la famille en cas de rejeu. Chaque requête authentifiée vérifie que la famille n'est pas révoquée, donc le logout est immédiat.
- **Une table `auth_challenges`** pour les nonces SIWE/SIWS, états OAuth et codes d'échange, consommation atomique. Le nonce est consommé avant la vérification de signature : une seule tentative par nonce.
- **Identité wallet** : identifiant `evm:<adresse minuscule>` ou `solana:<base58>`. Un login email puis SIWE de la même personne donne deux end users au MVP (pas de liaison de comptes).
- **`@solana/web3.js` retiré du runtime** de `@pocketkey/chains-solana` (reste en devDependency pour les tests comparatifs). v1 tire borsh, jayson, rpc-websockets, casse sous vitest-pool-workers et alourdirait le bundle navigateur du SDK. Codec binaire écrit à la main (legacy + v0 + lookup tables), RPC en JSON-RPC via fetch. Écart assumé avec la section 3 de la spec.
- **RPC** : variable `RPC_URLS` (JSON, à poser en secret car elle peut contenir des clés Alchemy/Helius), repli sur les RPC publics en dev. Factory injectable pour les tests.
- **Cache edge de la config** (T1.5) : la ligne `apps` est mise en cache 60 s via la Cache API dans `requireApp`, invalidée par `invalidateApp`. L'allowlist d'origines est toujours appliquée. Les ids inconnus ne sont jamais mis en cache.
- **Origine de l'iframe** (`EMBED_ORIGIN`) acceptée pour toutes les apps en plus de leur allowlist, et utilisée comme RP ID des passkeys.
- **Agrégation d'usage** : cron horaire qui recalcule le mois courant et le précédent (idempotent), sommes de gas en BigInt pour éviter le dépassement 64 bits de SQLite.
- **Seed Playground** : toutes les méthodes de login, Base + Base Sepolia et Solana devnet.
- **Bundle Worker** : 4,5 Mio brut, 821 Kio gzip (limite gratuite 3 Mio).

## 2026-09-17

- **Phase 3 découpée en 4 livrables** sur un contrat unique, le protocole `postMessage` v1 de `packages/types/src/embed.ts` : messages tagués `source: 'pocketkey'`, une réponse par `requestId`, payloads de réponse validés par type côté hôte. Les jetons ne traversent jamais la frontière iframe.
- **`allowedOrigins` exposé dans la config publique** : l'iframe doit vérifier l'origine de sa page parente. Les origines d'une app sont publiques par nature (ce sont ses sites). `frame-ancestors *` côté hébergement, contrôle en JavaScript sur chaque message et côté API sur chaque requête.
- **`@pocketkey/core`** :
  - Un refresh refusé (401) vide la session, notifie `null` et remonte `not_authenticated` (code d'origine dans `details.code`). Un second 401 après le retry remonte l'erreur API sans vider la session, pas de boucle.
  - Avant de rafraîchir, le client relit le stockage : si un autre onglet a déjà fait la rotation, il reprend ces jetons au lieu de rejouer l'ancien refresh (que l'API traiterait comme un vol et révoquerait).
  - Popup OAuth fermée : rejet `user_rejected` après deux sondages (500 à 1000 ms) pour laisser passer le message envoyé juste avant la fermeture. `access_denied` devient `user_rejected`.
  - `@simplewebauthn/browser` chargé en import dynamique uniquement : le core reste importable dans Workers et Node, et léger.
- **Origine de seed** : la playground tourne sur 3810, l'origine `localhost:3000` (port d'une autre app locale) est retirée du seed.
- **Wallet externe dans l'iframe** : découverte EIP-6963 et Phantom dans le contexte de l'iframe. Les extensions injectent généralement aussi dans les iframes ; si ce n'est pas le cas pour un wallet, la connexion devra passer par la page hôte (post-MVP, avec WalletConnect).
- **`@pocketkey/react`** :
  - `treeshake` tsup désactivé : Rollup supprimait la directive `'use client'` nécessaire au App Router. Le code mort reste éliminé par esbuild.
  - Enregistrement Wallet Standard fait à la main (même handshake d'événements que `registerWallet`) pour pouvoir se désenregistrer au démontage.
  - `useWallet().getEvmProvider()` ajouté : sans lui, impossible d'appeler `eth_requestAccounts` (qui ouvre le login) quand l'utilisateur est déconnecté.
  - Ordre de résolution des chaînes : config hôte, puis config serveur renvoyée par `init`, puis Base 8453 et `mainnet-beta`.
  - Méthodes EIP-1193 non supportées (`eth_sign`, `eth_signTypedData` v1/v3, `wallet_*`) : 4200, jamais relayées au RPC public.
- **Embed (`apps/embed`)** :
  - Vite + React 19 + Tailwind 4, `motion` limité aux changements d'écran et à la sortie du dialog, chargé en lazy. JS principal 139 Ko gzip (react-dom, zod via `@pocketkey/types`, motion dominent).
  - Les surcharges d'apparence de l'hôte ne s'appliquent que pour les clés réellement présentes dans le message (Zod remplit sinon `theme` et `accent` par défaut et écraserait la config serveur).
  - Les méthodes de login de l'hôte ne peuvent que restreindre celles du serveur ; si l'intersection est vide, la liste serveur est gardée avec un avertissement console.
  - Mode `?preview=1` : tous les écrans en statique, clair et sombre, variantes d'accent et bottom sheet mobile, pour itérer sur le design sans passer par le SDK.
  - L'export affiche un avis « simulé » avec le fournisseur de clés mock ; le déchiffrement du bundle Turnkey réel reste à faire avec T0.5.
- **E2E (T3.4)** : Playwright 1.63 (Chromium déjà en cache) démarre l'API sur wrangler dev (mailer console, code lu dans `.e2e/api.log`), l'embed sur Vite et la playground sur Next. Pas encore dans la CI GitHub : à ajouter avec `playwright install --with-deps` une fois validé sur un runner.
