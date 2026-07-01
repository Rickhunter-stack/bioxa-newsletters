/**
 * src_triggers.gs — Planification automatique des newsletters (PRD incr. 6).
 *
 * Modèle « dispatcher unique » (Option B, arbitrage incr. 6) : UN SEUL trigger
 * temporel appelle `executerNewsletterPlanifiee()`, qui lit la config et exécute
 * les newsletters (et le rapport hebdo) DUES à l'instant courant. Ajouter une
 * newsletter ne demande donc aucun code : il suffit d'un onglet actif dans la Sheet.
 *
 * Fuseau : tous les calculs jour/heure se font en FUSEAU_PLATEFORME (Code.gs).
 *
 * Garde-fous contre le double-déclenchement (drift des triggers Apps Script) :
 *  1. LockService — deux dispatches concurrents ne peuvent pas s'exécuter ensemble ;
 *  2. `_logs` — on saute une newsletter déjà exécutée aujourd'hui à cette heure_envoi
 *     (évite double coût Claude + double envoi Gmail).
 */

/** Fonction cible du trigger temporel (dispatcher). */
var FONCTION_DISPATCH = 'executerNewsletterPlanifiee';

/**
 * Identifiant réservé du rapport hebdo dans `_logs` (colonne newsletter). Permet
 * au rapport de bénéficier du MÊME garde-fou anti-double-run que les newsletters.
 */
var ID_RUN_RAPPORT_HEBDO = '_rapport_hebdo';

/**
 * Quota Apps Script : 20 triggers/projet. Le modèle B n'en crée qu'UN, mais on
 * garde une borne défensive au cas où d'autres triggers coexisteraient.
 */
var MAX_TRIGGERS_PROJET = 20;

/**
 * Cadence d'échantillonnage du dispatcher. Toutes les 30 min (et non 60) pour
 * GARANTIR que chaque `heure_envoi` est bien vue malgré le drift des triggers
 * Apps Script (un trigger « horaire » peut sauter une heure d'horloge). Le
 * garde-fou `_logs` rend le sur-échantillonnage inoffensif : le 2e passage dans
 * la même heure est un no-op. Écart assumé au « trigger horaire » proposé — cf.
 * DECISIONS.md (justifié : rater un envoi hebdo est pire qu'une lecture `_logs`).
 */
var INTERVALLE_DISPATCH_MIN = 30;

/** Jours de semaine en français, indexés sur le pattern ISO 'u' (1 = lundi). */
var JOURS_SEMAINE_FR = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];

/* ──────────────────────────────────────────────────────────────────────────
 * Installation / désinstallation (lancées manuellement par l'admin).
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * (Ré)installe le trigger de dispatch. Idempotent : purge d'abord les triggers
 * gérés (même fonction cible) puis en recrée un — relançable sans créer de doublon.
 * @return {void}
 * @throws {Error} Si le quota de triggers du projet serait dépassé.
 */
function installerTriggers() {
  supprimerTriggers();

  var existants = ScriptApp.getProjectTriggers().length;
  if (existants + 1 > MAX_TRIGGERS_PROJET) {
    throw new Error('installerTriggers : quota de ' + MAX_TRIGGERS_PROJET +
      ' triggers atteint (' + existants + ' déjà présents hors dispatch). Purge manuelle requise.');
  }

  ScriptApp.newTrigger(FONCTION_DISPATCH)
    .timeBased()
    .everyMinutes(INTERVALLE_DISPATCH_MIN)
    .create();

  Logger.log('[trigger] Installé : "%s" toutes les %s min (dispatch newsletters + rapport hebdo).',
    FONCTION_DISPATCH, INTERVALLE_DISPATCH_MIN);
  Logger.log('[trigger] Le dispatcher lit jour_envoi/heure_envoi (fuseau %s) et n\'exécute que ' +
    'les newsletters DUES et non déjà servies ce jour à cette heure.', FUSEAU_PLATEFORME);
}

/**
 * Supprime les triggers gérés par ce script (fonction cible = dispatch).
 * N'affecte pas d'éventuels triggers d'autres fonctions.
 * @return {number} Nombre de triggers supprimés.
 */
function supprimerTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  var supprimes = 0;
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === FONCTION_DISPATCH) {
      ScriptApp.deleteTrigger(triggers[i]);
      supprimes++;
    }
  }
  Logger.log('[trigger] Purge : %s trigger(s) "%s" supprimé(s).', supprimes, FONCTION_DISPATCH);
  return supprimes;
}

/* ──────────────────────────────────────────────────────────────────────────
 * Dispatcher — cible du trigger temporel.
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Point d'entrée appelé par le trigger : exécute les newsletters (et le rapport
 * hebdo) dues à l'instant courant. Protégé par un verrou script contre les
 * exécutions concurrentes, et par un contrôle `_logs` contre le double-run.
 * @return {void}
 */
function executerNewsletterPlanifiee() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30 * 1000)) {
    Logger.log('[trigger][WARN] Verrou non acquis (un autre dispatch tourne) — passage ignoré.');
    return;
  }
  try {
    var maintenant = new Date();
    var jourCourant = _jourSemaineFr_(maintenant);
    var heureCourante = _heureCourante_(maintenant);
    var jourDuMois = Number(Utilities.formatDate(maintenant, FUSEAU_PLATEFORME, 'd'));
    Logger.log('[trigger] Dispatch : %s %sh (jour du mois %s, fuseau %s).',
      jourCourant, heureCourante, jourDuMois, FUSEAU_PLATEFORME);

    _dispatcherNewsletters_(maintenant, jourCourant, heureCourante, jourDuMois);
    _dispatcherRapportHebdo_(maintenant, jourCourant, heureCourante);
  } finally {
    lock.releaseLock();
  }
}

/**
 * Exécute chaque newsletter active DUE et non déjà servie ce créneau.
 * @param {Date} maintenant
 * @param {string} jourCourant Jour de semaine FR courant.
 * @param {number} heureCourante Heure 0–23 courante.
 * @param {number} jourDuMois 1–31 (pour la cadence mensuelle).
 * @return {void}
 * @private
 */
function _dispatcherNewsletters_(maintenant, jourCourant, heureCourante, jourDuMois) {
  var ids = _newslettersActives_();
  if (!ids.length) {
    Logger.log('[trigger] Aucune newsletter active — rien à planifier.');
    return;
  }
  for (var i = 0; i < ids.length; i++) {
    var id = ids[i];
    try {
      var config = lireConfig(id);
      if (!_estDueMaintenant_(config, jourCourant, heureCourante, jourDuMois)) {
        continue;
      }
      if (_aDejaTourneAujourdhui_(id, heureCourante, maintenant)) {
        Logger.log('[trigger] %s : déjà servie aujourd\'hui à %sh — skip (garde-fou double-run).',
          id, heureCourante);
        continue;
      }
      Logger.log('[trigger] %s : due → exécution.', id);
      executerNewsletter(id);
    } catch (e) {
      // Un échec sur une newsletter ne doit pas bloquer les suivantes.
      Logger.log('[trigger][ERREUR] %s : %s', id, e.message);
    }
  }
}

/**
 * Envoie le rapport hebdo (S4) s'il est dû ce jour/heure et non déjà envoyé.
 * Jour/heure lus dans `_config` GLOBAL (transverse, indépendant des newsletters).
 * @param {Date} maintenant
 * @param {string} jourCourant
 * @param {number} heureCourante
 * @return {void}
 * @private
 */
function _dispatcherRapportHebdo_(maintenant, jourCourant, heureCourante) {
  var global;
  try {
    global = _lireConfigGlobale_(_ouvrirSheetConfig_());
  } catch (e) {
    Logger.log('[trigger][WARN] Config globale illisible — rapport hebdo non planifié : %s', e.message);
    return;
  }
  var jour = _texte_(global.rapportHebdoJour).toLowerCase();
  var heure = global.rapportHebdoHeure;
  if (!jour || heure === null || heure === undefined) {
    return; // rapport hebdo non planifié
  }
  if (jour !== jourCourant || heure !== heureCourante) {
    return;
  }
  if (_aDejaTourneAujourdhui_(ID_RUN_RAPPORT_HEBDO, heure, maintenant)) {
    Logger.log('[trigger] Rapport hebdo déjà envoyé aujourd\'hui à %sh — skip.', heure);
    return;
  }
  Logger.log('[trigger] Rapport hebdo dû → envoi.');
  try {
    envoyerRapportHebdo();
    // Trace `_logs` pour armer le garde-fou anti-double-run du rapport.
    logRun(ID_RUN_RAPPORT_HEBDO, { statut: 'OK', message: 'rapport hebdo (planifié)' });
  } catch (e) {
    Logger.log('[trigger][ERREUR] Rapport hebdo : %s', e.message);
  }
}

/* ──────────────────────────────────────────────────────────────────────────
 * Découverte & décision (helpers). `_estDueMaintenant_` / `_creneauDejaServi_`
 * sont PURS → testables offline (testerTriggersDispatch).
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Liste les identifiants (= noms d'onglet) des newsletters ACTIVES. Exclut les
 * onglets techniques (préfixe `_`) ; un onglet résiduel (« Feuille 1 ») est
 * naturellement écarté car sa config résout `active=false`.
 * @return {Array.<string>}
 * @private
 */
function _newslettersActives_() {
  var classeur = _ouvrirSheetConfig_();
  var noms = classeur.getSheets().map(function(s) { return s.getName(); });
  var ids = [];
  for (var i = 0; i < noms.length; i++) {
    var nom = noms[i];
    if (nom.charAt(0) === '_') {
      continue; // onglet technique
    }
    try {
      if (lireConfig(nom).active === true) {
        ids.push(nom);
      }
    } catch (e) {
      Logger.log('[trigger][WARN] Onglet "%s" ignoré (lireConfig : %s).', nom, e.message);
    }
  }
  return ids;
}

/**
 * Décide si une newsletter est due à l'instant courant. PURE (aucun accès Sheet
 * ni Utilities) : jour/heure/jour-du-mois sont fournis par l'appelant.
 *
 * Cadence `mensuel` = PREMIÈRE occurrence du `jour_envoi` dans le mois (arbitrage
 * incr. 6) : la 1re occurrence d'un jour de semaine tombe toujours entre le 1 et
 * le 7 du mois → condition `jourDuMois <= 7`.
 *
 * @param {Object} config Config newsletter (jourEnvoi, heureEnvoi, cadence).
 * @param {string} jourCourant Jour de semaine FR courant (minuscule).
 * @param {number} heureCourante Heure 0–23 courante.
 * @param {number} jourDuMois 1–31.
 * @return {boolean}
 * @private
 */
function _estDueMaintenant_(config, jourCourant, heureCourante, jourDuMois) {
  var jour = _texte_(config.jourEnvoi).toLowerCase();
  var heure = config.heureEnvoi;
  if (!jour || heure === null || heure === undefined) {
    return false; // config incomplète → jamais planifiée
  }
  if (jour !== jourCourant || heure !== heureCourante) {
    return false;
  }
  var cadence = _texte_(config.cadence).toLowerCase() || 'hebdo';
  if (cadence === 'mensuel' && jourDuMois > 7) {
    return false; // pas la 1re occurrence de ce jour dans le mois
  }
  return true;
}

/**
 * Garde-fou double-run : vrai si `_logs` contient déjà un run pour cette
 * newsletter aujourd'hui à cette heure (tout statut confondu — un slot en échec
 * n'est pas rejoué automatiquement le même jour, cf. DECISIONS.md).
 * @param {string} idNewsletter
 * @param {number} heure Heure 0–23 du créneau.
 * @param {Date} maintenant
 * @return {boolean}
 * @private
 */
function _aDejaTourneAujourdhui_(idNewsletter, heure, maintenant) {
  var aujourdhui = Utilities.formatDate(maintenant, FUSEAU_PLATEFORME, 'yyyy-MM-dd');
  var lignes = _lireLignesParEntetes_(ONGLETS_TECHNIQUES.logs);
  var creneaux = [];
  for (var i = 0; i < lignes.length; i++) {
    var t = lignes[i]['timestamp'];
    if (!(t instanceof Date)) {
      continue;
    }
    creneaux.push({
      newsletter: _texte_(lignes[i]['newsletter']),
      jour: Utilities.formatDate(t, FUSEAU_PLATEFORME, 'yyyy-MM-dd'),
      heure: Number(Utilities.formatDate(t, FUSEAU_PLATEFORME, 'H'))
    });
  }
  return _creneauDejaServi_(creneaux, idNewsletter, aujourdhui, heure);
}

/**
 * Cœur PUR du garde-fou : un créneau (newsletter, jour, heure) est-il déjà loggé ?
 * @param {Array.<{newsletter: string, jour: string, heure: number}>} creneaux
 * @param {string} idNewsletter
 * @param {string} jour Format yyyy-MM-dd.
 * @param {number} heure 0–23.
 * @return {boolean}
 * @private
 */
function _creneauDejaServi_(creneaux, idNewsletter, jour, heure) {
  for (var i = 0; i < creneaux.length; i++) {
    var c = creneaux[i];
    if (c.newsletter === idNewsletter && c.jour === jour && c.heure === heure) {
      return true;
    }
  }
  return false;
}

/**
 * Jour de semaine FR courant selon FUSEAU_PLATEFORME.
 * @param {Date} date
 * @return {string} 'lundi' … 'dimanche'.
 * @private
 */
function _jourSemaineFr_(date) {
  var iso = Number(Utilities.formatDate(date, FUSEAU_PLATEFORME, 'u')); // 1 = lundi … 7 = dimanche
  return JOURS_SEMAINE_FR[iso - 1];
}

/**
 * Heure courante (0–23) selon FUSEAU_PLATEFORME.
 * @param {Date} date
 * @return {number}
 * @private
 */
function _heureCourante_(date) {
  return Number(Utilities.formatDate(date, FUSEAU_PLATEFORME, 'H'));
}
