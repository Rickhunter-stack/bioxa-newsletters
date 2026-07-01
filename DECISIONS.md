# Décisions — plateforme newsletters BIOXA

Référence des choix d'implémentation qui ont un impact sur le **remplissage
manuel** de la Google Sheet. À lire si l'on contourne `initialiserSheetDeConfig()`
ou si un référent métier remplit/duplique un onglet à la main.

---

## Décisions implicites de l'incrément 1

Ces choix ont été pris en construisant `lireConfig`. Ils sont validés pour la v1
et conditionnent la façon dont la Sheet doit être remplie.

### Noms exacts des clés (bloc Paramètres, colonne A de l'onglet newsletter)
Snake_case français, **à taper exactement** (la lecture est insensible à la casse
mais pas aux fautes de frappe) :

| Clé (col. A) | Type attendu | Défaut si absent/vide |
|---|---|---|
| `nom` | texte | `""` |
| `referent_metier` | texte | `""` |
| `jour_envoi` | texte (`lundi`…`dimanche`) | `""` |
| `heure_envoi` | nombre (0–23) | `null` |
| `cadence` | texte (`hebdo`/`mensuel`) | `hebdo` |
| `n_items_par_rubrique` | nombre | `5` |
| `couleur` | texte (hex, ex. `#1a3e5c`) | `#1a3e5c` |
| `sous_titre` | texte | `""` |
| `active` | booléen | `false` |

La ligne du prompt système porte le libellé **`prompt_systeme`** (col. A),
contenu en col. B.

### Clés de l'onglet `_config`
`claude_model`, `claude_api_endpoint`, `gmail_quota_jour`, `admin_email`,
`dry_run_global` (cf. PRD §11 annexe A).

### Tokens booléens acceptés
- **Vrai** : `TRUE`, `VRAI`, `OUI`, `1` (+ case à cocher native = `true`).
- **Faux** : `FALSE`, `FAUX`, `NON`, `0` (+ case à cocher native = `false`).
- Toute autre valeur **présente** d'une cellule booléenne → défaut + warning dans
  les logs (`[lireConfig][WARN]`).

### Format de `promptVersion`
Extrait de la **première ligne** du prompt système, motif `# v…`. La valeur
retournée **conserve le préfixe `v`** : `# v2026-06-25` → `promptVersion = "v2026-06-25"`.
Ce label est repris dans le pied de la newsletter (incr. 4).

### Nombres
La **virgule décimale** est acceptée (`8,5` → `8.5`). Une cellule numérique
contenant du texte illisible → défaut + warning (pas de plantage).

### Robustesse générale
- Politique **tolérante** : un bloc absent/vide → valeur par défaut + warning,
  jamais d'exception. Seule exception qui lève : Sheet ou onglet de la newsletter
  introuvable.
- Tableaux Sources/Destinataires **localisés par signature d'en-tête** (insensible
  au décalage de lignes). Si un en-tête de signature manque (`Rubrique`/`URL RSS`
  pour Sources, `Email`/`Nom` pour Destinataires), le tableau entier est ignoré et
  le(s) en-tête(s) manquant(s) sont nommés dans le warning.

### Init de la Sheet
- `initialiserSheetDeConfig()` est **idempotente au niveau onglet** : un onglet
  existant est conservé tel quel (jamais écrasé). Pour régénérer un onglet, le
  supprimer d'abord à la main.
- L'onglet `DSI` est livré **neutre** (valeurs vides sauf défauts systémiques),
  pour servir de template duplicable. Les exemples DSI sont en Notes de cellules
  et dans la section ci-dessous.

---

## Exemples de remplissage pour la newsletter DSI Cyber+IA

Valeurs copiables par l'admin DSI après `initialiserSheetDeConfig()`.

### Bloc Paramètres (onglet `DSI`, colonnes A/B)

| Clé | Valeur DSI |
|---|---|
| `nom` | `DSI — Cyber et IA` |
| `referent_metier` | *(nom du référent SI)* |
| `jour_envoi` | `lundi` |
| `heure_envoi` | `8` |
| `cadence` | `hebdo` |
| `n_items_par_rubrique` | `5` |
| `couleur` | `#1a3e5c` |
| `sous_titre` | `Veille cybersécurité & IA` |
| `active` | `TRUE` *(une fois la config validée)* |

### Prompt système (`prompt_systeme`, col. B) — exemple à raffiner (PRD annexe D)

```
# v2026-06-25
Tu tries des articles pour la newsletter hebdomadaire de la DSI d'un
laboratoire de biologie médicale (BIOXA).

Critères de pertinence par ordre décroissant :
1. Actionnable pour une DSI d'établissement de santé
2. Information stratégique majeure (modèle IA majeur, baisse de prix tokens)
3. Récence (≤ 7 j)
4. Qualité de la source

Renvoie strictement un JSON par item :
[{"url": "...", "score": 0-10, "resume_fr": "...", "titre_traduction": "..."|null, "raison": "..."}]

Le résumé fait ≤ 200 caractères, factuel, sans donnée chiffrée inventée.
Le titre original n'est PAS à reformuler ni remplacer.
"titre_traduction" = traduction FR fidèle du titre (null si déjà en français).
```

> NB : l'instruction `titre_traduction` est aussi **ajoutée automatiquement en code**
> (`SUFFIXE_PROMPT_TRADUCTION`) au prompt de scoring — la fonctionnalité marche même
> si l'admin ne l'inscrit pas dans le prompt Sheet.

> Mettre à jour le label `# v{date}` à chaque modification du prompt.

### Tableau Sources (onglet `DSI`, colonnes A-E à partir de la ligne 13)

Sources proposées (PRD §6.1, **à valider par l'admin DSI — HYP5** ; les URL RSS
exactes sont à confirmer flux par flux). Format : `Active | Rubrique | Nom source | URL RSS | Filter keywords`.

| Rubrique | Nom source (exemples) |
|---|---|
| Cyberattaques santé | CERT Santé, CERT-FR, DataBreaches.net, BleepingComputer (kw `healthcare`), Le Mag IT (santé) |
| Cybersécurité générale | The Hacker News, Bleeping Computer, KrebsOnSecurity, Dark Reading, ANSSI alertes, Schneier on Security, SecurityWeek |
| Actualités IA / nouveaux modèles | Hugging Face Daily Papers, MarkTechPost, The Decoder, VentureBeat AI, Ars Technica AI, ArXiv cs.AI |
| Économie / coûts IA | Artificial Analysis, Reuters Tech, Bloomberg Tech, Semafor Tech, Stratechery |
| Nouvelles fonctionnalités LLM | Blog Anthropic, OpenAI Blog, Google DeepMind, Google AI Blog, xAI News, Simon Willison's Weblog |
| Modèles open source | Hugging Face Trending, r/LocalLLaMA (RSS), AI News (smol.ai), Together AI, Mistral AI, Meta AI |

Exemple d'une ligne Sources :

| Active | Rubrique | Nom source | URL RSS | Filter keywords |
|---|---|---|---|---|
| `TRUE` | `Cybersécurité` | `The Hacker News` | `https://feeds.thehackernews.com/...` | |

### Tableau Destinataires (onglet `DSI`, colonnes G-I à partir de la ligne 13)

Format : `Active | Email | Nom`. Adresses professionnelles internes BIOXA
(RGPD — cf. PRD §7.1). Exemple :

| Active | Email | Nom |
|---|---|---|
| `TRUE` | *(email pro interne)* | `Prénom Nom` |

---

## Décisions implicites de l'incrément 2 (collecte + déduplication)

### Canonicalisation d'URL (pour le hash de dédup)
Apps Script V8 **n'a pas de `new URL()`** → parsing manuel. La canonicalisation
s'applique à une copie ; le champ `url` affiché reste l'original (lien source).
- **Scheme + host en minuscule uniquement** ; path et query **conservés en casse**.
- **`www.`** de tête retiré ; **port par défaut** (`:80` http, `:443` https) retiré.
- **Trailing slash** retiré du path (`/a/` → `/a` ; racine `/` → vide).
- **Fragment `#…`** retiré.
- **Paramètres retirés** : préfixe **`utm_`** + **`fbclid`, `gclid`, `mc_cid`, `mc_eid`, `ref`**. Tous les autres conservés.
- **Paramètres restants triés alphabétiquement** (sinon `?a=1&b=2` ≠ `?b=2&a=1`).
- Hash : **SHA-256 hex** de la forme canonique.

### Item normalisé (contrat incr. 3/4/5)
`{ titre, url, source, rubrique, datePublication: Date|null, resumeBrut, urlHash: string|null }`
- `rubrique` portée **dès la collecte** ; `datePublication` en **`Date` natif** ;
  `resumeBrut` = description/summary HTML strippé, tronqué à **1000 car** ;
  `urlHash` renseigné par `dedoublonner()`.

### Collecte / fenêtre / filtres
- **Filter keywords** appliqué **à la collecte**, sur **titre + résumé**, sémantique **OR**.
  (Complémentaire du pré-filtre IA, qui n'est jamais bypassé.)
- **Fenêtre** = `now − 7 j` (hebdo) / `now − 30 j` (mensuel), glissante (pas « depuis dernier run »).
- **`pubDate` absente → item inclus** (tolérant) + compteur. Garde-fou : si **> 30 %**
  des items d'une source sont sans date → warning nominatif « candidat à investigation parsing ».
- **Dédup intra-run** : premier rencontré gagne (ordre des sources puis du flux).
- **Échec partiel** : jamais d'abort en collecte ; warning fort si **> 50 %** sources HS ;
  drapeau `santeCollecte` dans le retour (mail admin à l'incr. 5/8).
- **Repli séquentiel** (si `fetchAll` lève) borné à **5 min** ; sources restantes
  marquées `timeout cumulé`.

---

## Écarts au PRD (incrément 2)

1. **Canonical lowercase host+scheme seulement** (le PRD §6.2 dit « lowercase »
   sans préciser) — lowercaser le path/query fusionnerait des ressources
   distinctes. Comportement RFC-correct.
2. **Tri alphabétique des query params** (non mentionné au PRD) — indispensable,
   sinon deux URL équivalentes échappent à la dédup.
3. **Liste de params strippés étendue** au-delà de `utm_*` : `fbclid`, `gclid`,
   `mc_cid`, `mc_eid`, `ref` (trackers fréquents sur les RSS de newsletters).
4. **Timeout 30 s/requête non tenable** : `UrlFetchApp` n'expose pas de timeout
   par requête (défaut plateforme ~60 s, non réglable). Mitigation : cap 6 min
   Apps Script + chunking + budget 5 min sur le repli séquentiel.

---

## Limitations connues (incrément 2)

- **`XmlService` est strict** : un flux XML malformé fait échouer le parsing →
  la source est **ignorée et loggée** (pas de parseur tolérant maison).
- **Formats de date exotiques non gérés** : seuls RFC 822 (RSS) et ISO 8601
  (Atom), parsés nativement par V8, sont fiables. Tout autre format → date `null`
  → item **inclus** (cf. garde-fou 30 %).
- **RSS 1.0 (RDF) supporté** via correspondance par nom local d'élément
  (namespace-agnostique), mais **peu testé** faute de runtime local — à valider
  si une source RDF est rencontrée au pilote.
- **Pas de timeout par requête** (cf. écart #4).

---

## Décisions implicites de l'incrément 3 (appels Claude Batch)

### Architecture asynchrone — Option A (poll synchrone borné)
- `appelerClaudeBatch` crée le batch, **poll** `processing_status` jusqu'à `ended`
  dans un **budget de 4 min**, puis lit les résultats — le tout dans **un seul run**.
- Intervalle de poll : **10 s** (< 1 min écoulée) → **20 s** (< 2 min) → **30 s** ensuite.
- Budget dépassé → exception → **run annulé** (mail admin : incr. 5).
- **Bascule conditionnelle vers Option B** (machine à états sur 2 exécutions) si le
  pilote révèle des **latences > 5 min récurrentes** (cf. HYP8 du PRD).

### Granularité — Option 2 (batch de N requêtes)
- **1 requête par item**, `custom_id = urlHash` (SHA-256 hex, 64 car → conforme
  `^[a-zA-Z0-9_-]{1,64}$`). Résultats ré-appariés par `custom_id` (ordre non garanti).
- Robuste aux échecs isolés ; pré-filtre sur titres seuls (levier 01 préservé),
  **précède toujours** le scoring.

### Sorties structurées (`output_config.format`)
- **CONFIRMÉ supporté en Batches API** (doc Anthropic `batch-processing.md`, FAQ :
  « supports nearly all features… » ; `output_config` n'est PAS dans la liste
  d'exclusion `stream`/`speed`/`store`/`max_tokens:0`/…). Activées sur le pré-filtre
  (`{decision: oui|non}`) et le scoring (`{score, resume_fr, raison}`).
- **Parse défensif de repli conservé** (`_extraireSortie_` en try/catch) : une
  garantie API n'est jamais 100 %.
- Les contraintes numériques (`minimum`/`maximum`) ne sont **pas** supportées par
  les structured outputs → le score est **borné [0,10] en code** (`_bornerScore_`).

### Prompts
- **Pré-filtre : en dur dans Git** (constante `PROMPT_PREFILTER_TEMPLATE` dans
  `src_claude.gs`, versionnée `# prefilter v{date}`, `{{rubrique}}` substituée).
- **Scoring : `config.promptSysteme`** (prompt versionné de l'onglet newsletter).
  Absent → exception (scoring impossible).

### Coût (alimente le récap admin S4, incr. 8)
- Deux clés `_config` : `prix_input_per_million_tokens` (défaut **1**),
  `prix_output_per_million_tokens` (défaut **5**) — **prix catalogue Haiku 4.5 en USD**
  ($1 input / $5 output par M tokens, doc Anthropic). La **remise Batch −50 %** est
  appliquée dans le calcul (`REMISE_BATCH = 0.5`).
- Logué à chaque batch : `nb_items`, `tokens in/out` (réels, depuis `usage`), coût estimé.
- *Devise* : défauts en USD ; l'admin peut saisir des valeurs en € dans `_config`
  s'il préfère (le calcul utilise les valeurs telles quelles).

### Robustesse / retries
- Tous les appels HTTP via `_appelerAvecRetry_` : **2 retries** (backoff 2 s, 4 s) sur
  429/5xx et erreurs réseau ; 4xx non-retryable → exception immédiate. Jamais de catch muet.

### Politique sur les échecs d'item
- **Pré-filtre en échec/illisible → item CONSERVÉ** + warning (ne pas perdre un item
  potentiellement pertinent sur une erreur technique).
- **Scoring en échec/illisible → item ÉCARTÉ** + warning (non scoré = non classable).

---

## Écarts au PRD (incrément 3)

1. **« Un seul batch » et non « un seul appel HTTP »** (Option 2) — interprétation
   fidèle à l'esprit économique des Batches ; déviation du texte littéral PRD §M3/M4
   (« un seul appel Claude Batch ») **à corriger en v0.3 du PRD**.
2. **Option A retenue**, bascule conditionnelle vers Option B au pilote.
3. **Option C (`/v1/messages` synchrone) écartée** — la stack impose l'endpoint
   Batches (CLAUDE.md + PRD §6.4).
4. **Timeout 30 s/requête** : déjà non tenable (incr. 2) ; côté Claude, c'est le
   **budget de poll 4 min** qui borne, pas un timeout par requête.

---

## Points de vigilance pour les incréments 4-5

- **Latence batch ↔ budget 6 min.** Si le batch met **3+ min**, le pipeline aval
  (rendu HTML incr. 4 + envoi Gmail incr. 5) disposera de **< 3 min** restantes dans
  le même run. À surveiller ; déclencheur possible de la bascule Option B.
- Le **mail admin** sur échec Claude (run annulé) est un **hook préparé** (l'exception
  remonte) — à implémenter en incr. 5 (PRD P6).

---

## Limitations connues (incrément 3)

- **Pas de garantie de latence Batch** (max 24 h côté Anthropic) — le budget 4 min
  peut annuler un run ; mitigation = relance manuelle / bascule Option B.
- **Conversion de devise non gérée** : prix `_config` utilisés tels quels (défauts USD).
- **Score : pas de borne native** côté API (structured outputs sans contraintes
  numériques) — borné en code.

---

## Correctif — bug « dernière source toujours inactive » (post-incr. 2)

### Symptôme
La **dernière ligne** du tableau Sources ressortait systématiquement avec
`active: false`, quel que soit son contenu (1 source sur 3 jamais collectée,
silencieusement).

### Cause racine
Sources (A-E) et Destinataires (G-I) **partagent la même ligne d'en-tête**, et le
libellé **« Active »** y figure deux fois (colonne A et colonne G).
`_localiserTableau_` mappait **toute la ligne** en *dernier-écrit-gagne* →
`cols['active']` pointait sur la colonne **G** (Destinataires). `_lireSources_`
lisait donc le `active` de chaque source dans la colonne G ; pour les lignes plus
basses que la liste des destinataires (G vide), `_booleen_('')` = `false`.
(Les Destinataires lisaient juste, mais **par chance** — ils voulaient la dernière
occurrence.)

### Correctif
`_localiserTableau_` **scope les colonnes au segment contigu** de cellules non
vides qui porte la signature (`_segmentsContigus_`), avec *premier-écrit-gagne*
dans le segment. Sources → segment A-E (`active`→A) ; Destinataires → segment G-I
(`active`→G). Robuste même si l'ordre des tableaux est inversé.

### Limitation
Il faut **au moins une colonne vide** entre les deux tableaux (la colonne F du
template, garantie par `initialiserSheetDeConfig`). Si l'admin colle les deux
tableaux sans séparation, ils fusionnent en un seul segment ; le *premier-écrit-
gagne* donne alors quand même les bonnes colonnes du tableau de **gauche**.

### Comportement déterministe en cas d'ambiguïté
Si **plusieurs segments** portent la même signature (template cassé, tableau
parasite), un **WARNING `[ambiguïté détectée]`** est loggé (signature + colonnes de
début des segments candidats) et le **PREMIER segment** est retenu — comportement
prévisible plutôt que silencieux.

### Test de non-régression
`testerLireTableauxColonnes` (offline) reproduit le scénario A-E / F vide / G-I,
sources actives partout + destinataires partiellement remplis, et asserte que la
**dernière source** ressort `active: true` (échouait avant le fix). Test symétrique
sur les Destinataires + `testerLocaliserTableauAmbiguite` pour le garde-fou.

---

## Décisions implicites de l'incrément 4 (rendu HTML + dry-run)

### Rendu HTML (M5/M7)
- `genererHTML(config, items)` est **pur** (string → string, testable offline). Email-safe :
  tables + CSS inline ; conteneur interne **max-width 600px centré** + **media query**
  `@media only screen and (max-width:600px)` pour empiler les méta (source/date) en mobile.
- **Pied** : version du prompt (`config.promptVersion`, M7) + mention désinscription
  (v1 : « répondre à ce mail »).
- **Lien** : toujours `item.url` (source originale).
- **Ordre des rubriques** = ordre de **première apparition** dans la colonne Rubrique du
  tableau Sources (`config.sources`). Une rubrique qui réapparaît plus bas garde sa
  position d'origine ; une rubrique d'item absente des sources est ajoutée en fin.
  (Documenté dans `_grouperParRubrique_`.)

### Échappement HTML — nature
- Tout contenu de flux (titre, résumé, source) est **échappé** (`& < > " '`). L'échappement
  est une **transformation technique** (encodage des caractères), **pas une reformulation** :
  compatible avec la règle métier « titre verbatim » (la sémantique reste identique, seuls
  les caractères techniques sont encodés).

### Mode dry-run (S1)
- `executerNewsletter(idNewsletter, options)` : le paramètre `options` est **réintroduit**
  (il avait été retiré en incr. 1 ; désormais utilisé). `dryRun = options.dryRun || config.global.dryRunGlobal`.
- Livraison via `livrerNewsletter` (`src_envoi.gs`, nouveau) : en dry-run, écrit un **fichier
  HTML horodaté** (`dryrun-{id}-{aaaa-mm-jj_HH-MM}.html`) dans le dossier Drive `_drafts`.

### 0 item sélectionné
- Incr. 4 : on **logge et on s'arrête** (pas de rendu, pas de livraison).
- **HOOK incr. 5** : ce cas devra déclencher un **mail admin** « newsletter X : 0 item cette
  semaine — sources à investiguer ». À ne pas oublier à l'incrément 5.

---

## Écarts au PRD (incrément 4)

1. **Dry-run en fichier HTML** (`.html` ouvrable au navigateur, rendu fidèle de l'email)
   au lieu d'un « Doc Google » — déviation du texte PRD §6.3 (« Doc Google `dryrun-{date}` »),
   **à corriger en v0.3 du PRD**. Raison : un Doc afficherait le *source* HTML, pas le rendu.

---

## Limitations connues (incrément 4)

- **Compat email non vérifiable en sandbox** : le rendu sur Outlook desktop/web + Gmail
  (critère M5) reste à valider manuellement sur 3 clients au pilote.
- **`<style>` / media query** : supportés par la plupart des clients (Gmail moderne), mais
  certains clients legacy ignorent `<style>` — les styles inline assurent le rendu desktop
  de repli.
- **Sujet de l'email** : non généré en incr. 4 (différé à l'incr. 5, M6).

---

## Décisions implicites de l'incrément 5 (envoi réel + historique + logs + admin)

### Envoi Gmail (M6)
- **1 envoi par destinataire actif** (pas de BCC, pour journaliser par destinataire),
  **try/catch par destinataire** (un échec n'arrête pas les autres).
- **Sujet** : généré en code = `{nom} — {jj/mm/aaaa}` (non paramétrable en Sheet v1).
- **Expéditeur** : compte propriétaire du script (HYP4 : `selasbioxa@gmail.com`), pas
  d'override `from` ; nom d'affichage `BIOXA Veille` (`NOM_EXPEDITEUR`).
- **Quota** : arrêt si `min(GmailApp.getRemainingDailyQuota(), config.gmail_quota_jour)`
  est atteint en cours d'envoi → incident loggé + mail admin ; les déjà-envoyés restent partis.
- Corps texte de repli + `htmlBody` (rendu HTML).

### Historique (P4) / Logs (P5)
- **`_historique`** écrit **si ≥ 1 destinataire servi** (items réellement délivrés) —
  1 ligne/item (`url_hash, sent_at, newsletter, url, title`). Jamais en dry-run.
- **`_logs`** : **toujours** 1 ligne/run (bloc `finally`), même sur abort/0 item.
  Statuts : `OK` / `PARTIEL` / `VIDE` / `DRY-RUN` / `ERREUR`.
- Écritures **par en-tête** (`_ajouterLignesParEntetes_`) : robustes au décalage de
  colonnes, alignées sur la ligne 1 (cohérent avec `_lireColonneOnglet_`).

### Mail admin (P6)
Déclencheurs en incr. 5 : (a) **échec Claude/run annulé**, (b) **quota Gmail atteint**,
(c) **0 item sélectionné** (avec compte de sources HS). `admin_email` vide → warning, pas d'envoi.

### Rapport hebdo (S4)
- `envoyerRapportHebdo()` lit `_logs` sur **7 jours** → nb runs, **envois totaux**,
  **coût Claude total**, ventilation par newsletter ; envoyé à `admin_email`.
- Le **trigger « dimanche soir » est câblé à l'incrément 6** ; ici fonction lançable
  manuellement (`testerRapportHebdo`).

### Coût Claude persisté
- `prefilterTitres`/`scorerEtResumer` renvoient désormais **`{ items, usage }`** (refactor)
  pour remonter le `usage` tokens ; `executerNewsletter` somme et calcule le coût
  (`_calculerCout_`, remise Batch −50 %) écrit en colonne `cout_estime` de `_logs`.

---

## Écarts au PRD (incrément 5)

1. **S4 (rapport hebdo) anticipé en incr. 5** (le PRD §6.5 le plaçait en incr. 8). Validé.
2. **Colonne `cout_estime` ajoutée à `_logs`** — au-delà du schéma `_logs` du PRD §11
   annexe A (9 colonnes). Nécessaire au coût du rapport S4. **À acter en PRD v0.3.**
3. **S4 « sources jamais retenues sur 4 semaines » REPORTÉ** — nécessite une attribution
   par source dans `_historique` (colonne `source` absente v1). S4 livre nb envois + coût ;
   l'analyse des sources non retenues viendra quand on ajoutera `source` à `_historique`.

---

## Limitations connues (incrément 5)

- **`cout_estime` sur un `_logs` préexistant** : les onglets `_logs` créés avant l'incr. 5
  (9 colonnes) n'ont pas la colonne `cout_estime` → la valeur est ignorée + warning (pas
  de crash). Recréer l'onglet `_logs` (ou ajouter l'en-tête `cout_estime`) pour l'activer.
- **Quota Gmail compte gratuit** : 100 envois/jour, tous newsletters confondues
  (`getRemainingDailyQuota` est global au compte) — étaler les jours d'envoi (PRD §7.4).
- **Envoi réel non testable en sandbox** : `testerEnvoiReelDSI` envoie de vrais emails —
  à lancer manuellement vers une boîte de test.

---

## Traduction FR additive des titres (feat, post-incr. 5)

### Règle métier (modifiée — actée dans CLAUDE.md + PRD v0.3)
Le **titre original reste conservé VERBATIM** depuis le flux RSS (jamais reformulé ni
remplacé). Une **traduction française additionnelle** (`titreTraduction`) est générée
par Claude au scoring et affichée **en complément**, jamais à la place du titre original.

### Sortie du scoring (M4)
`{ score, resume_fr, titre_traduction (string|null), raison }`. Schéma structured
outputs : `titre_traduction` est **`required` mais nullable** (`type: ["string","null"]`)
→ Claude doit émettre le champ (`null` si le titre est déjà français). Mappé sur
`item.titreTraduction` (`''` si null/absent — fallback défensif).

### Instruction
Ajoutée **en code** au prompt système de scoring (`SUFFIXE_PROMPT_TRADUCTION`) → feature
auto-contenue, indépendante du prompt Sheet.

### Détection de langue (double garde)
1. **Claude** : renvoie `null` si le titre est déjà en français (jugement primaire).
2. **Code** (`_estFrancais_`, rudimentaire) : `true` si accent FR (`é è ê ë à â ä ç ô ö î ï ù û ü`)
   OU ≥ 2 mots FR fréquents (`le la les des du un une et pour avec dans sur…`).
La traduction n'est **affichée que si** `titreTraduction` non vide **ET** `_estFrancais_(titre)`
est `false` — garde contre une traduction parasite sur un titre déjà FR.

### Rendu
Titre original = lien titre (verbatim, échappé) ; **traduction FR en sous-titre gris
italique, juste sous le titre**, avant la méta source · date.

### Comportement si `titre_traduction` absent/illisible
Traité comme `null` → **aucune traduction affichée**, item rendu normalement (pas de crash).

### Limitation
Détection de langue **rudimentaire** (accents + mots fréquents) : un titre anglais sans
accent contenant par coïncidence ≥ 2 tokens ressemblant à des mots FR pourrait être
classé FR à tort (rare). Suffisant pour la v1.

---

## Dette technique — latence du batch pré-filtre (post-incr. 5)

### Contrainte
Le pré-filtre repose sur un **batch synchrone borné à 4 min de polling** (Option A,
incr. 3). Au-delà, le run est **annulé proprement** (garde-fou). Observé en prod :
DSI passée de 3 à 12 sources → **232 items** → batch de 222 requêtes **> 4 min** → run annulé.

### Solution transitoire (retenue — fix pragmatique, pas de refactor)
Deux leviers bornent le volume envoyé au pré-filtre :
1. **Fenêtre de collecte `FENETRE_JOURS_HEBDO` = 3 j** (au lieu de 7). ~232 → ~100 items.
   **⚠️ Dépendance éditoriale** (documentée aussi en commentaire dans `src_collecte.gs`) :
   3 jours ne tient QUE si le run est déclenché un **jour fixe hebdomadaire** (trigger
   temporel, **incr. 6**). Tant que ce trigger n'existe pas, un **run manuel espacé de
   > 3 j** du précédent crée un **trou de couverture silencieux** (items J-7 à J-3 jamais vus).
2. **`PLAFOND_ITEMS_PAR_RUBRIQUE_AVANT_PREFILTRE` = 25** (`plafonnerParRubrique`,
   appliqué APRÈS dédup + split par rubrique) : par rubrique, si volume **> 25** (strict),
   tri date desc + troncature (sans-date écartés en premier) ; sinon inchangé. Log **par
   rubrique**. 5 rubriques → **max 125 items** au pré-filtre (vs 222).

### Solution long terme (à faire quand le volume dépasse ~300 items)
Bascule vers l'**architecture asynchrone** (Option B, écartée en incr. 3) : un **trigger
horaire `verifierBatchsPendants`** reprend les batchs Claude terminés hors du run, au lieu
de poller synchroniquement dans les 6 min d'un run. Supprime la contrainte des 4 min.

---

## Incrément 6 — Triggers temporels (`src_triggers.gs`)

### Modèle « dispatcher unique » (Option B retenue)
UN seul trigger temporel appelle `executerNewsletterPlanifiee()`, qui lit la config et
exécute les newsletters (et le rapport hebdo) **dues** à l'instant courant. Avantages vs
« un trigger natif par newsletter » (Option A) : **1 seul trigger** (quota 20 confortable),
**ajout d'une newsletter sans code** (un onglet actif suffit), cadence mensuelle gérée en
code. Coût : la logique « qui est dû ? » vit dans le code, pas dans le trigger natif.

### Découverte des newsletters
Onglets **non préfixés `_`** dont la config résout `active === true` (`_newslettersActives_`).
Un onglet résiduel (« Feuille 1 ») est écarté naturellement (config → `active=false`).

### Rapport hebdo (S4) — clés dans `_config` GLOBAL
`rapport_hebdo_jour` (défaut `lundi`) et `rapport_hebdo_heure` (défaut `8`) vivent dans
l'onglet `_config` **transverse**, pas dans une newsletter : le rapport agrège toutes les
newsletters et ne doit pas dépendre de l'état `active` de l'une d'elles. `admin_email` vide
⇒ pas d'envoi (garde-fou existant), donc le défaut est sûr même non configuré.

### Fuseau horaire — constante `FUSEAU_PLATEFORME` (`Europe/Paris`)
`appsscript.json` est déjà en `Europe/Paris` (pas UTC). Le littéral, jusqu'ici dupliqué 4×
(`src_envoi` ×2, `src_init`, `src_render`), est factorisé en **constante unique**
`FUSEAU_PLATEFORME` (Code.gs), réutilisée par le dispatcher. Choix : **constante de code**
(cohérente avec `appsscript.json`) plutôt que clé Sheet — un fuseau ne change jamais et une
désync Sheet/manifest serait un piège. `jour_envoi`/`heure_envoi` sont donc interprétés en
heure de Paris, conforme à l'attente de l'utilisateur de la Sheet.

### Cadence `mensuel` — sémantique
`mensuel` = **première occurrence** du `jour_envoi` dans le mois. La 1re occurrence d'un
jour de semaine tombe toujours entre le 1 et le 7 → condition `jourDuMois <= 7`. `jour_envoi`
reste donc un **jour de semaine** (pas un numéro de jour du mois), cohérent avec `hebdo`.

### Garde-fous double-déclenchement (un trigger Apps Script *drifte*)
1. **`LockService`** : `executerNewsletterPlanifiee` prend un verrou script (`tryLock` 30 s).
   Deux dispatches concurrents ne peuvent pas s'exécuter ensemble.
2. **Contrôle `_logs`** (`_aDejaTourneAujourdhui_` / cœur pur `_creneauDejaServi_`) : on saute
   une newsletter (ou le rapport, id réservé `_rapport_hebdo`) déjà loggée aujourd'hui à cette
   `heure_envoi` → **pas de double coût Claude ni de double envoi Gmail**. Contrôle **en amont**
   de la collecte (skip = zéro coût).

### HYP / écarts assumés
- **HYP6a — échantillonnage 30 min, pas 60.** Le trigger tire toutes les **30 min**
  (`INTERVALLE_DISPATCH_MIN`) et non toutes les heures : un trigger « horaire » Apps Script
  peut, par drift, **sauter une heure d'horloge** et donc rater un envoi hebdo (une seule
  chance/semaine). Sur-échantillonner garantit que chaque `heure_envoi` est vue ; le garde-fou
  `_logs` rend le 2e passage inoffensif. Écart au « trigger horaire » proposé — justifié :
  rater un envoi est pire qu'une lecture `_logs` supplémentaire. **Validé (arbitrage incr. 6).**

  **Vérification quota (compte gratuit consumer).** 30 min → **48 déclenchements/jour**. Le
  quota contraignant est le **temps d'exécution total des triggers = 90 min/jour** (+ 6 min max
  par exécution) ; il n'existe pas de quota consumer séparé sur le *nombre* de déclenchements.
  Charge estimée : un dispatch « à vide » (rien de dû, ~46-47 fois/jour) se limite à quelques
  lectures `SpreadsheetApp` (`_newslettersActives_` + `lireConfig` + `_config`) → ~2-4 s
  (`_estDueMaintenant_` sort en `false` sans lire `_logs`) ⇒ **~2,5 min/jour** d'overhead idle.
  Un jour d'envoi ajoute **une** exécution lourde (collecte + poll batch ≤ 4 min + envoi) ≈ 5 min,
  charge indépendante de l'intervalle. **Pire cas ~7-8 min/jour, soit > 10× sous les 90 min**, et
  chaque exécution reste sous les 6 min. Passer de 60 à 30 min n'ajoute que ~1,3 min idle/jour.
- **HYP6b — slot en échec non rejoué le jour même.** Le garde-fou `_logs` saute tout créneau
  déjà loggé *quel que soit le statut* (y compris `ERREUR`) : un run échoué n'est pas rejoué
  automatiquement dans la journée (l'opérateur relance à la main). Évite qu'un échec *après
  envoi* provoque un double-envoi.
- Le rapport hebdo écrit une ligne `_logs` (`newsletter = _rapport_hebdo`, `nb_* = 0`) pour
  armer son garde-fou. Effet de bord mineur : `envoyerRapportHebdo` compte ces lignes dans son
  `nbRuns` (coût/envois inchangés car à 0).

### Test manuel
- Offline : **`testerTriggersDispatch`** (décision `_estDueMaintenant_` hebdo/mensuel + cas
  limites, garde-fou `_creneauDejaServi_`) — aucun trigger créé, aucune Sheet touchée.
- Réel : **`installerTriggers`** (crée le trigger de dispatch), **`supprimerTriggers`** (purge).

---

## Sources DSI — ANSSI institutionnel vs CERT-FR (ajout post-incr. 6)

Ajout d'une source **institutionnelle** ANSSI (référentiels, publications, événements),
**distincte** du fil technique CERT-FR (alertes/avis de vulnérabilités) déjà présent :

| Active | Rubrique | Nom source | URL RSS | Filter keywords |
|---|---|---|---|---|
| `TRUE` | `Cybersécurité` | `ANSSI - Actualités` | `https://cyber.gouv.fr/actualites/rss/` | |

Les deux flux couvrent des contenus de nature différente (institutionnel vs alertes
techniques) ; un chevauchement est peu probable, et la **déduplication globale par hash
d'URL** (`_historique`, incr. 2) suffit à écarter un éventuel doublon inter-sources.

> ⚠️ **Non vérifié en CI** : l'environnement d'exécution Claude Code **bloque `cyber.gouv.fr`**
> (policy réseau, 403) et n'a pas de runtime Apps Script. La validité du flux (répond,
> parse correctement, rubrique peuplée) doit être confirmée par l'admin via **`testerCollecte`**
> après collage de la ligne dans l'onglet `DSI`.
