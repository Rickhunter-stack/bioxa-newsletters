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
