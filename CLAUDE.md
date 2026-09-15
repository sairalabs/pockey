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

Outils :

- `pnpm check` (typecheck + lint + test) doit passer avant tout commit.
- Skills UI installés dans `.agents/skills/` : `better-ui` (polish, radius concentrique, ombres, icônes) et `emil-design-eng` (motion, easing, durées). Les lire avant de toucher au dashboard, à l'embed ou au modal React.
- Références visuelles du dashboard : style Base Dashboard (fond noir, cartes sombres avec bord 1px translucide, typographie sans-serif, densité aérée). Voir `apps/dashboard/DESIGN.md`.
