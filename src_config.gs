/**
 * src_config.gs — Lecture centralisée de la configuration depuis la Google Sheet.
 *
 * Règle CLAUDE.md : toute lecture de la Sheet passe par lireConfig(idNewsletter).
 * Aucun SpreadsheetApp.getActive() éparpillé ailleurs dans le code.
 *
 * Politique de robustesse (arbitrage incr. 1) : TOLÉRANT.
 * Un bloc absent ou vide produit un warning (Logger.log) et une valeur par
 * défaut (tableau vide, champ null) — jamais une exception, sauf si la Sheet
 * ou l'onglet de la newsletter est totalement introuvable.
 */

/**
 * Valeurs par défaut de l'onglet `_config` (utilisées si une clé manque).
 * @const
 */
var CONFIG_GLOBALE_DEFAUTS = {
  claude_model: 'claude-haiku-4-5-20251001',
  claude_api_endpoint: 'https://api.anthropic.com/v1/messages/batches',
  gmail_quota_jour: 100,
  admin_email: '',
  dry_run_global: false
};

/**
 * Schéma du bloc « Paramètres newsletter » (colonnes A/B de l'onglet).
 * Mappe la clé telle qu'écrite dans la Sheet → propriété de l'objet retourné + type.
 * @const
 */
var PARAMS_NEWSLETTER = [
  { cle: 'nom',                  prop: 'nom',               type: 'string', defaut: '' },
  { cle: 'referent_metier',     prop: 'referentMetier',    type: 'string', defaut: '' },
  { cle: 'jour_envoi',          prop: 'jourEnvoi',         type: 'string', defaut: '' },
  { cle: 'heure_envoi',         prop: 'heureEnvoi',        type: 'number', defaut: null },
  { cle: 'cadence',             prop: 'cadence',           type: 'string', defaut: 'hebdo' },
  { cle: 'n_items_par_rubrique', prop: 'nItemsParRubrique', type: 'number', defaut: 5 },
  { cle: 'couleur',             prop: 'couleur',           type: 'string', defaut: '#1a3e5c' },
  { cle: 'sous_titre',          prop: 'sousTitre',         type: 'string', defaut: '' },
  { cle: 'active',              prop: 'active',            type: 'bool',   defaut: false }
];

/**
 * Lit la configuration complète d'une newsletter : config globale (`_config`)
 * + onglet de la newsletter (paramètres, prompt système, sources, destinataires).
 *
 * @param {string} idNewsletter Identifiant = nom de l'onglet (ex: "DSI").
 * @return {{
 *   id: string,
 *   global: {claudeModel: string, claudeApiEndpoint: string, gmailQuotaJour: number,
 *            adminEmail: string, dryRunGlobal: boolean},
 *   nom: string, referentMetier: string, jourEnvoi: string, heureEnvoi: ?number,
 *   cadence: string, nItemsParRubrique: number, couleur: string, sousTitre: string,
 *   active: boolean, promptSysteme: ?string, promptVersion: ?string,
 *   sources: Array.<{active: boolean, rubrique: string, nomSource: string,
 *                    urlRss: string, filterKeywords: string}>,
 *   destinataires: Array.<{active: boolean, email: string, nom: string}>
 * }} Objet de configuration typé.
 * @throws {Error} Si la Sheet de config ou l'onglet `idNewsletter` est introuvable.
 */
function lireConfig(idNewsletter) {
  if (!idNewsletter) {
    throw new Error('lireConfig : idNewsletter manquant.');
  }

  var classeur = _ouvrirSheetConfig_();
  var ongletNl = classeur.getSheetByName(idNewsletter);
  if (!ongletNl) {
    throw new Error('lireConfig : onglet introuvable pour la newsletter "' + idNewsletter + '".');
  }

  var valeurs = ongletNl.getDataRange().getValues();

  var config = {
    id: idNewsletter,
    global: _lireConfigGlobale_(classeur)
  };

  // Bloc 1 — Paramètres (colonnes A/B, clé/valeur)
  var params = _lireBlocParametres_(valeurs, idNewsletter);
  for (var p in params) {
    config[p] = params[p];
  }

  // Bloc 2 — Prompt système (+ extraction du label de version `# v…`)
  config.promptSysteme = _lirePromptSysteme_(valeurs, idNewsletter);
  config.promptVersion = _extraireVersionPrompt_(config.promptSysteme);

  // Bloc 3 — Sources ; Bloc 4 — Destinataires
  config.sources = _lireSources_(valeurs, idNewsletter);
  config.destinataires = _lireDestinataires_(valeurs, idNewsletter);

  return config;
}

/* ──────────────────────────────────────────────────────────────────────────
 * Helpers privés (suffixe `_` = convention Apps Script « non exporté »).
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Ouvre la Sheet de config : par ID stocké en Script Property si présent,
 * sinon la Sheet liée au conteneur. Aucun ID en dur (cf. CLAUDE.md).
 * @return {GoogleAppsScript.Spreadsheet.Spreadsheet}
 * @throws {Error} Si aucune Sheet n'est accessible.
 * @private
 */
function _ouvrirSheetConfig_() {
  var id = PropertiesService.getScriptProperties().getProperty(PROP_ID_SHEET_CONFIG);
  if (id) {
    try {
      return SpreadsheetApp.openById(id);
    } catch (e) {
      throw new Error('Impossible d\'ouvrir la Sheet de config (ID="' + id + '") : ' + e.message);
    }
  }
  var actif = SpreadsheetApp.getActiveSpreadsheet();
  if (!actif) {
    throw new Error('Sheet de config introuvable : définir la Script Property "' +
      PROP_ID_SHEET_CONFIG + '" avec l\'ID de "' + NOM_SHEET_CONFIG + '".');
  }
  return actif;
}

/**
 * Lecteur générique : retourne les valeurs d'une colonne (repérée par son
 * en-tête en ligne 1) d'un onglet quelconque. Point d'accès unifié en lecture
 * réutilisé par src_dedup (incr. 2) et l'observabilité (_logs/_historique, incr. 5+).
 * Onglet ou colonne absent(e) → [] + warning (jamais d'exception).
 *
 * @param {string} nomOnglet Nom de l'onglet.
 * @param {string} nomColonne En-tête de colonne (insensible à la casse).
 * @return {Array.<*>} Valeurs de la colonne (hors en-tête), ordre de la feuille.
 */
function _lireColonneOnglet_(nomOnglet, nomColonne) {
  var onglet = _ouvrirSheetConfig_().getSheetByName(nomOnglet);
  if (!onglet) {
    Logger.log('[lecture][WARN] Onglet "%s" absent — colonne "%s" non lue.', nomOnglet, nomColonne);
    return [];
  }
  var dernLigne = onglet.getLastRow();
  var dernCol = onglet.getLastColumn();
  if (dernLigne < 1 || dernCol < 1) {
    return [];
  }
  var entetes = onglet.getRange(1, 1, 1, dernCol).getValues()[0];
  var idx = -1;
  for (var c = 0; c < entetes.length; c++) {
    if (_texte_(entetes[c]).toLowerCase() === _texte_(nomColonne).toLowerCase()) {
      idx = c;
      break;
    }
  }
  if (idx === -1) {
    Logger.log('[lecture][WARN] Colonne "%s" introuvable dans "%s".', nomColonne, nomOnglet);
    return [];
  }
  if (dernLigne < 2) {
    return [];
  }
  var valeurs = onglet.getRange(2, idx + 1, dernLigne - 1, 1).getValues();
  var sortie = [];
  for (var r = 0; r < valeurs.length; r++) {
    sortie.push(valeurs[r][0]);
  }
  return sortie;
}

/**
 * Lit l'onglet `_config` global (clé/valeur) avec valeurs par défaut + typage.
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} classeur
 * @return {{claudeModel: string, claudeApiEndpoint: string, gmailQuotaJour: number,
 *           adminEmail: string, dryRunGlobal: boolean}}
 * @private
 */
function _lireConfigGlobale_(classeur) {
  var brut = {};
  var onglet = classeur.getSheetByName(ONGLET_CONFIG);
  if (!onglet) {
    Logger.log('[lireConfig][WARN] Onglet "%s" absent : valeurs globales par défaut utilisées.', ONGLET_CONFIG);
  } else {
    var valeurs = onglet.getDataRange().getValues();
    for (var i = 0; i < valeurs.length; i++) {
      var cle = _texte_(valeurs[i][0]);
      if (cle && cle.toLowerCase() !== 'clé' && cle.toLowerCase() !== 'cle') {
        brut[cle] = valeurs[i][1];
      }
    }
  }

  // Présent = clé connue dans la Sheet avec une valeur non vide.
  function present(cle) {
    return Object.prototype.hasOwnProperty.call(brut, cle) && _texte_(brut[cle]) !== '';
  }
  function typer(cle, type) {
    return present(cle)
      ? _typerAvecWarning_(brut[cle], type, CONFIG_GLOBALE_DEFAUTS[cle], ONGLET_CONFIG, cle)
      : CONFIG_GLOBALE_DEFAUTS[cle];
  }

  return {
    claudeModel: typer('claude_model', 'string'),
    claudeApiEndpoint: typer('claude_api_endpoint', 'string'),
    gmailQuotaJour: typer('gmail_quota_jour', 'number'),
    adminEmail: typer('admin_email', 'string'),
    dryRunGlobal: typer('dry_run_global', 'bool')
  };
}

/**
 * Lit le bloc « Paramètres newsletter » (colonnes A/B en clé/valeur) selon
 * PARAMS_NEWSLETTER. Clés absentes → défaut + warning.
 * @param {Array.<Array>} valeurs Grille getDataRange().getValues() de l'onglet.
 * @param {string} idNewsletter
 * @return {!Object} Map prop → valeur typée.
 * @private
 */
function _lireBlocParametres_(valeurs, idNewsletter) {
  // Ne retenir QUE les clés connues, en PREMIER-écrit-gagne. Le bloc paramètres
  // est en haut de l'onglet ; les en-têtes du tableau Sources situé plus bas
  // (colonne A « Active ») ne doivent donc PAS écraser le paramètre `active` de
  // la newsletter (bug corrigé — audit incr. 1, point #1).
  var clesConnues = {};
  for (var k = 0; k < PARAMS_NEWSLETTER.length; k++) {
    clesConnues[PARAMS_NEWSLETTER[k].cle] = true;
  }

  var brut = {};
  for (var i = 0; i < valeurs.length; i++) {
    var cle = _texte_(valeurs[i][0]).toLowerCase();
    if (cle && clesConnues[cle] && !Object.prototype.hasOwnProperty.call(brut, cle)) {
      brut[cle] = valeurs[i][1]; // premier-écrit-gagne
    }
  }

  var resultat = {};
  for (var j = 0; j < PARAMS_NEWSLETTER.length; j++) {
    var def = PARAMS_NEWSLETTER[j];
    var present = Object.prototype.hasOwnProperty.call(brut, def.cle) &&
      _texte_(brut[def.cle]) !== '';
    if (!present) {
      Logger.log('[lireConfig][WARN] %s : paramètre "%s" absent/vide → défaut (%s).',
        idNewsletter, def.cle, def.defaut);
      resultat[def.prop] = def.defaut;
      continue;
    }
    resultat[def.prop] = _typerAvecWarning_(
      brut[def.cle], def.type, def.defaut, idNewsletter, def.cle);
  }
  return resultat;
}

/**
 * Lit la cellule « prompt_systeme » (colonne A = libellé, colonne B = contenu).
 * @param {Array.<Array>} valeurs
 * @param {string} idNewsletter
 * @return {?string} Prompt système, ou null si absent.
 * @private
 */
function _lirePromptSysteme_(valeurs, idNewsletter) {
  for (var i = 0; i < valeurs.length; i++) {
    if (_texte_(valeurs[i][0]).toLowerCase() === 'prompt_systeme') {
      var prompt = _texte_(valeurs[i][1]);
      if (!prompt) {
        Logger.log('[lireConfig][WARN] %s : cellule "prompt_systeme" vide.', idNewsletter);
        return null;
      }
      return prompt;
    }
  }
  Logger.log('[lireConfig][WARN] %s : ligne "prompt_systeme" introuvable.', idNewsletter);
  return null;
}

/**
 * Extrait le label de version d'un prompt (1re ligne au format « # v2026-06-25 »).
 * @param {?string} prompt
 * @return {?string} Ex: "v2026-06-25", ou null si non versionné.
 * @private
 */
function _extraireVersionPrompt_(prompt) {
  if (!prompt) {
    return null;
  }
  var premiere = prompt.split('\n')[0];
  var m = premiere.match(/#\s*(v\S+)/i);
  return m ? m[1] : null;
}

/**
 * Lit le tableau Sources (en-têtes : Active, Rubrique, Nom source, URL RSS,
 * Filter keywords). Localisé par signature d'en-tête, robuste au décalage.
 * @param {Array.<Array>} valeurs
 * @param {string} idNewsletter
 * @return {Array.<{active: boolean, rubrique: string, nomSource: string,
 *                  urlRss: string, filterKeywords: string}>}
 * @private
 */
function _lireSources_(valeurs, idNewsletter) {
  var tab = _localiserTableau_(valeurs, ['rubrique', 'url rss']);
  if (!tab.trouve) {
    Logger.log('[lireConfig][WARN] %s : tableau Sources introuvable — en-tête(s) manquant(s) : %s.',
      idNewsletter, tab.manquants.join(', '));
    return [];
  }
  var cols = tab.colonnes;
  var sources = [];
  for (var r = tab.ligneEnTete + 1; r < valeurs.length; r++) {
    var ligne = valeurs[r];
    var url = _texte_(_cell_(ligne, cols['url rss']));
    var nom = _texte_(_cell_(ligne, cols['nom source']));
    if (!url && !nom) {
      break; // fin du tableau (ligne vide)
    }
    sources.push({
      active: _booleen_(_cell_(ligne, cols['active'])),
      rubrique: _texte_(_cell_(ligne, cols['rubrique'])),
      nomSource: nom,
      urlRss: url,
      filterKeywords: _texte_(_cell_(ligne, cols['filter keywords']))
    });
  }
  return sources;
}

/**
 * Lit le tableau Destinataires (en-têtes : Active, Email, Nom), situé à droite
 * dans le même onglet. Localisé par signature d'en-tête.
 * @param {Array.<Array>} valeurs
 * @param {string} idNewsletter
 * @return {Array.<{active: boolean, email: string, nom: string}>}
 * @private
 */
function _lireDestinataires_(valeurs, idNewsletter) {
  var tab = _localiserTableau_(valeurs, ['email', 'nom']);
  if (!tab.trouve) {
    Logger.log('[lireConfig][WARN] %s : tableau Destinataires introuvable — en-tête(s) manquant(s) : %s.',
      idNewsletter, tab.manquants.join(', '));
    return [];
  }
  var cols = tab.colonnes;
  var dests = [];
  for (var r = tab.ligneEnTete + 1; r < valeurs.length; r++) {
    var ligne = valeurs[r];
    var email = _texte_(_cell_(ligne, cols['email']));
    if (!email) {
      break;
    }
    dests.push({
      active: _booleen_(_cell_(ligne, cols['active'])),
      email: email,
      nom: _texte_(_cell_(ligne, cols['nom']))
    });
  }
  return dests;
}

/**
 * Localise un tableau par sa ligne d'en-tête : trouve la première ligne
 * contenant TOUS les libellés requis (insensible à la casse). Si aucune ligne
 * ne matche complètement, renvoie `trouve:false` + la liste des en-têtes
 * manquants de la meilleure ligne candidate (pour un warning explicite, #6).
 * @param {Array.<Array>} valeurs
 * @param {Array.<string>} enTetesRequis En minuscules.
 * @return {{trouve: boolean, ligneEnTete: number,
 *           colonnes: !Object.<string, number>, manquants: Array.<string>}}
 * @private
 */
function _localiserTableau_(valeurs, enTetesRequis) {
  var meilleursManquants = enTetesRequis.slice();
  for (var r = 0; r < valeurs.length; r++) {
    var cols = {};
    for (var c = 0; c < valeurs[r].length; c++) {
      var libelle = _texte_(valeurs[r][c]).toLowerCase();
      if (libelle) {
        cols[libelle] = c;
      }
    }
    var manquants = [];
    for (var i = 0; i < enTetesRequis.length; i++) {
      if (!Object.prototype.hasOwnProperty.call(cols, enTetesRequis[i])) {
        manquants.push(enTetesRequis[i]);
      }
    }
    if (manquants.length === 0) {
      return { trouve: true, ligneEnTete: r, colonnes: cols, manquants: [] };
    }
    if (manquants.length < meilleursManquants.length) {
      meilleursManquants = manquants;
    }
  }
  return { trouve: false, ligneEnTete: -1, colonnes: {}, manquants: meilleursManquants };
}

/* ── Conversions / typage défensif ──────────────────────────────────────── */

/**
 * Récupère une cellule par index ; renvoie '' si index indéfini ou hors borne.
 * @param {Array} ligne
 * @param {?number} idx
 * @return {*}
 * @private
 */
function _cell_(ligne, idx) {
  return (typeof idx === 'number' && idx < ligne.length) ? ligne[idx] : '';
}

/**
 * Convertit une valeur PRÉSENTE (non vide) selon un type cible, et logge un
 * warning si le parsing échoue (cellule présente mais illisible → défaut, #2).
 * @param {*} valeur Valeur brute non vide.
 * @param {string} type 'string' | 'number' | 'bool'
 * @param {*} defaut Valeur de repli en cas d'échec de parsing.
 * @param {string} contexte Identifiant pour le log (idNewsletter ou '_config').
 * @param {string} cle Nom de la clé/paramètre pour le log.
 * @return {*}
 * @private
 */
function _typerAvecWarning_(valeur, type, defaut, contexte, cle) {
  if (type === 'number') {
    var rn = _parserNombre_(valeur);
    if (!rn.ok) {
      Logger.log('[lireConfig][WARN] %s : "%s" = "%s" non numérique → défaut (%s).',
        contexte, cle, _texte_(valeur), defaut);
      return defaut;
    }
    return rn.valeur;
  }
  if (type === 'bool') {
    var rb = _parserBooleen_(valeur);
    if (!rb.ok) {
      Logger.log('[lireConfig][WARN] %s : "%s" = "%s" non booléen → défaut (%s).',
        contexte, cle, _texte_(valeur), defaut);
      return defaut;
    }
    return rb.valeur;
  }
  return _texte_(valeur);
}

/**
 * Normalise en chaîne « trimée » ; null/undefined → ''.
 * @param {*} v
 * @return {string}
 * @private
 */
function _texte_(v) {
  return (v === null || v === undefined) ? '' : String(v).trim();
}

/**
 * Parse un nombre. Accepte le natif et la virgule décimale.
 * @param {*} v
 * @return {{ok: boolean, valeur: ?number}} ok=false si non vide et illisible.
 * @private
 */
function _parserNombre_(v) {
  if (typeof v === 'number') {
    return { ok: true, valeur: v };
  }
  var n = parseFloat(_texte_(v).replace(',', '.'));
  return isNaN(n) ? { ok: false, valeur: null } : { ok: true, valeur: n };
}

/**
 * Parse un booléen. Vrai : true/vrai/oui/1. Faux : false/faux/non/0.
 * @param {*} v
 * @return {{ok: boolean, valeur: boolean}} ok=false si non vide et non reconnu.
 * @private
 */
function _parserBooleen_(v) {
  if (typeof v === 'boolean') {
    return { ok: true, valeur: v };
  }
  var s = _texte_(v).toLowerCase();
  if (s === 'true' || s === 'vrai' || s === 'oui' || s === '1') {
    return { ok: true, valeur: true };
  }
  if (s === 'false' || s === 'faux' || s === 'non' || s === '0') {
    return { ok: true, valeur: false };
  }
  return { ok: false, valeur: false };
}

/**
 * Convertit en booléen sans warning (contextes où l'échec → false est anodin,
 * ex. colonne `Active` d'une ligne de source/destinataire).
 * @param {*} v
 * @return {boolean}
 * @private
 */
function _booleen_(v) {
  return _parserBooleen_(v).valeur;
}
