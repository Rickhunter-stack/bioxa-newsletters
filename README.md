# bioxa-newsletters — Plateforme Apps Script

Plateforme multi-newsletter Google Apps Script pour BIOXA (SELAS).
Cahier des charges complet : [`PRD-plateforme-newsletters-bioxa.md`](./PRD-plateforme-newsletters-bioxa.md).
Conventions de code : [`CLAUDE.md`](./CLAUDE.md).

## État

**Incrément 1 — socle plateforme** (cf. PRD §6.5) :
- Squelette `Code.gs` (entry points) + constantes globales
- `lireConfig(idNewsletter)` : lecture centralisée de la Sheet → objet typé
- `testerLireConfig()` : test manuel qui logge la config DSI

Le pipeline (collecte → pré-filtre → scoring → rendu → envoi) arrive aux incréments suivants.

## Fichiers

| Fichier | Rôle |
|---|---|
| `Code.gs` | Entry points par newsletter (`executerNewsletterDSI`) + `executerNewsletter(id)` + constantes |
| `src_config.gs` | `lireConfig(idNewsletter)` — **unique point de lecture de la Sheet** |
| `src_test.gs` | Tests manuels (`testerLireConfig`) |
| `appsscript.json` | Manifest (timezone Europe/Paris, runtime V8) |

## Structure de la Google Sheet `BIOXA-Newsletters-Config`

### Onglet `_config` (clés/valeurs globales)
En-têtes ligne 1 : `Clé | Valeur`. Une ligne par paramètre.

| Clé | Valeur par défaut | Type | Description |
|---|---|---|---|
| `claude_model` | `claude-haiku-4-5-20251001` | string | Modèle Claude (configurable, levier S3) |
| `claude_api_endpoint` | `https://api.anthropic.com/v1/messages/batches` | string | Endpoint Message Batches |
| `gmail_quota_jour` | `100` | number | Quota Gmail/jour (compte gratuit) |
| `admin_email` | *(à remplir)* | string | Destinataire des rapports/alertes |
| `dry_run_global` | `FALSE` | bool | Bascule globale dry-run |

> La **clé API Anthropic** n'est PAS dans la Sheet : elle est stockée dans
> `PropertiesService.getScriptProperties()` sous `ANTHROPIC_API_KEY`.

### Onglet `_historique` (1 ligne par item envoyé)
En-têtes ligne 1 : `url_hash` · `sent_at` · `newsletter` · `url` · `title`.

### Onglet `_logs` (1 ligne par run)
En-têtes ligne 1 : `timestamp` · `newsletter` · `nb_collectes` · `nb_pre_filtres` · `nb_scores` · `nb_envoyes` · `duree_sec` · `statut` · `message`.

### Onglet `DSI` (template, identique pour `Qualite`, `RH`, …)
Quatre blocs dans le **même onglet**. `lireConfig` localise les tableaux par leurs
en-têtes (insensible à la casse), donc l'ordre exact des lignes est tolérant.

**Bloc 1 — Paramètres** (colonnes A/B, format clé/valeur) :

| Clé (col. A) | Exemple (col. B) | Type |
|---|---|---|
| `nom` | DSI — Cyber et IA | string |
| `referent_metier` | (nom du référent) | string |
| `jour_envoi` | lundi | string |
| `heure_envoi` | 8 | number |
| `cadence` | hebdo | string (`hebdo`/`mensuel`) |
| `n_items_par_rubrique` | 5 | number |
| `couleur` | `#1a3e5c` | string (hex en-tête HTML) |
| `sous_titre` | Veille cybersécurité & IA | string |
| `active` | TRUE | bool |

**Bloc 2 — Prompt système** : une ligne avec en col. A le libellé `prompt_systeme`
et en col. B le prompt (cellule multi-lignes). **1re ligne du prompt = label de
version** au format `# v2026-06-25` (repris dans le pied de la newsletter).

**Bloc 3 — Tableau Sources** (colonnes A-E, sous une ligne d'en-têtes) :

| Active | Rubrique | Nom source | URL RSS | Filter keywords |
|---|---|---|---|---|
| TRUE | Cyberattaques santé | CERT Santé | https://… | healthcare |

**Bloc 4 — Tableau Destinataires** (colonnes G-I, même onglet) :

| Active | Email | Nom |
|---|---|---|
| TRUE | … | … |

## Objet retourné par `lireConfig("DSI")`

```js
{
  id: "DSI",
  global: { claudeModel, claudeApiEndpoint, gmailQuotaJour, adminEmail, dryRunGlobal },
  nom, referentMetier, jourEnvoi, heureEnvoi, cadence,
  nItemsParRubrique, couleur, sousTitre, active,
  promptSysteme, promptVersion,            // version extraite de la 1re ligne "# v…"
  sources: [{ active, rubrique, nomSource, urlRss, filterKeywords }],
  destinataires: [{ active, email, nom }]
}
```

Politique **tolérante** : un bloc absent/vide produit un `Logger.log` warning et
une valeur par défaut (tableau vide, champ par défaut), jamais une exception —
sauf si la Sheet ou l'onglet de la newsletter est totalement introuvable.

## Tester (éditeur Apps Script)

1. Copier les fichiers `.gs` + `appsscript.json` dans le projet Apps Script (ou `clasp push`).
2. Si projet **autonome** : renseigner la Script Property `CONFIG_SHEET_ID` avec
   l'ID de la Sheet `BIOXA-Newsletters-Config`
   (`Paramètres du projet` → `Propriétés du script`).
   Si projet **lié** à la Sheet (container-bound), rien à faire.
3. Exécuter `testerLireConfig` et lire « Journaux d'exécution ».
   La config DSI s'affiche en JSON + contrôles rapides.

## Secrets

- `ANTHROPIC_API_KEY` → `PropertiesService` (jamais dans le code/Sheet/repo).
- `.gitignore` couvre `.env`, `.clasp.json`, fichiers de credentials.
