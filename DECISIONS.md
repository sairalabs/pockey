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

## 2026-09-17 (phase 5)

- **Contrats dashboard** dans `packages/types/src/admin.ts` : session développeur, apps avec usage du mois et solde, clés API (secret montré une seule fois), séries d'usage avec remplissage des jours vides, liste d'utilisateurs paginée, résumé de facturation (500 wallets actifs inclus, 0,06 $ au-delà, section 11).
- **Facturation Stripe dans `@pocketkey/payments` (T5.4)** :
  - Clés d'idempotence hachées (`pocketkey-<scope>-<sha256>`) pour qu'aucun identifiant de développeur ou de client ne circule en clair dans un en-tête. Checkout et portail gardent une clé aléatoire (une clé stable rejouerait une URL expirée).
  - Compatibilité entre versions d'API Stripe : `current_period_end` est lu au niveau de l'abonnement puis de ses items (déplacé dans Basil), et l'abonnement d'une facture est lu aux deux emplacements connus.
  - Les événements de facturation sans client identifiable sont ignorés plutôt que rejetés : d'autres produits peuvent vivre sur le même compte Stripe.
  - Les clés de payload des compteurs (`stripe_customer_id`, `value`) sont celles par défaut : un compteur configuré autrement demanderait d'autres noms de champs. À vérifier à la création du compteur.
  - `estimateMonthlyCents` est la seule source du calcul de prix, partagée par l'API et le dashboard.

## 2026-09-17 (phase 5, API dashboard)

- **Deuxième instance Better Auth pour les developers** (`apps/api/src/auth/developer-auth.ts`, `basePath: /admin/auth`) plutôt qu'un plugin ou une table séparée : les tables `ba_*` sont partagées, les end users portent un `app_id`, les developers `NULL`. Un `developerScopeAdapter` dédié ajoute `appId IS NULL` sur chaque lecture et écrit `null` à la création (l'adapter Drizzle traduit une valeur `null` en `IS NULL`), et préfixe les identifiants de vérification par `developer|`. Symétrique du `scopeAdapter` multi-tenant, mais volontairement séparé : l'un scope à une app, l'autre à « aucune app ».
- **Cookies réels côté dashboard, pas de pont d'en-tête** : le dashboard proxifie `/admin/*` sous sa propre origine, donc pas de contexte tiers. Préfixe de cookie `pocketkey_dev` (distinct de `pocketkey`) pour qu'un cookie de popup OAuth end user ne masque jamais une session developer sur l'origine de l'API. `SameSite=Lax`, `Secure` seulement si `API_BASE_URL` est en https (sinon le navigateur jette le cookie en développement local).
- **Session developer de 7 jours** (contre 1 h pour l'instance end user, qui ne sert qu'à faire un pont vers les jetons Pocketkey).
- **Migration 0003** : `developers.auth_user_id` (unique, nullable). La ligne developer est créée à la première connexion ; si une ligne existe déjà avec le même email et sans `auth_user_id` (seed local, support), elle est rattachée au lieu d'en créer une seconde (l'email est unique). `seed.ts` reste inchangé.
- **Mois courant recalculé à la volée** pour `/admin/apps`, `/admin/apps/:id/usage` et `/admin/billing` : `usage_monthly` est écrit par le cron horaire et retarde toujours d'une heure. Les mois passés viennent de `usage_monthly`, le mois courant de `usage_events`. Le dashboard et l'estimation de facturation reflètent donc ce qui vient de se passer, et une app sans événement renvoie des zéros.
- **Conséquence connue** : `user.active` n'est émis qu'une fois par mois et par utilisateur (section 7.6), donc la courbe journalière des utilisateurs actifs ne montre que la première connexion du mois. Changer cela demanderait un événement quotidien, donc plus de lignes : non fait au MVP.
- **Slugs** : dérivés du nom (minuscules, tirets) avec suffixe numérique `-2`, `-3` si nécessaire ; un slug demandé explicitement et déjà pris renvoie 409 plutôt que d'être renommé en silence.
- **CORS `/admin/*`** : une seule origine exacte (`DASHBOARD_ORIGIN`, défaut `http://localhost:3800`) avec `credentials: true`. Les routes `/v1/*` gardent le reflet d'origine existant.
- **`GET /admin/billing/portal`** : le client Stripe et l'abonnement sont T5.4. La route détecte la capacité `createBillingPortalSession` sur le port `Payments` et répond 400 `bad_request` tant qu'il n'y a pas de client Stripe ou que le port ne l'offre pas, au lieu de planter.
- **Pagination des end users mutualisée** : le curseur opaque et la requête de `/v1/server/users` sont remontés dans `services/end-users.ts` et réutilisés par `/admin/apps/:id/users`, qui ajoute `total`.
- **Durée des sessions qui autorisent les messages plafonnée à 24 heures** (contre 30 jours pour les sessions transactions seules), vérifiée dans le schéma `SigningPolicy` lui-même, donc appliquée partout : API, SDK et iframe.
- **Workflow E2E manuel** (`.github/workflows/e2e.yml`, `workflow_dispatch`) : il installe Chromium et lance l'API, l'iframe et la playground. Volontairement hors du CI de push tant qu'il n'a pas tourné plusieurs fois sur un runner.
- **Dashboard branché sur l'API (T5.1 à T5.3)** :
  - Le navigateur ne parle qu'à l'origine du dashboard : un route handler Next (`/api/admin/[...path]`) relaie vers l'API et transmet les cookies dans les deux sens. Pas de CORS, pas de cookie tiers, session `pocketkey_dev` de première partie.
  - Un 401 rend l'écran de connexion à la place de la page, sans redirection.
  - Les panneaux sans route côté API ont été retirés plutôt que simulés : membres (pas de modèle d'équipe au MVP), suppression de compte, factures, transactions sponsorisées récentes, plafond journalier en dollars, découpage par plateforme.
  - `appearance.name` et `appearance.logo` deviennent éditables (ce sont de vrais champs de config qui n'avaient pas d'écran) ; le tagline et la description du design d'origine n'existent pas dans le modèle et ont été retirés.
  - Graphes en SVG inline, une seule couleur de données (l'accent de l'app), contraste validé sur le fond sombre.
  - Le compteur de wallets actifs porte une note : un wallet est compté une fois par mois calendaire (section 7.6), sinon la courbe quotidienne se lit à tort comme des actifs du jour.
- **Contrat `AuthProviders`** ajouté : le dashboard devait deviner la disponibilité de GitHub en provoquant un 400. Une route publique dédiée remplacera cette sonde.
- **À corriger pour GitHub** : le callback OAuth doit pointer vers le proxy du dashboard (`<DASHBOARD_ORIGIN>/api/admin/auth/callback/github`), sinon le cookie d'état posé côté dashboard n'accompagne pas le retour de GitHub vers l'API.

## 2026-09-17 (phase 5, facturation Stripe et rate limiting)

- **`STRIPE_ACTIVE_WALLET_PRICE_ID` et `STRIPE_ACTIVE_WALLET_METER_NAME` optionnels** hors production : sans eux la facturation se dégrade (portail en 400, cron nocturne sans effet) au lieu d'empêcher le Worker de démarrer. La validation d'environnement les exige en production, où `PAYMENTS=stripe` est déjà obligatoire.
- **Client Stripe créé à la demande, une fois par developer** : `ensureBilling` est appelé par `GET /admin/billing/portal`, pas à l'inscription. L'id client est persisté sur `developers.stripe_customer_id` ; l'id d'abonnement ne l'est pas, parce que `@pocketkey/payments` crée l'abonnement sous une clé d'idempotence dérivée de l'id client, donc redemander renvoie le même abonnement. Aucune migration.
- **`ensureBilling` prend la configuration d'environnement** en quatrième argument : un seul endroit décide si la facturation est configurée (mock : toujours ; Stripe : seulement avec le price id).
- **`portalAvailable` est vrai dès que la facturation est configurée**, même sans client Stripe, puisque le client est créé au moment où le developer ouvre le portail.
- **Metering nocturne à 02h20 UTC** (`20 2 * * *`), sur la veille et l'avant-veille. Stripe déduplique sur l'identifiant `maw:<developerId>:<YYYY-MM-DD>`, donc rejouer une nuit manquée ne facture rien deux fois. Horodatage à midi UTC du jour rapporté, pour que l'événement tombe dans la bonne période de facturation. `scheduled` fait un `switch` sur `controller.cron` et les deux expressions vivent dans `src/cron.ts`.
- **Rate limiting (T5.5) sur Durable Objects SQLite** plutôt que KV : KV est éventuellement cohérent, un compteur y perd des requêtes. `new_sqlite_classes` garde l'objet disponible sur le plan gratuit. Fenêtre fixe, un objet par clé, alarme de fin de fenêtre qui vide le stockage pour qu'une clé inactive ne coûte rien.
- **Six portées, défauts dans `src/rate-limit/limits.ts`**, surchargeables par la var `RATE_LIMITS` (JSON, `0` désactive) : app 600/min sur tout `/v1/*`, end user 120/min, app 30/min et identité 5/min sur les routes d'auth coûteuses, clé secrète 300/min sur `/v1/server/*`, envois sponsorisés 10/min par end user (menace « abus gas sponsoring » de la section 8.1).
- **Jamais de limite sur `/health`, `/webhooks/*` et `/admin/*`** : les deux premiers sont de l'infrastructure, le dashboard est un humain derrière un cookie de session.
- **Identité hachée** (SHA-256 de `appId|email:...` ou `appId|device:...`) avant de servir de nom d'objet : aucune adresse e-mail ne circule en clair dans une clé.
- **Compteur injoignable : on laisse passer.** Perdre une limite quelques secondes vaut mieux que perdre l'API.
- **Aucune limite quand `ENVIRONMENT=test`**, sauf si un test injecte un limiteur (`setRateLimiterForTests`) : sinon le volume de la suite déclencherait des 429.

## 2026-09-19 (T0.5, Turnkey réel et non-custodial)

- **Modèle retenu : non-custodial, validé par Medhy.** L'iframe détient une clé P-256 de session de l'utilisateur (WebCrypto non extractible) et tamponne (« stamp ») chaque requête Turnkey. L'API relaie sans pouvoir modifier le corps (la signature couvre les octets exacts), vérifie organisation, wallet et type d'activité, et compte l'usage. Le backend ne détient qu'une clé déléguée, bornée par les policies que l'utilisateur crée lui-même (session signers). Alternative écartée : co-propriété des sous-organisations par le backend (plus rapide, mais « backend compromis = tous les wallets vidés », contraire à la section 8.1).
- **Vérifié sur l'organisation réelle « Saira Labs » (spike du 2026-09-19, sous-organisations supprimées ensuite)** :
  - la clé API parent ne peut ni signer, ni exporter, ni s'ajouter comme utilisateur dans une sous-organisation dont l'utilisateur est seul root (« organization mismatch ») ;
  - un utilisateur délégué sans policy ne peut rien ; avec une policy V3 il signe exactement ce qu'elle autorise (wallet, `eth.tx.chain_id`, `eth.tx.to`, `eth.tx.value`) et rien d'autre (autre contrat, montant trop élevé, payload brut, export, suppression de policy refusés) ;
  - **expiration native** : `CREATE_POLICY_V3` accepte `time: "time.now < Timestamp('<RFC 3339>')"`, une policy expirée refuse. Le cron horaire devient un simple nettoyage ;
  - `eth.tx.to` accepte l'adresse en minuscules comme en checksum ;
  - **cohérence à terme** : un wallet, un utilisateur ou une policy fraîchement créés sont invisibles environ 0,1 à 1,2 s. `TurnkeyClient.submit` réessaie `not_found` et `permission_denied` jusqu'à `retryUntil` (fenêtre de 5 s, uniquement pour une ressource qu'on vient de créer). Renvoyer le même corps tamponné est sans risque : une requête refusée n'a rien exécuté.
- **Client Turnkey maison, pas le SDK dans le Worker** (`packages/key-provider/src/turnkey/{wire,stamp,http}.ts`) : le stamper du SDK choisit son implémentation selon l'environnement détecté (Node, navigateur) et se trompe sous workerd avec `nodejs_compat`. Le nôtre signe avec `@noble/curves` (Worker, tests) ou une `CryptoKey` WebCrypto (iframe), format identique : base64url du JSON `{publicKey, scheme: SIGNATURE_SCHEME_TK_API_P256, signature DER}` sur SHA-256 du corps. Test de contrat live (`TURNKEY_LIVE=1`) : crée une sous-organisation, un wallet, signe, vérifie le refus du parent, supprime.
- **Changement du port `KeyProvider` (signalé explicitement, règle CLAUDE.md)** : `KeyProviderError` gagne le code `unauthenticated` (clé de session de l'iframe inconnue ou expirée). D'autres changements suivront avec le relais de requêtes tamponnées.
- **OTP email par Turnkey, plus par Better Auth** : `INIT_OTP_V3` renvoie une clé cible signée par l'enclave Turnkey ; l'iframe vérifie cette signature (clé de signataire de production épinglée dans `@turnkey/crypto`) avant d'y chiffrer le code et sa clé publique, puis `OTP_LOGIN_V2` exige une signature de cette même clé. Le backend relaie sans jamais voir le code ni pouvoir lier le jeton à sa propre clé. Conséquence : l'email de code est envoyé par Turnkey (personnalisable : nom d'app, logo, expéditeur sur domaine vérifié), plus par Resend.
- **Confiance résiduelle assumée** : à la création de la sous-organisation, c'est notre backend qui déclare les identifiants root (email, passkey, OIDC). Un backend compromis au moment précis de l'inscription pourrait s'y glisser. Même hypothèse que le flux recommandé par Turnkey ; à écrire noir sur blanc dans la page sécurité.

## 2026-09-19 (T0.5, livraison)

- **Tout le parcours passe par Turnkey** : login email (OTP chiffré pour l'enclave, inscription signée par la clé de l'iframe), Google/Apple (client OIDC maison, nonce = SHA-256 de la clé de session), passkeys (enregistrement puis login adressé au parent), wallets externes (le wallet signe la requête de login, une seule signature à l'inscription), signatures (préparation API, vérification puis signature dans l'iframe), sessions (l'utilisateur ajoute le signataire Pocketkey et crée chaque policy), export (déchiffré dans l'iframe), fee payers Solana (sous-organisations système).
- **Better Auth ne sert plus qu'aux développeurs.** Côté utilisateurs finaux : plus de cookie bridge, plus d'en-tête device, identités résolues par `end_user_identities`. Migration 0004 : comptes Turnkey sur `end_users`, `payload` sur `auth_challenges` (flux OTP, opérations préparées).
- **Émulateur Turnkey** (`KEY_PROVIDER=mock`) : même format que Turnkey, stamps vérifiés, policies évaluées, HPKE porté (interopérabilité testée contre `@turnkey/crypto`). Tests et dev local par défaut. Seuls les builds de dev de l'iframe acceptent sa clé d'enclave.
- **`core` reste générique (MIT)** : interface `KeyClient`, implémentation Turnkey dans `@pocketkey/key-provider/client`, stockage IndexedDB dans l'iframe (clé non extractible).
- **Limites connues, assumées pour la v1** :
  - les policies ALLOW d'un même utilisateur délégué s'additionnent : avec plusieurs sessions actives sur un wallet, la plus large s'applique côté Turnkey, les plus étroites ne sont tenues que par la vérification locale de Pocketkey ;
  - à l'inscription par wallet externe, c'est l'API qui déclare la clé de session à Turnkey (pas de signature client comme pour l'email) : même confiance au moment de l'inscription que dans le flux recommandé par Turnkey ;
  - un envoi sponsorisé dont la requête signée ne correspond pas est débité puis remboursé (solde net inchangé) ;
  - le bundle de l'iframe passe à environ 855 Ko (260 Ko gzip) avec `@turnkey/crypto` : à découper en chargement différé.
- **Quota Turnkey atteint** : après les tests live du 2026-09-19, Turnkey refuse les signatures de l'organisation « Saira Labs » (« Signing is disabled because your organization is over its allotted quota »). Le plan gratuit ne suffit pas au-delà de quelques centaines de signatures de test : passer à un plan payant avant la v1, et ne lancer le test live qu'à la demande.
