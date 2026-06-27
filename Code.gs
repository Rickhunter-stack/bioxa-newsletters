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
 * Orchestrateur unique paramétré par newsletter (PRD P3).
 * Incrément 1 : charge et logge la config ; le pipeline arrive aux incréments 2+.
 *
 * @param {string} idNewsletter Identifiant = nom de l'onglet (ex: "DSI").
 * @return {void}
 * @throws {Error} Si la Sheet ou l'onglet de la newsletter est introuvable.
 */
function executerNewsletter(idNewsletter) {
  var config = lireConfig(idNewsletter);
  Logger.log('Config chargée pour la newsletter "%s" (%s sources, %s destinataires).',
    config.id, config.sources.length, config.destinataires.length);

  var collecte = collecterItems(idNewsletter, config);
  var dedup = dedoublonner(collecte.items, idNewsletter);
  Logger.log('Pipeline "%s" : %s collectés → %s uniques (%s intra-run, %s historique) ; %s/%s sources OK.',
    idNewsletter, collecte.items.length, dedup.retenus.length,
    dedup.rejetesIntraRun, dedup.rejetesHistorique,
    collecte.santeCollecte.sourcesOk, collecte.santeCollecte.sourcesTotal);

  // Pré-filtre IA (M3) PUIS scoring + résumé (M4). En cas d'échec Claude après
  // retries / budget dépassé, le run est annulé (mail admin : incr. 5).
  var selection;
  try {
    var apresPrefilter = prefilterTitres(dedup.retenus, config);
    selection = scorerEtResumer(apresPrefilter, config);
  } catch (e) {
    Logger.log('[pipeline][ERREUR] %s : pipeline Claude interrompu — run annulé : %s', idNewsletter, e.message);
    throw e;
  }
  Logger.log('Pipeline "%s" : %s items sélectionnés pour le rendu.', idNewsletter, selection.length);

  // TODO incr. 4 : genererHTML(config, selection)
  // TODO incr. 5 : envoyerGmail(config, html) + logRun(...) + écriture _historique
}
