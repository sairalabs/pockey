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
