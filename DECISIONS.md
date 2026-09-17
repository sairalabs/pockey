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

## 2026-09-17 (design feedback)

- **Accent par défaut : cerise `#d2042d`** à la place du violet, partout (schéma `AppConfig`, seed, embed, dashboard, playground, icône Wallet Standard).
- **Règles de couleur partagées** dans `packages/types/src/color.ts`, utilisées par l'iframe et l'aperçu du dashboard pour qu'un développeur voie exactement le rendu final :
  - Texte sur fond d'accent : blanc en priorité, noir seulement si le blanc passe sous APCA Lc 50. APCA plutôt que WCAG 2, qui sous-estime la lisibilité du blanc sur les couleurs saturées (orange, vert, rose restent en blanc).
  - Accent qui se fond dans la surface (ratio WCAG sous 1,35) : remplacé par la couleur de texte du thème. Noir sur thème sombre donne des CTA blancs à texte noir ; blanc sur thème clair donne des CTA noirs.
  - Hover : mélange de 10 % vers la couleur du texte du bouton.
- **Couleur personnalisée** : sélecteur natif et champ hex (accepte `d2042d`, `#D2042D`, `#abc`) dans la galerie de l'iframe et dans le panneau Configuration du dashboard.
- **Plus aucune police monospace** (préférence de Medhy) : adresses, hash, clés et codes en police du site avec chiffres tabulaires, `code`/`pre` héritent de la police.

## 2026-09-17 (phase 4)

- **SIGNALEMENT EXPLICITE : l'interface `KeyProvider` change** (règle de `CLAUDE.md`). La spec (7.4) veut que Turnkey revérifie la policy d'un session signer, or une signature de hash brut ne porte aucune information de transaction : Turnkey n'évalue les conditions `eth.tx.*` / `solana.tx.*` que sur des activités de signature de transaction. Ajouts :
  - `signTransaction({ subOrgId, walletId, chainFamily, unsignedTransaction, sessionPolicyId? })` : le fournisseur parse la transaction et applique la policy.
  - `SignRawInput.sessionPolicyId?` : signature de message sous session.
  - `CreatePolicyInput.walletId` et `CreatePolicyInput.expiresAt` : une policy est toujours liée à un wallet et bornée dans le temps.
  - Les signatures interactives de l'utilisateur gardent le chemin existant (`signRaw` + assemblage local).
- **`maxValueTotal` n'est appliqué que par Pocketkey** : les policies Turnkey sont sans état, elles ne peuvent pas cumuler. Réservation atomique (compare-and-set sur `spent_total`) avant signature, compensation si la signature ou la diffusion échoue.
- **Expiration des sessions** : les policies Turnkey ne savent pas exprimer une date ; le cron horaire supprime les policies des sessions expirées. Le mock refuse aussi toute signature après `expiresAt`.
- **Données typées sous session** : autorisées seulement si la policy a une allowlist de contrats contenant `domain.verifyingContract`, sinon refus (`typed_data_not_allowed`). Un Permit ou un ordre signé peut vider un wallet sans transaction.
- **Valeur Solana** : seuls les `Transfer` du System Program depuis le wallet sont comptés. Une session plafonnée en valeur devrait aussi restreindre `allowedPrograms`.
- **Nouveaux ports** : `@pocketkey/gas-sponsor` (sponsor Solana fee payer, sponsor EVM ERC-4337 Kernel via Pimlico, `PriceFeed`) et `@pocketkey/payments` (Stripe Checkout et webhooks via fetch, sans SDK).
- **Migration 0002** : `sponsor_ledger` (registre signé, référence unique pour l'idempotence), `app_system_wallets` (fee payer Solana par app dans une sub-org système), `payment_events`.
- **`@pocketkey/chains-solana`** expose `inspectTransaction` (instructions, programmes, transferts System, compute budget, estimation de frais) et **`@pocketkey/chains-evm`** `serializeUnsignedTransaction` / `parseEvmTransaction`, pour les policies et le sponsoring.
- **Session signers livrés (T4.1, T4.2)** :
  - Les règles sont appliquées deux fois (API puis mock fournisseur), sauf `maxValueTotal` et la règle des données typées, propres à l'API.
  - Le contrôle local tourne sur les valeurs de la requête avant la préparation de la transaction : une requête refusée ne coûte aucun appel RPC.
  - `spentTotal` compte toute transaction qui déplace de la valeur, même sans plafond total, et une transaction signée mais non diffusée compte comme dépensée. Trois échecs de compare-and-set renvoient 409 `conflict`.
  - Révocation : le flag en base d'abord (la session est refusée immédiatement), puis suppression de la policy fournisseur ; si elle échoue, 502 et un nouveau DELETE réessaie.
  - Clés secrètes : toute requête avec un en-tête `Origin` est refusée avant lecture de la clé. Clé inconnue, révoquée ou d'une autre app : même 401 `api_key_invalid`.
  - `GET /v1/server/users` charge chaque utilisateur complet (environ 300 requêtes pour 100 utilisateurs) : acceptable au MVP, à optimiser avec le dashboard.
- **Point de sécurité ouvert (à trancher)** : signer des messages sous session impose d'autoriser la signature de payload brut dans la policy Turnkey, qui ne distingue pas un hash de message d'un hash de transaction. Un backend compromis pourrait alors faire signer n'importe quel hash sous une session active, ce qui affaiblit la garantie « backend compromis » de la section 8.1. Le mapping expose `allowRawPayloads: false` pour des sessions limitées aux transactions.
- **`@pocketkey/gas-sponsor` et `@pocketkey/payments` livrés (T4.4, T4.5, partie Stripe de T4.6)** :
  - EVM : l'opération est préparée puis signée, et envoyée via le client Pimlico sans compte attaché. Passer par le smart account client ferait re-préparer l'opération par viem (nouvelles données paymaster) et invaliderait la signature.
  - Kernel v3 (0.3.1), EntryPoint 0.7. Les messages d'erreur du bundler masquent `apikey=`.
  - Fee payer Solana, règles de sûreté : compte 0, jamais référencé par une instruction (même comme destination), jamais programme, jamais en lecture seule ni dupliqué, signataires requis exactement fee payer et utilisateur, pas de lookup tables, frais plafonnés (50 000 lamports par défaut).
  - Prix : CoinGecko mis en cache 60 s, un échec n'est jamais servi depuis le cache ; calcul des centimes en BigInt, arrondi au supérieur, marge 15 %.
  - Webhooks Stripe : tolérance de 300 s dans les deux sens, `async_payment_succeeded` payé compte aussi, une session payée sans `metadata.appId` est ignorée (autres produits sur le même compte Stripe) plutôt que rejetée, devise autre que USD rejetée.
  - Le mock de paiements signe avec un secret public (`MOCK_WEBHOOK_SECRET`) : jamais en production, la validation d'environnement l'impose.
- **Décision de sécurité tranchée : `SigningPolicy.allowMessages`, désactivé par défaut.** Une session ne signe que des transactions, que le fournisseur de clés peut contraindre. Messages, données typées et envois EVM sponsorisés (les opérations ERC-4337 sont signées comme des hash bruts) exigent `allowMessages: true`, affiché à l'utilisateur sur l'écran de consentement (« Transactions and messages »). Appliqué à trois niveaux : contrôle API (`messages_not_allowed`), mock fournisseur (refus des payloads bruts), mapping Turnkey (`ACTIVITY_TYPE_SIGN_RAW_PAYLOAD*` seulement si autorisé). Ainsi la garantie « backend compromis » de la section 8.1 tient par défaut.
- **Sponsoring branché dans l'API (T4.4 à T4.6)** :
  - Solana : validation du fee payer avant tout débit, plafond journalier (`'0'` = pas de plafond, le solde prépayé reste la limite ; dépassement : 429 `rate_limited`, léger dépassement possible en concurrence), débit, co-signature, diffusion, remboursement intégral en cas d'échec.
  - EVM : préparation de l'opération, débit du coût maximal avant envoi, envoi de l'opération préparée exacte, remboursement de la différence après le reçu via `waitUntil` (25 s max, sinon l'app garde le coût maximal), remboursement intégral si l'envoi échoue.
  - `creditTopUp` : l'événement, le solde et le registre sont écrits dans un seul `db.batch`, jamais un événement marqué traité sans crédit.
  - Production exige `PAYMENTS=stripe` et `PRICE_FEED=coingecko` (des prix statiques factureraient faux).
  - Les overrides de gas et de nonce sont ignorés pour les envois EVM sponsorisés ; un envoi sponsorisé sous session avec `broadcast: false` est refusé.
  - Le rate limit par utilisateur final de la section 8.1 reste à faire avec T5.5.
