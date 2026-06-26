# bioxa-newsletters — Conventions projet

## Contexte
Plateforme Apps Script multi-newsletter pour BIOXA (SELAS).
Cahier des charges complet : voir `PRD-plateforme-newsletters-bioxa.md` à la racine.
Première instance livrée : newsletter DSI Cyber+IA. Cinq autres newsletters thématiques planifiées (Qualité/HAS, RH juridique, Compta/fisca, Biologistes scientifique, Économie BM).

## Stack imposée
- Google Apps Script (JavaScript V8) — pas de Node.js, pas de build step, pas de TypeScript
- Google Sheets pour la configuration métier (Sheet `BIOXA-Newsletters-Config`)
- Claude API Anthropic, endpoint Message Batches API (`/v1/messages/batches`)
- Modèle par défaut : `claude-haiku-4-5-20251001` (lu depuis l'onglet `_config`)
- Gmail via `GmailApp` depuis `selasbioxa@gmail.com`
- Aucune dépendance externe (pas de npm, pas de Firecrawl, pas de bibliothèque tierce)

## Workflow Claude Code Cloud
- Lis `PRD-plateforme-newsletters-bioxa.md` AVANT toute génération de code
- Travaille par incréments (§6.5 du PRD : 1 incrément = 1 PR)
- Nomme les branches : `incr-{N}-{description-courte}`, ex: `incr-1-socle-plateforme`
- À la fin d'un incrément, push la branche et ouvre une PR avec un descriptif clair listant : ce qui a été fait, ce qui reste, comment tester manuellement dans l'éditeur Apps Script
- Pas de PR géante : si un incrément déborde, le découper

## Particularité Apps Script
- Claude Code ne peut PAS exécuter le code dans son sandbox (pas de runtime Apps Script en local)
- Les tests sont manuels via l'éditeur Apps Script (`script.google.com`) après copier-coller ou push via `clasp` côté utilisateur
- Privilégier des fonctions courtes, testables individuellement via Logger.log
- Prévoir des fonctions de test unitaire dans `src_test.gs` (ex: `testerLireConfig()`, `testerCollecte()`) que l'utilisateur lance manuellement

## Règles de code non négociables
- Nommage des fonctions en camelCase français pour le métier (`executerNewsletter`, `collecterItems`, `dedoublonner`, `appelerClaudeBatch`)
- Préfixe des fichiers source : `src_*.gs` sauf `Code.gs` qui contient les entry points (`executerNewsletterDSI`, etc.)
- Constantes en SCREAMING_SNAKE_CASE (`CONFIG_IA`, `GMAIL_QUOTA_JOUR`, `CLAUDE_API_ENDPOINT`)
- Tout appel à l'API Claude passe par `appelerClaudeBatch()` — pas d'appel `UrlFetchApp` direct vers Anthropic ailleurs dans le code
- Toute lecture de la Sheet passe par `lireConfig(idNewsletter)` — pas de `SpreadsheetApp.getActive()` éparpillé
- `Logger.log()` pour le debug. La trace finale du run va dans l'onglet `_logs` (1 ligne par exécution)
- Gestion d'erreur : `try/catch` autour de chaque appel externe (UrlFetchApp, GmailApp.sendEmail), JAMAIS de `catch` muet

## Règles métier non négociables
- Le titre d'un article est conservé VERBATIM depuis le flux RSS — jamais reformulé par Claude
- Le lien dans l'email pointe TOUJOURS vers la source originale, jamais vers un agrégateur ou un proxy
- AUCUNE donnée patient, donnée RH nominative, ou donnée interne BIOXA confidentielle n'est envoyée à l'API Claude. Seuls : titres et résumés bruts d'articles publics
- Le résumé fait ≤ 200 caractères. Si Claude dépasse, troncature à 200 + `…` et warning dans les logs
- Le pré-filtre IA (1 appel batch oui/non sur les titres) précède TOUJOURS le scoring détaillé — pas de bypass pour "aller plus vite"
- Le prompt système est versionné par un préfixe `# v{AAAA-MM-JJ}` en première ligne du champ `Prompt système` de la Sheet. Ce label est repris dans le pied de la newsletter
- Déduplication globale plateforme : un item envoyé dans une newsletter n'est pas re-envoyé dans une autre (filtrage contre l'onglet `_historique`)

## Architecture cible (rappel du PRD §11)
```
Code.gs                  // entry points par newsletter
src_config.gs            // lireConfig(idNewsletter)
src_collecte.gs          // collecterItems(idNewsletter, config)
src_dedup.gs             // dedoublonner(items)
src_claude.gs            // prefilterTitres + scorerEtResumer (via appelerClaudeBatch)
src_render.gs            // genererHTML(newsletter, items, config)
src_envoi.gs             // envoyerGmail(newsletter, html, destinataires)
src_logs.gs              // logRun, envoyerMailAdmin
src_triggers.gs          // installerTriggers
src_test.gs              // fonctions de test manuel
```

## Secrets
- Clé API Anthropic stockée dans `PropertiesService.getScriptProperties()` sous la clé `ANTHROPIC_API_KEY` — jamais dans le code, jamais dans la Sheet, jamais dans le repo Git
- Si un fichier `.env`, une clé, un token ou un email personnel apparaît dans une PR, c'est un blocker à corriger avant merge
- Le `.gitignore` à la racine doit couvrir `.env`, `.clasp.json` (si clasp est utilisé), tout fichier de credentials

## Quotas à respecter (compte Gmail gratuit en hypothèse v1)
- `GmailApp.sendEmail()` : 100 destinataires/jour max → étaler les jours d'envoi entre newsletters
- `UrlFetchApp` : 20 000 appels/jour (confortable)
- Triggers : 20 max par script
- Durée d'exécution : 6 min/run max → traiter par chunks si la collecte dépasse

## Ce que Claude Code doit faire de lui-même
- Lire le PRD à la racine avant de générer du code
- Proposer une structure cible avant de coder (réponse en prose, puis attendre validation)
- Suggérer un commit par étape logique dans un incrément
- Documenter chaque fonction publique avec une docstring JSDoc courte (paramètres, retour, exceptions possibles)
- Signaler dans la description de la PR tout écart au PRD ou aux conventions ci-dessus
- Proposer des fonctions de test manuel utilisables dans l'éditeur Apps Script à chaque incrément

## Ce que Claude Code ne doit PAS faire
- Introduire une dépendance externe (npm, librairie Apps Script tierce, service SaaS) sans validation explicite dans la conversation
- Bypass du pré-filtre IA, même temporairement, même "pour débugger"
- Mettre en dur une URL, un email, une clé API ou un identifiant dans le code — tout vient de la Sheet ou de `PropertiesService`
- Modifier ce `CLAUDE.md` sans en faire la demande explicite
- Modifier le PRD sans demande explicite (le PRD est figé par version, les écarts se notent en HYP dans une PR séparée)
- Reformuler un titre d'article via le LLM
- Envoyer du contenu interne BIOXA à l'API Claude

## Recette d'un incrément avant merge
- [ ] Branche nommée `incr-N-description`
- [ ] PR avec description claire (objectif, fichiers touchés, comment tester)
- [ ] Tous les fichiers nouveaux/modifiés respectent les conventions de nommage
- [ ] Pas de secret, pas d'URL/email en dur
- [ ] Fonction de test manuel ajoutée dans `src_test.gs` ou mode opératoire de test documenté dans la PR
- [ ] Si écart au PRD : justifié dans la description, listé en HYP à valider
