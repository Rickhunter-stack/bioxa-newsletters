/**
 * src_test.gs — Fonctions de test manuel, lancées depuis l'éditeur Apps Script.
 *
 * Claude Code ne peut pas exécuter de runtime Apps Script : ces fonctions se
 * lancent à la main (menu « Exécuter ») et leur sortie se lit dans
 * « Journaux d'exécution » (Logger.log).
 */

/**
 * Teste lireConfig("DSI") et affiche la config résolue dans les logs.
 * Pré-requis : Sheet `BIOXA-Newsletters-Config` accessible (Script Property
 * CONFIG_SHEET_ID renseignée, ou projet lié au conteneur) + onglet `DSI` rempli.
 * @return {void}
 */
function testerLireConfig() {
  var config = lireConfig('DSI');
  Logger.log('=== Config DSI ===');
  Logger.log(JSON.stringify(config, null, 2));

  // Quelques assertions « douces » pour repérer une Sheet mal remplie.
  Logger.log('--- Contrôles rapides ---');
  Logger.log('Nom               : %s', config.nom || '(vide)');
  Logger.log('Active            : %s', config.active);
  Logger.log('Cadence           : %s', config.cadence);
  Logger.log('N items/rubrique  : %s', config.nItemsParRubrique);
  Logger.log('Version prompt     : %s', config.promptVersion || '(non versionné)');
  Logger.log('Modèle Claude     : %s', config.global.claudeModel);
  Logger.log('Endpoint Claude   : %s', config.global.claudeApiEndpoint);
  Logger.log('Nb sources        : %s', config.sources.length);
  Logger.log('Nb destinataires  : %s', config.destinataires.length);

  if (!config.sources.length) {
    Logger.log('[TEST][WARN] Aucune source lue — vérifier le tableau Sources (en-têtes Rubrique/URL RSS).');
  }
  if (!config.destinataires.length) {
    Logger.log('[TEST][WARN] Aucun destinataire lu — vérifier le tableau Destinataires (en-têtes Email/Nom).');
  }
}
