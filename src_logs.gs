/**
 * src_logs.gs — Persistance et notifications (PRD P4 _historique, P5 _logs,
 * P6 mail admin, S4 rapport hebdo).
 *
 * Écritures Sheet centralisées par en-tête (robustes au décalage de colonnes,
 * cohérentes avec _lireColonneOnglet_ côté lecture). Tout via _ouvrirSheetConfig_.
 */

/**
 * Écrit une ligne par item dans `_historique` (P4, déduplication globale).
 * @param {string} idNewsletter
 * @param {Array.<Object>} items Items envoyés (urlHash, url, titre).
 * @return {number} Nombre de lignes écrites.
 */
function ecrireHistorique(idNewsletter, items) {
  if (!items || !items.length) {
    return 0;
  }
  var maintenant = new Date();
  var objets = items.map(function(it) {
    return {
      url_hash: _texte_(it.urlHash),
      sent_at: maintenant,
      newsletter: idNewsletter,
      url: _texte_(it.url),
      title: _texte_(it.titre)
    };
  });
  return _ajouterLignesParEntetes_(ONGLETS_TECHNIQUES.historique, objets);
}

/**
 * Écrit une ligne de run dans `_logs` (P5).
 * @param {string} idNewsletter
 * @param {{nbCollectes: number, nbPreFiltres: number, nbScores: number,
 *          nbEnvoyes: number, dureeSec: number, statut: string, message: string,
 *          coutEstime: number}} compteurs
 * @return {number} 1 si écrit, 0 sinon.
 */
function logRun(idNewsletter, compteurs) {
  var objet = {
    timestamp: new Date(),
    newsletter: idNewsletter,
    nb_collectes: compteurs.nbCollectes || 0,
    nb_pre_filtres: compteurs.nbPreFiltres || 0,
    nb_scores: compteurs.nbScores || 0,
    nb_envoyes: compteurs.nbEnvoyes || 0,
    duree_sec: compteurs.dureeSec || 0,
    statut: compteurs.statut || '',
    message: compteurs.message || '',
    cout_estime: compteurs.coutEstime || 0
  };
  return _ajouterLignesParEntetes_(ONGLETS_TECHNIQUES.logs, [objet]);
}

/**
 * Envoie une alerte à l'admin (P6). Si admin_email est vide → warning, pas d'envoi.
 * @param {Object} config Config (lireConfig) — global.adminEmail.
 * @param {string} sujet
 * @param {string} corps
 * @return {void}
 */
function envoyerMailAdmin(config, sujet, corps) {
  var email = (config && config.global) ? _texte_(config.global.adminEmail) : '';
  if (email === '') {
    Logger.log('[admin][WARN] admin_email vide — alerte non envoyée : %s', sujet);
    return;
  }
  try {
    GmailApp.sendEmail(email, sujet, corps);
    Logger.log('[admin] Mail admin envoyé à %s : %s', email, sujet);
  } catch (e) {
    Logger.log('[admin][WARN] Échec envoi mail admin : %s', e.message);
  }
}

/**
 * Rapport hebdo (S4) : récap des 7 derniers jours depuis `_logs` (nb envois +
 * coût Claude estimé, par newsletter). Envoyé à admin_email. Le trigger « dimanche
 * soir » est câblé à l'incrément 6 ; ici la fonction est lançable manuellement.
 *
 * NB : la liste « sources jamais retenues sur 4 semaines » du PRD S4 est REPORTÉE
 * (nécessite une attribution par source dans `_historique`, non disponible v1).
 * @return {void}
 */
function envoyerRapportHebdo() {
  var global;
  try {
    global = _lireConfigGlobale_(_ouvrirSheetConfig_());
  } catch (e) {
    Logger.log('[rapport][WARN] Config globale illisible : %s', e.message);
    return;
  }
  if (_texte_(global.adminEmail) === '') {
    Logger.log('[rapport][WARN] admin_email vide — rapport hebdo non envoyé.');
    return;
  }

  var lignes = _lireLignesParEntetes_(ONGLETS_TECHNIQUES.logs);
  var limite = (new Date()).getTime() - 7 * 24 * 60 * 60 * 1000;
  var totalEnvois = 0;
  var totalCout = 0;
  var parNewsletter = {};
  var nbRuns = 0;
  lignes.forEach(function(l) {
    var t = l['timestamp'];
    if (!(t instanceof Date) || t.getTime() < limite) {
      return;
    }
    nbRuns++;
    var envois = Number(l['nb_envoyes']) || 0;
    var cout = Number(l['cout_estime']) || 0;
    totalEnvois += envois;
    totalCout += cout;
    var nl = _texte_(l['newsletter']) || '?';
    parNewsletter[nl] = (parNewsletter[nl] || 0) + envois;
  });

  var corps = 'Rapport hebdo BIOXA — veille (7 derniers jours)\n\n' +
    'Runs : ' + nbRuns + '\n' +
    'Envois totaux : ' + totalEnvois + '\n' +
    'Coût Claude estimé : ' + totalCout.toFixed(4) + '\n\n' +
    'Par newsletter :\n' +
    Object.keys(parNewsletter).map(function(k) {
      return '  - ' + k + ' : ' + parNewsletter[k] + ' envois';
    }).join('\n') +
    '\n\n(Liste « sources jamais retenues » : à venir — cf. DECISIONS.md.)';

  try {
    GmailApp.sendEmail(global.adminEmail, '[BIOXA] Rapport hebdo veille', corps);
    Logger.log('[rapport] Rapport hebdo envoyé à %s (%s runs, %s envois).',
      global.adminEmail, nbRuns, totalEnvois);
  } catch (e) {
    Logger.log('[rapport][WARN] Échec envoi rapport hebdo : %s', e.message);
  }
}

/* ──────────────────────────────────────────────────────────────────────────
 * Écriture / lecture par en-tête (privés, robustes au décalage de colonnes).
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Ajoute des lignes à un onglet en plaçant chaque valeur sous sa colonne (repérée
 * par l'en-tête de la ligne 1). Une clé sans en-tête correspondant est ignorée + warning.
 * @param {string} nomOnglet
 * @param {Array.<Object>} objets
 * @return {number} Nombre de lignes ajoutées.
 * @private
 */
function _ajouterLignesParEntetes_(nomOnglet, objets) {
  if (!objets || !objets.length) {
    return 0;
  }
  var onglet = _ouvrirSheetConfig_().getSheetByName(nomOnglet);
  if (!onglet) {
    Logger.log('[logs][WARN] Onglet "%s" absent — écriture annulée.', nomOnglet);
    return 0;
  }
  var dernCol = onglet.getLastColumn();
  if (dernCol < 1) {
    Logger.log('[logs][WARN] Onglet "%s" sans en-tête — écriture annulée.', nomOnglet);
    return 0;
  }
  var entetes = onglet.getRange(1, 1, 1, dernCol).getValues()[0].map(function(h) {
    return _texte_(h).toLowerCase();
  });
  var lignes = objets.map(function(obj) {
    return _construireLigneParEntetes_(entetes, obj);
  });
  onglet.getRange(onglet.getLastRow() + 1, 1, lignes.length, dernCol).setValues(lignes);
  return lignes.length;
}

/**
 * Construit une ligne (tableau aligné sur les en-têtes) à partir d'un objet
 * {nom_colonne: valeur}. Clé absente des en-têtes → ignorée + warning. (Pur.)
 * @param {Array.<string>} entetesLower En-têtes en minuscules.
 * @param {!Object} objet
 * @return {Array}
 * @private
 */
function _construireLigneParEntetes_(entetesLower, objet) {
  var ligne = [];
  for (var i = 0; i < entetesLower.length; i++) {
    ligne.push('');
  }
  for (var cle in objet) {
    if (!Object.prototype.hasOwnProperty.call(objet, cle)) {
      continue;
    }
    var idx = entetesLower.indexOf(cle.toLowerCase());
    if (idx === -1) {
      Logger.log('[logs][WARN] Colonne "%s" absente de l\'onglet — valeur ignorée.', cle);
      continue;
    }
    ligne[idx] = objet[cle];
  }
  return ligne;
}

/**
 * Lit toutes les lignes d'un onglet en objets {nom_colonne_minuscule: valeur}.
 * @param {string} nomOnglet
 * @return {Array.<!Object>}
 * @private
 */
function _lireLignesParEntetes_(nomOnglet) {
  var onglet = _ouvrirSheetConfig_().getSheetByName(nomOnglet);
  if (!onglet) {
    Logger.log('[logs][WARN] Onglet "%s" absent.', nomOnglet);
    return [];
  }
  var dernLigne = onglet.getLastRow();
  var dernCol = onglet.getLastColumn();
  if (dernLigne < 2 || dernCol < 1) {
    return [];
  }
  var valeurs = onglet.getRange(1, 1, dernLigne, dernCol).getValues();
  var entetes = valeurs[0].map(function(h) { return _texte_(h).toLowerCase(); });
  var out = [];
  for (var r = 1; r < valeurs.length; r++) {
    var obj = {};
    for (var c = 0; c < entetes.length; c++) {
      if (entetes[c]) {
        obj[entetes[c]] = valeurs[r][c];
      }
    }
    out.push(obj);
  }
  return out;
}
