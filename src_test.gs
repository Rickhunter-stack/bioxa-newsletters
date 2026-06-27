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

/**
 * Crée/complète les onglets manquants de la Sheet de config puis logge le récap.
 * À lancer UNE fois sur une Sheet neuve avant testerLireConfig. Idempotent :
 * relançable sans risque (les onglets existants sont conservés).
 * @return {void}
 */
function testerInitialiserSheet() {
  initialiserSheetDeConfig();
  Logger.log('--- Init terminée. Lance maintenant testerLireConfig pour vérifier la lecture. ---');
}

/**
 * Test OFFLINE (sans réseau) de la canonicalisation d'URL + hash. Vérifie les
 * règles : utm_/trackers retirés, fragment retiré, www./port par défaut retirés,
 * trailing slash retiré, params restants triés.
 * @return {void}
 */
function testerCanonicaliserUrl() {
  var cas = [
    ['https://www.example.com/Article/?utm_source=x&id=12#section', 'https://example.com/Article?id=12'],
    ['http://Example.com:80/a/', 'http://example.com/a'],
    ['https://x.com/p?b=2&a=1&fbclid=abc', 'https://x.com/p?a=1&b=2'],
    ['https://x.com/', 'https://x.com'],
    ['https://x.com/path?ref=news&mc_cid=9&q=ok', 'https://x.com/path?q=ok']
  ];
  var echecs = 0;
  cas.forEach(function(c) {
    var obtenu = _canonicaliserUrl_(c[0]);
    var ok = (obtenu === c[1]);
    if (!ok) { echecs++; }
    Logger.log('%s\n  in  : %s\n  out : %s\n  exp : %s\n  hash: %s',
      ok ? 'OK  ' : 'FAIL', c[0], obtenu, c[1], _hashUrlHex_(obtenu));
  });
  Logger.log('--- testerCanonicaliserUrl : %s/%s OK ---', cas.length - echecs, cas.length);
}

/**
 * Collecte les items de la newsletter DSI et logge un récap (réseau requis).
 * Pré-requis : onglet DSI rempli avec des sources actives (cf. DECISIONS.md).
 * @return {void}
 */
function testerCollecte() {
  var config = lireConfig('DSI');
  var res = collecterItems('DSI', config);
  Logger.log('=== Collecte DSI ===');
  Logger.log('Items: %s | Sources OK: %s/%s | HS: %s',
    res.items.length, res.santeCollecte.sourcesOk, res.santeCollecte.sourcesTotal, res.santeCollecte.sourcesHs);
  Logger.log('Par rubrique: %s', JSON.stringify(res.statsParRubrique, null, 2));
  if (res.echecs.length) {
    Logger.log('Échecs: %s', JSON.stringify(res.echecs, null, 2));
  }
  if (res.sourcesSansDate.length) {
    Logger.log('Sources à investiguer (dates): %s', JSON.stringify(res.sourcesSansDate, null, 2));
  }
  res.items.slice(0, 3).forEach(function(it, i) {
    Logger.log('Item %s | [%s] %s\n  %s\n  date=%s | resume=%s…',
      i + 1, it.rubrique, it.titre, it.url,
      it.datePublication, _texte_(it.resumeBrut).substring(0, 80));
  });
}

/**
 * Enchaîne collecte → déduplication sur DSI et logge les compteurs (réseau requis).
 * @return {void}
 */
function testerCollecteEtDedup() {
  var config = lireConfig('DSI');
  var collecte = collecterItems('DSI', config);
  var dedup = dedoublonner(collecte.items, 'DSI');
  Logger.log('=== Collecte + Dédup DSI ===');
  Logger.log('Collectés: %s → Uniques: %s (rejets intra-run: %s, historique: %s)',
    collecte.items.length, dedup.retenus.length, dedup.rejetesIntraRun, dedup.rejetesHistorique);
  dedup.retenus.slice(0, 3).forEach(function(it, i) {
    Logger.log('Retenu %s | %s | hash=%s', i + 1, it.titre, it.urlHash);
  });
}
