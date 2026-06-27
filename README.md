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
| `src_config.gs` | `lireConfig(idNewsletter)` + `_lireColonneOnglet_` — **lectures Sheet centralisées** |
| `src_init.gs` | `initialiserSheetDeConfig()` — crée les onglets manquants (idempotent) ; `_ecrireSheet_` = unique point d'écriture |
| `src_collecte.gs` | `collecterItems(idNewsletter, config)` — collecte RSS/Atom parallèle (PRD M1) |
| `src_dedup.gs` | `dedoublonner(items, idNewsletter)` — dédup par hash d'URL vs `_historique` (PRD M2) |
| `src_test.gs` | Tests manuels (`testerInitialiserSheet`, `testerLireConfig`, `testerCanonicaliserUrl`, `testerCollecte`, `testerCollecteEtDedup`) |
| `appsscript.json` | Manifest (timezone Europe/Paris, runtime V8) |
| `DECISIONS.md` | Décisions implicites (clés exactes, tokens, formats) + exemples de remplissage DSI |

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

### Onglet `DSI` (template neutre, identique pour `Qualite`, `RH`, …)
Quatre blocs dans le **même onglet**. `lireConfig` localise les tableaux par leurs
en-têtes (insensible à la casse), donc l'ordre exact des lignes est tolérant.

> L'onglet créé par `initialiserSheetDeConfig()` est **neutre** : cellules de config
> vides (sauf défauts systémiques), exemples DSI en **Notes de cellules**. Cela
> permet de **dupliquer l'onglet** pour créer une autre newsletter sans héritage de
> valeurs DSI. Exemples de remplissage DSI copiables : voir `DECISIONS.md`.

**Bloc 1 — Paramètres** (colonnes A/B, format clé/valeur). Clés col. A :
`nom`, `referent_metier`, `jour_envoi`, `heure_envoi` (0–23), `cadence`
(`hebdo`/`mensuel`), `n_items_par_rubrique`, `couleur` (hex), `sous_titre`,
`active` (bool). Défauts systémiques pré-remplis par l'init : `cadence=hebdo`,
`n_items_par_rubrique=5`, `couleur=#1a3e5c`, `active=FALSE`.

**Bloc 2 — Prompt système** : une ligne, col. A = libellé `prompt_systeme`,
col. B = prompt (multi-lignes). **1re ligne = label de version** `# v2026-06-25`
(repris dans le pied de la newsletter).

**Bloc 3 — Tableau Sources** (colonnes A-E, en-têtes ligne 13) :
`Active | Rubrique | Nom source | URL RSS | Filter keywords`.

**Bloc 4 — Tableau Destinataires** (colonnes G-I même onglet, en-têtes ligne 13) :
`Active | Email | Nom`.

Conventions de remplissage (clés exactes, tokens booléens, formats) : `DECISIONS.md`.

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
2. Créer une Sheet vierge `BIOXA-Newsletters-Config`. Si projet **autonome** :
   renseigner la Script Property `CONFIG_SHEET_ID` avec son ID
   (`Paramètres du projet` → `Propriétés du script`). Si projet **lié** à la Sheet
   (container-bound), rien à faire.
3. Exécuter **`testerInitialiserSheet`** : crée les 4 onglets avec en-têtes,
   défauts et exemples (Notes). Idempotent (relançable sans risque).
4. (Optionnel) remplir l'onglet `DSI` avec les exemples de `DECISIONS.md`.
5. Exécuter **`testerLireConfig`** et lire « Journaux d'exécution » : la config DSI
   s'affiche en JSON + contrôles rapides.
6. **`testerCanonicaliserUrl`** : test offline (sans réseau) de la canonicalisation
   d'URL + hash de déduplication.
7. **`testerCollecte`** / **`testerCollecteEtDedup`** : collecte RSS réelle des
   sources DSI (réseau requis) ; logge items par rubrique, sources HS et compteurs
   de déduplication.

## Secrets

- `ANTHROPIC_API_KEY` → `PropertiesService` (jamais dans le code/Sheet/repo).
- `.gitignore` couvre `.env`, `.clasp.json`, fichiers de credentials.
