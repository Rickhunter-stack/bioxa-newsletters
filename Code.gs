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

/** Nom de l'onglet de configuration globale (préfixe `_`). */
var ONGLET_CONFIG = '_config';

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

  // TODO incr. 2 : collecterItems(idNewsletter, config)
  // TODO incr. 2 : dedoublonner(items)
  // TODO incr. 3 : prefilterTitres(items) puis scorerEtResumer(items)
  // TODO incr. 4 : genererHTML(config, items)
  // TODO incr. 5 : envoyerGmail(config, html) + logRun(...) + historique
}
