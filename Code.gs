/**
 * Code.gs — Entry points de la plateforme newsletters BIOXA.
 *
 * Un entry point par newsletter (executerNewsletterDSI, executerNewsletterRH, …).
 * Chacun délègue à executerNewsletter(idNewsletter) : code unique paramétré
 * depuis la Google Sheet de config (cf. PRD P3).
 *
 * Incrément 1 — socle plateforme : seules les constantes globales et lireConfig
 * sont opérationnelles. Le pipeline (collecte → pré-filtre → scoring → rendu →
 * envoi) est branché aux incréments suivants.
 */

/** Nom de la Google Sheet de configuration. */
var NOM_SHEET_CONFIG = 'BIOXA-Newsletters-Config';

/**
 * Clé Script Property contenant l'ID de la Sheet de config (pour un projet
 * Apps Script autonome). Si absente, on retombe sur la Sheet liée au conteneur.
 * Aucun ID en dur dans le code (cf. CLAUDE.md).
 */
var PROP_ID_SHEET_CONFIG = 'CONFIG_SHEET_ID';

/**
 * Noms des onglets techniques (préfixe `_`) de la plateforme. Source de vérité
 * unique, réutilisée par src_init (création), src_collecte/src_dedup (incr. 2),
 * src_envoi/src_logs (incr. 5) et l'observabilité (incr. 8).
 */
var ONGLETS_TECHNIQUES = {
  config: '_config',
  historique: '_historique',
  logs: '_logs'
};

/** Onglet de configuration globale (alias de commodité). */
var ONGLET_CONFIG = ONGLETS_TECHNIQUES.config;

/** Nom du dossier Drive où sont écrits les brouillons dry-run (PRD S1). */
var NOM_DOSSIER_DRAFTS = '_drafts';

/** Nom d'affichage de l'expéditeur des emails (M6). */
var NOM_EXPEDITEUR = 'BIOXA Veille';

/** Quota Gmail journalier par défaut si absent de _config (compte gratuit). */
var GMAIL_QUOTA_DEFAUT = 100;

/* ──────────────────────────────────────────────────────────────────────────
 * Entry points par newsletter (appelés par les triggers temporels, incr. 6).
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Entry point de la newsletter DSI Cyber+IA (première instance, PRD v1).
 * @return {void}
 */
function executerNewsletterDSI() {
  return executerNewsletter('DSI');
}

/**
 * Orchestrateur unique paramétré par newsletter (PRD P3) : collecte → dédup →
 * pré-filtre → scoring → rendu → livraison, avec persistance `_historique`/`_logs`
 * et alertes admin. Une ligne `_logs` est TOUJOURS écrite (succès, vide, erreur).
 *
 * @param {string} idNewsletter Identifiant = nom de l'onglet (ex: "DSI").
 * @param {{dryRun?: boolean}} [options] Options d'exécution (dry-run S1).
 * @return {void}
 */
function executerNewsletter(idNewsletter, options) {
  options = options || {};
  var debut = (new Date()).getTime();
  var config = null;
  var compteurs = {
    nbCollectes: 0, nbPreFiltres: 0, nbScores: 0, nbEnvoyes: 0,
    dureeSec: 0, statut: 'ERREUR', message: '', coutEstime: 0
  };

  try {
    config = lireConfig(idNewsletter);
    var dryRun = options.dryRun || (config.global && config.global.dryRunGlobal);
    Logger.log('Config chargée pour "%s" (%s sources, %s destinataires)%s.',
      config.id, config.sources.length, config.destinataires.length, dryRun ? ' [DRY-RUN]' : '');

    var collecte = collecterItems(idNewsletter, config);
    var dedup = dedoublonner(collecte.items, idNewsletter);
    compteurs.nbCollectes = collecte.items.length;

    // Plafond par rubrique APRÈS dédup, AVANT pré-filtre (borne le batch Claude).
    var plafonnes = plafonnerParRubrique(dedup.retenus);

    // Pré-filtre IA (M3) PUIS scoring + résumé (M4).
    var pre = prefilterTitres(plafonnes, config);
    compteurs.nbPreFiltres = pre.items.length;
    var sco = scorerEtResumer(pre.items, config);
    compteurs.nbScores = sco.items.length;
    compteurs.coutEstime = _calculerCout_(_additionnerUsage_(pre.usage, sco.usage), config);
    var selection = sco.items;

    // 0 item : log + (en mode réel) mail admin « sources à investiguer ».
    if (!selection.length) {
      compteurs.statut = dryRun ? 'DRY-RUN' : 'VIDE';
      compteurs.message = '0 item sélectionné';
      Logger.log('[pipeline] %s : 0 item sélectionné — rien produit.', idNewsletter);
      if (!dryRun) {
        envoyerMailAdmin(config, '[BIOXA] ' + idNewsletter + ' : 0 item cette semaine',
          'Aucun item sélectionné cette semaine.\nSources HS : ' + collecte.santeCollecte.sourcesHs +
          '/' + collecte.santeCollecte.sourcesTotal + '.\nSources à investiguer.');
      }
      return;
    }

    // Rendu HTML (M5/M7) puis livraison (dry-run S1 ou envoi Gmail M6).
    var html = genererHTML(config, selection);
    var livraison = livrerNewsletter(config, html, options);

    if (livraison.mode === 'dry-run') {
      compteurs.statut = 'DRY-RUN';
      compteurs.message = 'brouillon : ' + livraison.url;
    } else {
      compteurs.nbEnvoyes = livraison.envoyes;
      // _historique (P4) écrit si ≥ 1 destinataire servi (items réellement délivrés).
      if (livraison.envoyes > 0) {
        ecrireHistorique(idNewsletter, selection);
      }
      var nbEchecs = livraison.echecs.length;
      compteurs.statut = (livraison.quotaAtteint || nbEchecs > 0) ? 'PARTIEL' : 'OK';
      compteurs.message = 'envoyés=' + livraison.envoyes +
        (nbEchecs ? ', échecs=' + nbEchecs : '') + (livraison.quotaAtteint ? ', quota atteint' : '');
      if (livraison.quotaAtteint) {
        envoyerMailAdmin(config, '[BIOXA] ' + idNewsletter + ' : quota Gmail atteint',
          'Quota journalier atteint en cours d\'envoi. Envoyés=' + livraison.envoyes +
          '. Destinataires restants non servis ce jour.');
      }
    }
    Logger.log('Pipeline "%s" : [%s] %s.', idNewsletter, compteurs.statut, compteurs.message);
  } catch (e) {
    compteurs.statut = 'ERREUR';
    compteurs.message = e.message;
    Logger.log('[pipeline][ERREUR] %s : run annulé : %s', idNewsletter, e.message);
    if (config) {
      envoyerMailAdmin(config, '[BIOXA] ' + idNewsletter + ' : échec du run', 'Run annulé : ' + e.message);
    }
  } finally {
    compteurs.dureeSec = Math.round(((new Date()).getTime() - debut) / 1000);
    try {
      logRun(idNewsletter, compteurs);
    } catch (eLog) {
      Logger.log('[pipeline][WARN] %s : écriture _logs impossible : %s', idNewsletter, eLog.message);
    }
  }
}
