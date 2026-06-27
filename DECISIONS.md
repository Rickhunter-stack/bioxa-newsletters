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
[{"url": "...", "score": 0-10, "resume_fr": "...", "raison": "..."}]

Le résumé fait ≤ 200 caractères, factuel, sans donnée chiffrée inventée.
Le titre n'est PAS à reformuler.
```

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
