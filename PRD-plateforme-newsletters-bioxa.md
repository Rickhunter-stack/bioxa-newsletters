# PRD — Plateforme Newsletters BIOXA (v1 : newsletter DSI Cyber+IA)

**Version** : 0.2 (draft) — révision majeure : architecture Apps Script + pattern multi-newsletter
**Auteur** : {à compléter}
**Date** : 2026-06-25
**Statut** : Brouillon — à valider
**Catégorie** : Cat 5 — back-office (🟢 FAIBLE, RGPD léger sur listes destinataires + clés API)

---

## 1. CONTEXTE MÉTIER

BIOXA (SELAS) prévoit d'industrialiser sa veille interne sous forme de newsletters thématiques automatiques. Six newsletters sont envisagées à terme, chacune servant un public interne distinct :

| # | Newsletter | Public cible | Cadence |
|---|---|---|---|
| 1 | **DSI — Cyber et IA** *(première instance, objet de cette v1)* | Membres DSI | Hebdo |
| 2 | Qualité / Identitovigilance / Alertes HAS | Biologistes, qualité, techniciens | Hebdo |
| 3 | RH — veille juridique & droit social | Service RH | Hebdo |
| 4 | Comptabilité / fiscalité | Service comptable | Mensuel |
| 5 | Biologistes — veille scientifique & médicale | Biologistes | Hebdo |
| 6 | Économie / financière — biologie médicale | Direction | Hebdo |

L'outil construit ici n'est pas une newsletter, c'est **une plateforme** dont la newsletter DSI est la première instance. Critère structurant : ajouter la 7e newsletter dans 12 mois doit se faire sans toucher au code, en remplissant un onglet Google Sheet et en activant un trigger.

État actuel : aucun outil dédié. Veille faite individuellement, dispersée, partielle.

Volumétrie cible à plein régime (6 newsletters) : ~5 envois hebdomadaires + 1 mensuel, 5-30 destinataires par newsletter, ~20-30 items par numéro, ~25-30 sources RSS par newsletter.

**Catégorie retenue** : Cat 5 — back-office. Pas de données patient, pas de résultats biologiques, pas de décision médicale. Les seules données personnelles sont les emails internes des destinataires.

## 2. PROBLÈME À RÉSOUDRE

**Douleur principale** :
> Chaque service de BIOXA (DSI, qualité, RH, compta, biologistes, direction) consacre du temps à une veille personnelle dispersée, incomplète et redondante entre collègues, sans canal partagé qui garantisse de couvrir l'essentiel sur son périmètre.

**Manifestations concrètes** :
- Veille individuelle redondante (plusieurs collègues lisent les mêmes sources, manquent les mêmes points aveugles)
- Information stratégique arrivant en retard (cyberattaque sur établissement comparable, nouvelle alerte HAS, JO du jour, sortie d'un modèle IA majeur)
- Pas de canal commun service par service → effet « tribal knowledge » fragile (le départ d'un membre = la perte d'une partie de la veille)
- Pas d'archivage consolidé de la veille passée

**Coût du statu quo** :
- Temps : estimation 1-2 h/semaine/personne × ~30 personnes concernées = ~30-60 h/semaine cumulées sur l'ensemble du groupe
- Risque : décalage de réaction sur incidents (cyber, qualité, juridique), décisions prises sans la dernière information
- Conformité : N/A — la veille n'est pas une obligation normative formelle, mais elle alimente l'analyse de risque qualité (ISO 15189 — culture de l'amélioration continue, *référentiel à vérifier* pour la rédaction définitive)

## 3. UTILISATEURS CIBLES

### 3.1 Utilisateurs de la plateforme (administration)

| Profil | Fréquence | Besoin principal | Niveau technique |
|---|---|---|---|
| Administrateur plateforme | Ponctuel (création newsletters, MAJ sources) | Ajouter/modifier newsletters sans coder | Lecture Apps Script + Google Sheet avancé |
| Référent métier d'une newsletter (1 par newsletter) | Mensuel | Ajuster sources et destinataires de SA newsletter | Google Sheet basique |

### 3.2 Lecteurs (destinataires, par newsletter v1 et roadmap)

| Newsletter | Lecteurs | Tonalité éditoriale attendue |
|---|---|---|
| **DSI Cyber+IA (v1)** | Membres DSI, responsable SI | Direct, actionnable, priorisé menaces |
| Qualité/HAS | Biologistes, qualité, techniciens | Rigoureux, opérationnel |
| RH juridique | Service RH | Factuel, articles cités, dates d'application |
| Compta/fisca | Service comptable | Synthétique, impact SELAS |
| Biologistes scientifique | Biologistes | Niveau de preuve, méthodologie, conclusions |
| Économie BM | Direction | Chiffres clés, mise en perspective sectorielle |

**Utilisateur primaire (v1)** : membre DSI (lecteur).
**Utilisateur primaire (plateforme)** : administrateur (configure les newsletters).
**Tonalités stockées dans la Sheet** — le prompt système de chaque newsletter est éditable sans déploiement.

## 4. SCOPE / HORS-SCOPE

### Dans le scope v1
**Plateforme** :
- Architecture Apps Script unique exécutant N newsletters paramétrées
- Google Sheet de configuration avec 1 onglet de paramètres globaux + 1 onglet par newsletter
- Pattern « 1 trigger temporel par newsletter », créé/supprimé via UI Apps Script
- Onglet historique partagé (hashes URL envoyés, tous newsletters confondues)
- Onglet logs (par run : timestamp, newsletter, compte d'items, statut)
- Onglet sources de chaque newsletter avec colonne `Active` (booléen) pour désactivation sans suppression

**Instance v1 : Newsletter DSI Cyber+IA** :
- Collecte RSS/API publiques pour 6 rubriques (cyberattaques santé, cybersécurité, IA news/modèles, économie IA, fonctionnalités LLM, open source)
- Pré-filtre IA (titre seul → oui/non) — *levier 01 de tes schémas* (gain ~50 % d'appels Claude)
- Scoring + résumé via Claude API Batch sur les items qui passent le pré-filtre
- Rendu HTML email responsive avec template mutualisé + en-tête spécifique newsletter
- Envoi via GmailApp depuis `selasbioxa@gmail.com`
- Cadence : hebdomadaire, jour/heure configurables dans la Sheet

### Hors scope v1 (explicite)
- Curation humaine — *décision : 100 % auto*
- Interface graphique au-delà de la Google Sheet — *Sheet suffit pour le niveau technique des admins*
- Tracking d'ouverture / clics — *aucun besoin remonté, complexité supplémentaire*
- Personnalisation par destinataire — *même contenu pour toute la liste*
- Multi-langue — *FR uniquement, sources EN résumées en FR par Claude*
- Implémentation des 5 autres newsletters — *v1.1 à v1.5 (cf. §9)*
- Archive web consultable — *évolution v2*

### Évolutions envisagées (v2+)
- Archive web (page HTML statique générée par newsletter, hébergée sur Google Sites ou Drive)
- Détection « breaking news » hors cadence (envoi exceptionnel sur alerte CERT critique)
- Dashboard d'usage (taux d'items sélectionnés vs collectés, sources jamais retenues, coût Claude par newsletter)
- Préférences par destinataire (sélection de rubriques)
- Bascule SMTP de domaine BIOXA si la politique évolue (cf. HYP4)

## 5. FONCTIONNALITÉS PRIORITAIRES (MoSCoW)

### MUST HAVE — Plateforme (P)

| ID | Fonctionnalité | Description | Critère d'acceptation |
|---|---|---|---|
| P1 | Configuration multi-newsletter par Sheet | 1 onglet de la Google Sheet = 1 newsletter, structure d'onglet imposée (cf. §11). Onglet `_config` global pour clés API et paramètres communs | Quand un admin crée un nouvel onglet en suivant le template, et qu'il active le trigger associé, la nouvelle newsletter s'exécute au prochain run sans modification du code Apps Script |
| P2 | Triggers temporels paramétrables par newsletter | Une fonction d'admin (`installerTriggers()`) lit la Sheet et crée/met à jour les triggers temporels Apps Script (jour, heure) pour chaque newsletter active | Quand l'admin change le jour d'envoi DSI de vendredi à lundi dans la Sheet et relance `installerTriggers()`, le trigger correspondant pointe sur lundi |
| P3 | Code unique paramétré par newsletter | Une seule fonction `executerNewsletter(idNewsletter)` orchestre tout le pipeline (collecte → pré-filtre → scoring → résumé → rendu → envoi) en se paramétrant depuis la Sheet | Quand `executerNewsletter("DSI")` est appelée manuellement, elle produit et envoie la newsletter DSI ; quand `executerNewsletter("RH")` sera appelée plus tard, elle produira la newsletter RH sans modification de code |
| P4 | Historique partagé anti-doublon | Onglet `_historique` (colonnes : url_hash, sent_at, newsletter, url, title) écrit à chaque envoi ; filtré au prochain run | Quand un item a déjà été envoyé dans une newsletter précédente (même newsletter ou autre), il n'apparaît pas dans le run suivant — la déduplication est globale plateforme |
| P5 | Logs centralisés | Onglet `_logs` : pour chaque exécution, ligne avec timestamp, idNewsletter, nb_collectés, nb_pré-filtrés, nb_scorés, nb_envoyés, durée, statut, message d'erreur si applicable | Quand un run termine (succès ou échec), une ligne est ajoutée dans `_logs` et lisible par l'admin |
| P6 | Gestion d'échec partiel | Si une source RSS échoue, le run continue avec les autres ; si Claude API échoue après 2 retries, run annulé et mail admin envoyé ; si Gmail échoue sur 1 destinataire, les autres sont servis | Quand 1 source/30 est HS, la newsletter part avec les 29 autres et le log mentionne la source en échec ; quand Claude API renvoie 429 deux fois de suite, aucun envoi destinataire, mail admin envoyé |

### MUST HAVE — Pipeline newsletter (M)

| ID | Fonctionnalité | Description | Critère d'acceptation |
|---|---|---|---|
| M1 | Collecte parallèle RSS | `UrlFetchApp.fetchAll()` sur les sources actives de la newsletter, fenêtre 7 j (ou 30 j pour cadence mensuelle), parsing XML via `XmlService` | Quand la collecte est lancée pour la newsletter DSI, ≥ 10 items bruts par rubrique active sont retournés si les sources sont en ligne ; les sources HS sont loggées et ignorées |
| M2 | Déduplication par url_hash | SHA-256 de l'URL canonicalisée (lowercase, sans utm_*, sans trailing slash) ; rejet si présent dans `_historique` ou intra-run | Quand un même article apparaît dans 2 sources, il est conservé une seule fois ; re-exécuter 2 fois → 2e run ignore les items du 1er |
| M3 | Pré-filtre IA sur titre seul | *Levier 01 de tes schémas*. Premier appel Claude Batch : « concerne {rubrique} ? oui/non » pour chaque titre. Les `non` sont rejetés avant scoring détaillé | Quand 100 items sont collectés, l'appel pré-filtre retourne une décision oui/non pour chaque, et seuls les `oui` passent à M4 — réduction observée des items à scorer ≥ 40 % |
| M4 | Scoring + résumé par Claude API Batch | Pour chaque item passant le pré-filtre : appel Batch unique retournant `{score: 0-10, resume_fr: string ≤ 200 char, raison: string}`. Prompt système versionné, stocké dans l'onglet de la newsletter (colonne `Prompt système`). Modèle utilisé : `claude-haiku-4-5-20251001` (configurable dans `_config`) | Quand 50 items passent au scoring, la réponse Batch contient 50 enregistrements valides, le top N est sélectionné (N=5 par défaut configurable), et chaque résumé fait ≤ 200 caractères en français |
| M5 | Rendu HTML email responsive | Template HTML mutualisé (Jinja-like via `Utilities.formatString` ou littéraux template) avec en-tête configurable par newsletter (nom, couleur, sous-titre éditorial), 1 section par rubrique, lien source par item, pied de page avec version du prompt + lien désinscription manuel | Quand le HTML est généré, il s'affiche correctement sur Outlook desktop, Outlook web et Gmail (test manuel sur 3 clients) |
| M6 | Envoi via GmailApp | `GmailApp.sendEmail()` depuis `selasbioxa@gmail.com`, 1 envoi par destinataire (pas de BCC global pour permettre journalisation par destinataire), gestion des quotas Gmail (cf. §7.4) | Quand l'envoi est lancé pour 30 destinataires, chacun reçoit l'email en < 5 min ; si le quota Gmail journalier est atteint avant la fin, l'incident est loggé et un mail admin est envoyé |
| M7 | Versioning du prompt dans la sortie | Le pied de chaque newsletter inscrit la version du prompt système utilisée (ex. hash court ou label `v2026-06-25`) | Quand la newsletter est reçue, son pied affiche le label de version du prompt, permettant de retracer un résumé en cas de question |

### SHOULD HAVE

| ID | Fonctionnalité | Description | Critère d'acceptation |
|---|---|---|---|
| S1 | Mode dry-run | Paramètre passé à `executerNewsletter(id, {dryRun: true})` qui exécute tout sauf l'envoi Gmail, et écrit le HTML dans un Doc Google horodaté | Quand `dryRun: true` est passé, aucun envoi Gmail, un Doc Google est créé dans un dossier `_drafts` partagé |
| S2 | Désactivation de source via colonne `Active` | *Levier 02 de tes schémas*. Une colonne `Active` (TRUE/FALSE) dans chaque onglet newsletter permet de désactiver une source sans la supprimer | Quand `Active = FALSE` sur une ligne source, cette source est ignorée au prochain run |
| S3 | Bascule de modèle Claude par config | *Levier 03 de tes schémas*. Le modèle Claude est lu depuis `_config` (`CONFIG_IA.modele`). Changer la valeur suffit à basculer | Quand `_config!modele` est modifiée et que le run suivant démarre, le nouveau modèle est utilisé (vérifiable dans les logs) |
| S4 | Mail admin de rapport hebdo | Chaque dimanche soir, mail récap à l'admin : nb envois, coût total Claude estimé, sources jamais retenues les 4 dernières semaines (candidates à désactivation) | Quand le récap hebdo est envoyé, il contient les compteurs et la liste des sources à 0 sélection sur 4 semaines |
| S5 | Test unitaire d'un item | Fonction `testerIASurUnItem(idNewsletter, urlTest)` qui exécute le pipeline complet sur 1 URL pour vérifier la qualité du tri/résumé | Quand l'admin lance la fonction avec une URL connue, le résultat (score + résumé + classement rubrique) s'affiche dans Logger / un Doc test |

### COULD HAVE

| ID | Fonctionnalité | Description |
|---|---|---|
| C1 | Édito d'intro généré | Claude produit un édito 3-4 lignes synthétisant les highlights de la semaine, placé en haut de la newsletter |
| C2 | Image OG par item | Récupération de la première image Open Graph (HTML head) sur les items sélectionnés ; intégration responsive |
| C3 | Lien de désabonnement automatique | Endpoint Apps Script publié en webapp qui retire l'email d'un onglet destinataires |
| C4 | Détection langue automatique | Filtrage par newsletter (FR uniquement, EN+FR, etc.) via détection avant scoring |

### WON'T HAVE v1
- Interface web admin dédiée (Sheet suffit)
- Personnalisation par destinataire
- Tracking pixel / clics
- Multi-canal (Teams, Slack)
- Hébergement non-Google

## 6. SPÉCIFICATIONS TECHNIQUES

### 6.1 Entrées

| Source | Format | Fréquence | Volumétrie | Exemple |
|---|---|---|---|---|
| Flux RSS publics (par newsletter) | XML/Atom | Au déclenchement du trigger | 20-30 flux/newsletter × ~10-50 items/sem | https://cert.ssi.gouv.fr/feed/ |
| Google Sheet de config `BIOXA-Newsletters-Config` | Sheet | Lecture à chaque run | < 500 ko | Onglets `_config`, `_historique`, `_logs`, `DSI`, `Qualite`, `RH`, … |
| Claude API (Anthropic) | HTTPS JSON | À chaque run | ~50-150 requêtes Batch par run (selon pré-filtre) | https://api.anthropic.com/v1/messages/batches |

**Liste de sources proposée pour la newsletter DSI Cyber+IA v1** *(reprise du PRD v0.1, à valider par l'admin DSI avant intégration à la Sheet)* :

| Rubrique | Sources proposées (RSS prioritaires) |
|---|---|
| Cyberattaques santé | CERT Santé (cyberveille-sante.gouv.fr), CERT-FR (cert.ssi.gouv.fr), DataBreaches.net, BleepingComputer (filtrage keyword healthcare), Le Mag IT (rubrique santé) |
| Cybersécurité générale | The Hacker News, Bleeping Computer, KrebsOnSecurity, Dark Reading, ANSSI alertes, Schneier on Security, SecurityWeek |
| Actualités IA / nouveaux modèles | Hugging Face Daily Papers, MarkTechPost, The Decoder, VentureBeat AI, Ars Technica AI, ArXiv cs.AI |
| Économie / coûts IA | Artificial Analysis, Reuters Tech, Bloomberg Tech, Semafor Tech, Stratechery (titres publics) |
| Nouvelles fonctionnalités LLM | Blog Anthropic, OpenAI Blog, Google DeepMind, Google AI Blog, xAI News, Simon Willison's Weblog |
| Modèles open source | Hugging Face Trending, r/LocalLLaMA (RSS), AI News (smol.ai), Together AI, Mistral AI, Meta AI |

### 6.2 Traitements

Pipeline d'une exécution `executerNewsletter(idNewsletter)` :

1. **Chargement config** : lecture `_config` (clés API, modèle, paramètres globaux) + onglet de la newsletter (sources, destinataires, prompt système, N items/rubrique, cadence)
2. **Collecte parallèle** : `UrlFetchApp.fetchAll()` sur toutes les sources actives (max 100 URLs en parallèle — limite Apps Script). Timeout : 30 s par requête. Parsing XML via `XmlService`. Fenêtre temporelle : derniers 7 j (hebdo) ou 30 j (mensuel).
3. **Déduplication** : pour chaque item, calcul `url_hash` (SHA-256 URL canonicalisée). Filtrage contre `_historique` (lecture optimisée : 1 seul `getValues()` sur la colonne hash, mise en `Set` pour lookup O(1)).
4. **Pré-filtre IA (M3, levier 01)** : un seul appel Claude Batch avec tous les titres restants, prompt « Pour chaque titre, retourne `{url, decision: "oui"|"non"}` — concerne-t-il la rubrique {rubrique} ? ». Sortie JSON strict. Items `non` rejetés.
5. **Scoring + résumé (M4)** : un seul appel Claude Batch avec les items survivants, prompt système de l'onglet newsletter, sortie `[{url, score, resume_fr, raison}]`. Sélection top N par rubrique selon `_config!N_items_par_rubrique`.
6. **Rendu HTML** : assemblage du template mutualisé hydraté (rubriques, items, en-tête newsletter, version prompt, pied de page).
7. **Envoi Gmail** : boucle `GmailApp.sendEmail()` sur les destinataires actifs. Try/catch par destinataire. Comptage des envois pour respect du quota journalier (cf. §7.4).
8. **Persistance historique** : `appendRow()` dans `_historique` pour chaque item envoyé (url_hash, sent_at, newsletter, url, title).
9. **Log final** : `appendRow()` dans `_logs` avec compteurs et statut.

**Règles métier critiques** :
- Le titre est conservé verbatim depuis le flux RSS (pas de réécriture par Claude)
- Le lien dans l'email pointe TOUJOURS vers la source originale (pas vers un agrégateur, pas vers un proxy)
- Si Claude renvoie un résumé > 200 caractères, troncature à 200 + `…` (et log warning)
- Le prompt système est versionné par un commentaire `# v2026-MM-JJ` en première ligne ; ce label est repris dans le pied de la newsletter
- Aucun appel à Claude sans pré-filtre (sauf en mode `testerIASurUnItem`)

### 6.3 Sorties

| Livrable | Format | Destinataire | Conservation |
|---|---|---|---|
| Email HTML | HTML multipart | Liste de la newsletter | Côté boîte destinataire |
| Onglet `_historique` | Sheet | Plateforme | Pérenne (purge manuelle annuelle si > 50 000 lignes) |
| Onglet `_logs` | Sheet | Plateforme + admin | Rotation manuelle (ou archivage trimestriel par script) |
| Mail récap hebdo (S4) | HTML | Admin DSI uniquement | Côté boîte admin |
| Doc Google `dryrun-{date}` (S1) | Doc | Drive partagé `_drafts` | 90 j |

### 6.4 Stack technique

- **Langage** : Google Apps Script (JavaScript V8)
- **Runtime** : Google Cloud (natif Apps Script) — pas d'infra à provisionner
- **Stockage** : Google Sheets (config + historique + logs), Google Drive (drafts, archives)
- **Email** : `GmailApp` depuis le compte `selasbioxa@gmail.com`
- **LLM** : Claude API (Anthropic) — modèle par défaut `claude-haiku-4-5-20251001` en mode **Message Batches API** (`/v1/messages/batches`), configurable
- **Bibliothèques natives Apps Script utilisées** : `UrlFetchApp`, `XmlService`, `Utilities` (hash SHA-256, dates), `PropertiesService` (stockage clé API), `GmailApp`, `SpreadsheetApp`, `DriveApp`, `ScriptApp` (triggers)
- **Pas de dépendance externe** au-delà de Claude API (ni Firecrawl, ni npm, ni service tiers)

**Justification de l'écart à la stack par défaut Python** : la stack par défaut de `<domaine>` (Python CLI + serveur intranet) est pertinente pour les outils touchant des données patient ou des exports SIL. Ici, données 100 % publiques + destinataires internes → Apps Script l'emporte sur 4 critères : (1) zéro infra à provisionner, (2) configuration métier directe par Sheet sans déploiement, (3) triggers temporels natifs, (4) écosystème Google déjà adopté par l'utilisateur (compte `selasbioxa@gmail.com` actif). Pas de cas brique React (pas d'UI interactive).

### 6.5 Plan d'implémentation incrémental

- **Incrément 1 — socle plateforme (1 j)** : projet Apps Script créé sur compte `selasbioxa@gmail.com`, Google Sheet `BIOXA-Newsletters-Config` créée avec onglets `_config`, `_historique`, `_logs`, `DSI`. Fonction `lireConfig(idNewsletter)` qui retourne un objet typé. Test : `Logger.log(lireConfig("DSI"))` affiche la config attendue.
- **Incrément 2 — collecte RSS + déduplication (1 j)** : implémentation `collecterItems(idNewsletter)` via `UrlFetchApp.fetchAll()` + parsing `XmlService` + déduplication contre `_historique`. Test : sur 3 sources RSS de la rubrique cyberattaques santé, retourne une liste d'items normalisés sans doublons.
- **Incrément 3 — appels Claude Batch (pré-filtre + scoring) (1-2 j)** : implémentation `appelerClaudeBatch(items, type, prompt)` avec retry exponentiel, parsing JSON robuste. Pré-filtre puis scoring sur la sortie du pré-filtre. Test : sur 30 items collectés, retourne 30 décisions oui/non, puis ~15 items scorés avec résumé.
- **Incrément 4 — rendu HTML + envoi Gmail dry-run (1 j)** : template HTML responsive, fonction `genererHTML(newsletter, items)`, S1 dry-run écrivant dans Doc Google. Test : Doc Google produit lisible sur mobile et desktop.
- **Incrément 5 — envoi réel + historique + logs (0,5 j)** : bascule du dry-run vers `GmailApp.sendEmail()`, écriture `_historique` et `_logs`. Test : 1 envoi réel à une boîte de test, ligne ajoutée dans les 2 onglets.
- **Incrément 6 — triggers temporels + multi-newsletter (0,5 j)** : fonction `installerTriggers()` qui crée 1 trigger par newsletter active, fonction d'entrée `executerNewsletterDSI()` (wrapper qui appelle `executerNewsletter("DSI")`). Test : trigger DSI créé, exécution automatique au prochain créneau configuré sans intervention.
- **Incrément 7 — pré-filtre généralisé + sources complètes (0,5 j)** : ajout des ~30 sources DSI dans l'onglet, ajustement du prompt système, ajustement des seuils pré-filtre. Test : 1 newsletter DSI complète envoyée, jugée pertinente par 2 lecteurs DSI.
- **Incrément 8 — observabilité (S4, S5) (0,5 j)** : récap hebdo admin, fonction de test unitaire d'un item. Test : récap reçu, fonction `testerIASurUnItem` produit une sortie lisible.

**Total estimé v1 (newsletter DSI complète)** : 5-7 jours-développeur en vibe coding (Claude Code recommandé pour la phase build).

**Réutilisation pour newsletters 2-6** : seuls les onglets de la Sheet sont à créer + prompts à adapter. Estimation par newsletter additionnelle : 0,5-1 j (rédaction sources + prompt + recette).

## 7. CONTRAINTES

### 7.1 Réglementaires / normatives

- [ ] **RGPD — listes destinataires** : emails professionnels internes BIOXA. Base légale : intérêt légitime de l'employeur pour la communication interne. Inscrire le traitement au registre du DPO BIOXA. Durée de conservation : tant que le destinataire fait partie du périmètre concerné ; suppression à J+30 du départ. Désinscription manuelle en v1 (par demande à l'admin).
- [ ] **RGPD — données transmises à Claude API** : seuls titres et résumés bruts d'articles publics sont envoyés. **Aucune donnée patient, aucune donnée RH nominative, aucune donnée interne BIOXA confidentielle**. Cette règle est explicitée dans le prompt système de CHAQUE newsletter et vérifiée à la recette.
- [ ] **Clés API Anthropic** : stockées dans `PropertiesService.getScriptProperties()` (non exposées dans le code source ni dans la Sheet). Accès limité aux éditeurs du projet Apps Script (admin uniquement).
- [ ] **Droits d'auteur des sources** : usage = lien + résumé court (≤ 200 char) paraphrasé par LLM. Cadre = communication interne non commerciale. Exception de courte citation présumée applicable — *référentiel à vérifier : Code de la Propriété Intellectuelle, art. L122-5.*
- [ ] **Versioning des prompts** : les prompts système sont stockés dans la Sheet (colonne `Prompt système`) avec un préfixe `# v{date}`. L'historique des modifications est tracé par l'historique des versions natif de Google Sheets.
- [ ] **ISO 15189 / HDS / Règlement DM** : N/A — outil de veille interne, aucune donnée biologique, aucune décision médicale, aucun usage par soignant externe. *Justification documentée en §1.*

⚠️ **Alerte à ne pas franchir** : si une newsletter future (par ex. « Biologistes scientifique ») est tentée d'enrichir un item PubMed avec des données patients réelles BIOXA pour illustrer un cas, le périmètre bascule en Cat 1 / Cat 2 + RGPD données de santé + potentiellement HDS si stockage cloud. Cette règle figure en tête de la documentation admin.

### 7.2 SI / Infrastructure

- **Environnement d'exécution** : Google Cloud natif Apps Script (lié au compte `selasbioxa@gmail.com`). Aucune infra à provisionner côté BIOXA.
- **Intégrations sortantes** :
  - HTTPS vers ~30 sources RSS publiques par newsletter
  - HTTPS vers `api.anthropic.com` (Claude API)
  - SMTP géré nativement par Gmail
- **Authentification** :
  - Sur Apps Script : compte propriétaire `selasbioxa@gmail.com` (admin unique)
  - Sur Claude API : Bearer token stocké dans `PropertiesService`
- **Réseau** : sortie Internet via infra Google (rien à configurer sur le réseau BIOXA).
- **Hébergement** : Google natif. Les données stockées sont (a) emails internes, (b) titres + résumés publics, (c) clés API. Aucune donnée de santé.

### 7.3 Données

- **Sensibilité** : données techniques publiques + emails internes professionnels (RGPD léger).
- **Hébergement** : Google (États-Unis / UE selon localisation du compte) — *à confirmer : la localisation Google Workspace n'est pas garantie sur compte Gmail gratuit. Cf. HYP3.*
- **Sauvegarde** : Google Sheet/Drive ont versioning natif. Snapshot trimestriel manuel de la Sheet de config dans un Drive séparé (admin).

### 7.4 Performance

- **Temps d'exécution acceptable** : ≤ 6 min par newsletter (limite dure Apps Script). En pratique : ~2-4 min pour 30 sources + 2 appels Claude Batch.
- **Volumétrie** :
  - Sources par newsletter : 20-30
  - Items collectés par run : 100-300
  - Items après pré-filtre : 50-150 (gain levier 01)
  - Items envoyés par newsletter : ~25-30
  - Destinataires par newsletter : 5-30
- **Quotas Apps Script et Gmail à anticiper** (compte Gmail gratuit) :
  - **GmailApp.sendEmail()** : 100 destinataires/jour sur compte gratuit (1500/jour sur Workspace). À 6 newsletters × 30 destinataires = 180/jour si tout part le même jour → **PLAFOND DÉPASSÉ**. **Mitigation : étaler les jours d'envoi** (DSI lundi, Qualité mardi, etc.).
  - **UrlFetchApp** : 20 000 appels/jour — confortable
  - **Triggers** : 20 max par script — confortable (6 newsletters + 1 trigger récap hebdo)
  - **Durée d'exécution** : 6 min par trigger
- **Coût Claude API estimé** (DSI seule, Haiku 4.5 Batch ≈ 50 % du tarif standard) : ~1-3 €/mois. **Cible plateforme 6 newsletters** : ~6-15 €/mois.
- **Disponibilité** : hebdomadaire/mensuelle. Pas de SLA temps réel. Tolérance échec : report J+1 par relance manuelle admin.

## 8. CRITÈRES D'ACCEPTATION GLOBAUX

- [ ] Toutes les fonctions MUST HAVE plateforme (P1-P6) et pipeline (M1-M7) passent leurs critères d'acceptation
- [ ] Code versionné dans un dépôt Git (export `clasp` ou copie manuelle) ; README documente : structure des onglets Sheet, déploiement initial, ajout d'une newsletter, troubleshooting
- [ ] Jeu de données de test : un onglet `TEST` avec 3 sources factices, 1 destinataire de test, résultat HTML attendu documenté
- [ ] Documentation admin (2-3 pages) : structure de la Sheet, création d'une nouvelle newsletter, lecture des logs, gestion d'erreurs, rotation des clés API
- [ ] Documentation lecteur (1 page) : à quoi sert la newsletter, comment se désinscrire (v1 = mail à l'admin)
- [ ] Recette utilisateur DSI : 2 numéros consécutifs validés par 2 membres DSI sur la cohérence éditoriale, l'absence d'hallucination factuelle, le rendu mobile et desktop
- [ ] Cas d'erreur testés : source HS, Claude API rate-limitée, Gmail quota atteint, Sheet mal configurée → tous produisent un log explicite + mail admin si bloquant, jamais de crash silencieux

## 9. PLAN DE DÉPLOIEMENT

*(Cat 5 → 3 phases.)*

- **Phase 1 — Build plateforme + newsletter DSI (1-2 semaines)** : implémentation incréments 1-8, recette interne sur boîte de test
- **Phase 2 — Pilote DSI (4 semaines)** : envoi hebdo à 2-3 membres DSI volontaires, recueil de feedback à J+14 et J+28, ajustement prompts et sources
- **Phase 3 — Production DSI + roadmap des autres newsletters** :
  - Ouverture DSI à la liste complète
  - **v1.1 — Qualité/HAS** (~1 semaine de build par newsletter, principalement de la définition de sources + prompt + recette par référent métier)
  - **v1.2 — Biologistes scientifique**
  - **v1.3 — RH juridique**
  - **v1.4 — Économie BM**
  - **v1.5 — Compta/fisca** (cadence mensuelle)
  - Revue trimestrielle de toutes les newsletters : sources jamais retenues → désactivation ; coût Claude par newsletter → arbitrage modèle

## 10. HYPOTHÈSES ET ZONES GRISES

- **HYP1** : le compte `selasbioxa@gmail.com` est un compte Gmail gratuit (non Workspace) — *à confirmer par l'admin BIOXA.* Si Workspace, le quota d'envoi passe de 100 à 1500/jour et la mitigation « étaler les jours » devient optionnelle.
- **HYP2** : le budget Claude API ~5-15 €/mois pour la plateforme complète est validé — *à confirmer par la direction BIOXA.*
- **HYP3** : l'hébergement Google (potentiellement hors UE pour compte gratuit) est acceptable au regard de la politique data BIOXA pour les données traitées ici (emails internes + contenu public). *À confirmer par le DPO BIOXA.* Si non acceptable → bascule architecture C (Python intranet + SMTP BIOXA).
- **HYP4** : l'envoi depuis `selasbioxa@gmail.com` (domaine externe à BIOXA) est acceptable pour la communication interne — *à confirmer par la direction BIOXA.* Sinon, mise en place d'un SMTP relais BIOXA derrière GmailApp ou bascule sur Workspace BIOXA avec domaine `@bioxa.fr` (ou équivalent).
- **HYP5** : la liste de sources DSI Cyber+IA proposée en §6.1 est validée comme point de départ — *à valider par l'admin DSI.*
- **HYP6** : la déduplication globale plateforme (un item de cyberattaque qui apparaît dans la newsletter DSI ne ré-apparaîtra pas dans une autre newsletter si elle pointe sur la même source) est le comportement souhaité — *à confirmer par l'admin.* Alternative : dédup par newsletter (ajout d'une colonne `newsletter` au lookup).
- **HYP7** : les emails partant de `selasbioxa@gmail.com` ne déclenchent pas les filtres anti-spam des boîtes destinataires BIOXA — *à tester sur 3 destinataires de profils différents en début de phase 1.* Si problème : SPF/DKIM Workspace BIOXA, ou bascule SMTP relais.
- **HYP8** : Claude Haiku 4.5 + Batch est suffisant en qualité pour le pré-filtre ET le scoring/résumé FR — *à valider en incrément 3 sur un échantillon de 30 items.* Sinon, bascule scoring sur Sonnet 4.6 (toujours Batch), pré-filtre conservé sur Haiku.

## 11. ANNEXES

### A. Structure de la Google Sheet `BIOXA-Newsletters-Config`

**Onglet `_config`** (clés-valeurs globales)

| Clé | Valeur | Description |
|---|---|---|
| `claude_model` | `claude-haiku-4-5-20251001` | Modèle Claude par défaut |
| `claude_api_endpoint` | `https://api.anthropic.com/v1/messages/batches` | Endpoint Batch |
| `gmail_quota_jour` | `100` | Quota Gmail par jour (compte gratuit) |
| `admin_email` | `{email admin}` | Pour rapports et alertes |
| `dry_run_global` | `FALSE` | Bascule globale dry-run |

**Onglet `_historique`** : `url_hash` (string), `sent_at` (datetime), `newsletter` (string), `url` (string), `title` (string)

**Onglet `_logs`** : `timestamp`, `newsletter`, `nb_collectes`, `nb_pre_filtres`, `nb_scores`, `nb_envoyes`, `duree_sec`, `statut`, `message`

**Onglet `DSI` (et structure identique pour Qualite, RH, etc.)**
- Cellules en-tête (lignes 1-10) : Nom newsletter, Référent métier, Jour envoi (lundi/.../dimanche), Heure envoi, Cadence (hebdo/mensuel), N items par rubrique, Active (TRUE/FALSE)
- Cellule multi-lignes : Prompt système (avec préfixe `# v{date}` en première ligne)
- Tableau Sources (ligne ~15+) : `Active`, `Rubrique`, `Nom source`, `URL RSS`, `Filter keywords` (optionnel)
- Tableau Destinataires (à droite ou onglet séparé) : `Active`, `Email`, `Nom`

### B. Squelette du projet Apps Script


Code.gs                  // entry points executerNewsletterDSI, executerNewsletterRH, ...
src_config.gs            // lireConfig(idNewsletter)
src_collecte.gs          // collecterItems(idNewsletter, config)
src_dedup.gs             // dedoublonner(items)
src_claude.gs            // prefilterTitres(items, prompt), scorerEtResumer(items, prompt)
src_render.gs            // genererHTML(newsletter, items, config)
src_envoi.gs             // envoyerGmail(newsletter, html, destinataires)
src_logs.gs              // logRun(...), envoyerMailAdmin(...)
src_triggers.gs          // installerTriggers()
src_test.gs              // testerIASurUnItem(id, url), dryRun(id)


### C. Template HTML email (extrait)

html
<table width="100%" cellpadding="0" cellspacing="0" style="font-family:Arial,sans-serif;">
  <tr><td style="background:{{ couleur_newsletter }};color:#fff;padding:20px;">
    <h1>{{ nom_newsletter }}</h1>
    <p>{{ sous_titre_editorial }} — {{ date_envoi }}</p>
  </td></tr>
  {% for rubrique in rubriques %}
  <tr><td style="padding:20px;">
    <h2>{{ rubrique.label }}</h2>
    {% for item in rubrique.items %}
    <p><strong><a href="{{ item.url }}">{{ item.titre }}</a></strong><br>
      <small>{{ item.source }} · {{ item.date }}</small><br>
      {{ item.resume }}</p>
    {% endfor %}
  </td></tr>
  {% endfor %}
  <tr><td style="background:#eee;padding:10px;font-size:11px;color:#555;">
    Newsletter générée automatiquement — modèle de tri : {{ prompt_version }} —
    Désinscription : répondre à ce mail
  </td></tr>
</table>


### D. Exemple de prompt système (DSI Cyber+IA — à raffiner pendant le pilote)


# v2026-06-25
Tu tries des articles pour la newsletter hebdomadaire de la DSI d'un
laboratoire de biologie médicale (BIOXA).

Critères de pertinence par ordre décroissant :
1. Actionnable pour une DSI d'établissement de santé
2. Information stratégique majeure (modèle IA majeur, baisse de prix tokens)
3. Récence (≤ 7 j)
4. Qualité de la source

Renvoie strictement un JSON par item :
[{"url": "...", "score": 0-10, "resume_fr": "...", "raison": "..."}]

Le résumé fait ≤ 200 caractères, factuel, sans donnée chiffrée inventée.
Le titre n'est PAS à reformuler.


═══════════════════════════════════════════════════════════════
