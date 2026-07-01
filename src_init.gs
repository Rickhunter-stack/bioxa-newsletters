/**
 * src_init.gs — Initialisation idempotente de la Google Sheet de configuration.
 *
 * `initialiserSheetDeConfig()` crée les onglets manquants (_config, _historique,
 * _logs, DSI) avec en-têtes, défauts systémiques et exemples (en Notes). Lancée
 * manuellement par l'admin depuis l'éditeur Apps Script, elle supprime la
 * friction de création à la main (cf. audit incr. 1, point #3).
 *
 * Idempotence au niveau ONGLET : un onglet déjà présent est conservé tel quel,
 * jamais écrasé. Toutes les écritures passent par l'unique helper `_ecrireSheet_`
 * (miroir en écriture de `_ouvrirSheetConfig_` côté lecture).
 *
 * IMPORTANT — l'onglet DSI est livré comme TEMPLATE NEUTRE : les cellules de
 * configuration sont vides (sauf défauts applicables à toute newsletter), et les
 * exemples DSI vivants sont en Notes + dans DECISIONS.md. Objectif : dupliquer
 * l'onglet pour créer une autre newsletter (Qualite, RH…) sans héritage de
 * valeurs DSI.
 */

/**
 * Crée et pré-remplit les onglets manquants de la Sheet de config.
 * Non destructif : n'écrit jamais dans un onglet déjà existant.
 * @return {void}
 * @throws {Error} Si la Sheet de config est introuvable (cf. _ouvrirSheetConfig_).
 */
function initialiserSheetDeConfig() {
  var classeur = _ouvrirSheetConfig_();

  var attendus = [ONGLETS_TECHNIQUES.config, ONGLETS_TECHNIQUES.historique,
    ONGLETS_TECHNIQUES.logs, 'DSI'];
  var builders = {};
  builders[ONGLETS_TECHNIQUES.config] = _initOngletConfig_;
  builders[ONGLETS_TECHNIQUES.historique] = _initOngletHistorique_;
  builders[ONGLETS_TECHNIQUES.logs] = _initOngletLogs_;
  builders['DSI'] = _initOngletDSI_;

  var crees = [];
  var conserves = [];
  for (var i = 0; i < attendus.length; i++) {
    var nom = attendus[i];
    if (classeur.getSheetByName(nom)) {
      conserves.push(nom);
      Logger.log('[init] Onglet "%s" : existe déjà → conservé (non modifié).', nom);
      continue;
    }
    builders[nom](classeur);
    crees.push(nom);
    Logger.log('[init] Onglet "%s" : créé et pré-rempli.', nom);
  }

  var residuels = classeur.getSheets()
    .map(function(s) { return s.getName(); })
    .filter(function(n) { return attendus.indexOf(n) === -1; });

  Logger.log('[init] Récap — créés: [%s] | conservés: [%s] | résiduels hors périmètre: [%s]',
    crees.join(', '), conserves.join(', '), residuels.join(', '));
  if (residuels.length) {
    Logger.log('[init] Note : onglet(s) résiduel(s) laissé(s) en place (ex. « Feuille 1 » ' +
      'd\'une Sheet neuve) — à supprimer manuellement si inutile.');
  }
}

/* ──────────────────────────────────────────────────────────────────────────
 * Builders par onglet (appelés uniquement si l'onglet est absent).
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Onglet `_config` : en-têtes + 5 clés globales (défauts), admin_email vide.
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} classeur
 * @return {void}
 * @private
 */
function _initOngletConfig_(classeur) {
  var lignes = [
    ['Clé', 'Valeur'],
    ['claude_model', CONFIG_GLOBALE_DEFAUTS.claude_model],
    ['claude_api_endpoint', CONFIG_GLOBALE_DEFAUTS.claude_api_endpoint],
    ['gmail_quota_jour', CONFIG_GLOBALE_DEFAUTS.gmail_quota_jour],
    ['admin_email', ''],
    ['dry_run_global', CONFIG_GLOBALE_DEFAUTS.dry_run_global],
    ['prix_input_per_million_tokens', CONFIG_GLOBALE_DEFAUTS.prix_input_per_million_tokens],
    ['prix_output_per_million_tokens', CONFIG_GLOBALE_DEFAUTS.prix_output_per_million_tokens],
    ['rapport_hebdo_jour', CONFIG_GLOBALE_DEFAUTS.rapport_hebdo_jour],
    ['rapport_hebdo_heure', CONFIG_GLOBALE_DEFAUTS.rapport_hebdo_heure]
  ];
  _ecrireSheet_(classeur, ONGLET_CONFIG, 'A1', lignes, {
    notes: {
      'B5': 'À renseigner : email de l\'admin (rapports, alertes). Laissé vide par l\'init.',
      'B9': 'Planification du rapport hebdo (S4), TRANSVERSE aux newsletters. ' +
        'Jour en toutes lettres minuscules (lundi…dimanche). Interprété en Europe/Paris.',
      'B10': 'Heure d\'envoi du rapport hebdo, entier 0–23. Interprété en Europe/Paris.'
    }
  });
}

/**
 * Onglet `_historique` : ligne d'en-têtes (1 ligne par item envoyé, incr. 5).
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} classeur
 * @return {void}
 * @private
 */
function _initOngletHistorique_(classeur) {
  _ecrireSheet_(classeur, ONGLETS_TECHNIQUES.historique, 'A1',
    [['url_hash', 'sent_at', 'newsletter', 'url', 'title']]);
}

/**
 * Onglet `_logs` : ligne d'en-têtes (1 ligne par run, incr. 5).
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} classeur
 * @return {void}
 * @private
 */
function _initOngletLogs_(classeur) {
  _ecrireSheet_(classeur, ONGLETS_TECHNIQUES.logs, 'A1',
    [['timestamp', 'newsletter', 'nb_collectes', 'nb_pre_filtres', 'nb_scores',
      'nb_envoyes', 'duree_sec', 'statut', 'message', 'cout_estime']]);
}

/**
 * Onglet `DSI` : template neutre. Bloc paramètres A1:B9 (vide sauf défauts
 * systémiques), prompt_systeme ligne 11 (vide + Note), en-têtes Sources A13:E13
 * et Destinataires G13:I13 avec ligne d'exemple vide documentée en Note.
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} classeur
 * @return {void}
 * @private
 */
function _initOngletDSI_(classeur) {
  var aujourdhui = Utilities.formatDate(new Date(), FUSEAU_PLATEFORME, 'yyyy-MM-dd');

  // Défauts applicables à TOUTE newsletter (pas de valeur spécifique DSI ici).
  var defautsSystemiques = {
    cadence: 'hebdo',
    n_items_par_rubrique: 5,
    couleur: '#1a3e5c',
    active: false
  };
  var notesParCle = {
    nom: 'Exemple DSI : « DSI — Cyber et IA ». Nom affiché en en-tête de la newsletter.',
    referent_metier: 'Référent métier de la newsletter (facultatif). Exemple : responsable SI.',
    jour_envoi: 'Jour d\'envoi en toutes lettres, minuscules : lundi…dimanche. Exemple DSI : lundi.',
    heure_envoi: 'Heure d\'envoi, entier 0–23. Exemple DSI : 8.',
    cadence: 'hebdo ou mensuel. Défaut systémique : hebdo.',
    n_items_par_rubrique: 'Nombre d\'items retenus par rubrique. Défaut : 5.',
    couleur: 'Couleur hex de l\'en-tête HTML. Exemple DSI : #1a3e5c.',
    sous_titre: 'Sous-titre éditorial. Exemple DSI : « Veille cybersécurité & IA ».',
    active: 'TRUE pour activer l\'envoi. Laissée FALSE tant que la config n\'est pas finalisée.'
  };

  // Bloc paramètres A1:B9 (col A = clé, col B = valeur vide ou défaut systémique).
  var params = [];
  var notesParams = {};
  for (var i = 0; i < PARAMS_NEWSLETTER.length; i++) {
    var cle = PARAMS_NEWSLETTER[i].cle;
    var valeur = Object.prototype.hasOwnProperty.call(defautsSystemiques, cle)
      ? defautsSystemiques[cle] : '';
    params.push([cle, valeur]);
    notesParams['A' + (i + 1)] = notesParCle[cle];
  }
  _ecrireSheet_(classeur, 'DSI', 'A1', params, { notes: notesParams });

  // prompt_systeme ligne 11 : cellule B vide, format expliqué en Note.
  _ecrireSheet_(classeur, 'DSI', 'A11', [['prompt_systeme', '']], {
    notes: {
      'B11': 'Première ligne OBLIGATOIRE : # v{date} (ex. # v' + aujourdhui + '). ' +
        'Lignes suivantes : consigne de tri/résumé (cf. PRD annexe D). ' +
        'Exemple complet copiable dans DECISIONS.md.'
    }
  });

  // En-têtes Sources A13:E13 + ligne d'exemple vide (ligne 14) documentée en Note.
  _ecrireSheet_(classeur, 'DSI', 'A13',
    [['Active', 'Rubrique', 'Nom source', 'URL RSS', 'Filter keywords']], {
      notes: {
        'A14': 'Ligne d\'exemple (laissée vide). Format : Active=FALSE | ' +
          'Rubrique=Cybersécurité | Nom source=The Hacker News | URL RSS=https://… | ' +
          'Filter keywords=healthcare. Liste complète des sources DSI dans DECISIONS.md.'
      }
    });

  // En-têtes Destinataires G13:I13 + ligne d'exemple vide (ligne 14) documentée en Note.
  _ecrireSheet_(classeur, 'DSI', 'G13', [['Active', 'Email', 'Nom']], {
    notes: {
      'G14': 'Ligne d\'exemple (laissée vide). Format : Active=TRUE | ' +
        'Email=exemple@example.com | Nom=Prénom Nom. Voir DECISIONS.md.'
    }
  });
}

/* ──────────────────────────────────────────────────────────────────────────
 * Helper d'écriture — unique point d'accès en écriture à la Sheet.
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Écrit un bloc de valeurs (et, optionnellement, des Notes) dans un onglet,
 * en le créant s'il n'existe pas. Miroir en écriture de `_ouvrirSheetConfig_`.
 *
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} classeur
 * @param {string} nomOnglet Nom de l'onglet cible (créé si absent).
 * @param {string} ancrageA1 Cellule haut-gauche du bloc (ex: "A1", "G13").
 * @param {?Array.<Array>} valeurs2D Bloc de valeurs ; ignoré si vide/null.
 * @param {{notes?: !Object.<string, string>}} [options] Notes par adresse A1.
 * @return {GoogleAppsScript.Spreadsheet.Sheet} L'onglet écrit.
 * @private
 */
function _ecrireSheet_(classeur, nomOnglet, ancrageA1, valeurs2D, options) {
  var onglet = classeur.getSheetByName(nomOnglet);
  if (!onglet) {
    onglet = classeur.insertSheet(nomOnglet);
  }

  if (valeurs2D && valeurs2D.length && valeurs2D[0].length) {
    var coin = onglet.getRange(ancrageA1);
    onglet.getRange(coin.getRow(), coin.getColumn(), valeurs2D.length, valeurs2D[0].length)
      .setValues(valeurs2D);
  }

  if (options && options.notes) {
    for (var a1 in options.notes) {
      if (Object.prototype.hasOwnProperty.call(options.notes, a1)) {
        onglet.getRange(a1).setNote(options.notes[a1]);
      }
    }
  }

  return onglet;
}
