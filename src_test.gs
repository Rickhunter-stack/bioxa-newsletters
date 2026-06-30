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

/**
 * Test OFFLINE (sans réseau, sans clé API) du parsing JSONL + ré-appariement
 * par custom_id + extraction de la sortie structurée. Reproduit le pattern de
 * testerCanonicaliserUrl : fixtures de réponses Claude en dur.
 * @return {void}
 */
function testerParseSortieClaude() {
  var echecs = 0;

  // Fixture JSONL : 2 succès (ordre inversé volontairement) + 1 en erreur.
  var jsonl = [
    JSON.stringify({ custom_id: 'hashB', result: { type: 'succeeded', message: {
      content: [{ type: 'text', text: '{"score": 7, "resume_fr": "Résumé B.", "raison": "Pertinent."}' }],
      usage: { input_tokens: 12, output_tokens: 8 }
    } } }),
    JSON.stringify({ custom_id: 'hashA', result: { type: 'succeeded', message: {
      content: [{ type: 'text', text: '{"decision": "oui"}' }],
      usage: { input_tokens: 5, output_tokens: 2 }
    } } }),
    JSON.stringify({ custom_id: 'hashC', result: { type: 'errored', error: { type: 'invalid_request' } } })
  ].join('\n') + '\n';

  var lignes = _parserResultatsJsonl_(jsonl);
  if (lignes.length !== 3) { echecs++; Logger.log('FAIL: %s lignes parsées (attendu 3)', lignes.length); }

  var map = _indexerResultats_(lignes);
  // Ré-appariement par custom_id (indépendant de l'ordre).
  if (!(map.hashA && map.hashA.ok)) { echecs++; Logger.log('FAIL: hashA absent/échec'); }
  if (!(map.hashB && map.hashB.ok)) { echecs++; Logger.log('FAIL: hashB absent/échec'); }
  if (!(map.hashC && map.hashC.ok === false)) { echecs++; Logger.log('FAIL: hashC devrait être en erreur'); }

  // Extraction des sorties structurées.
  var sortieA = _extraireSortie_(map.hashA.message);
  if (!sortieA || sortieA.decision !== 'oui') { echecs++; Logger.log('FAIL: décision hashA = %s', sortieA && sortieA.decision); }

  var sortieB = _extraireSortie_(map.hashB.message);
  if (!sortieB || sortieB.score !== 7) { echecs++; Logger.log('FAIL: score hashB = %s', sortieB && sortieB.score); }

  // Bornage + troncature.
  if (_bornerScore_(99) !== 10 || _bornerScore_(-3) !== 0 || _bornerScore_('abc') !== 0) {
    echecs++; Logger.log('FAIL: bornage score incorrect');
  }
  var longResume = new Array(260).join('x'); // 259 caractères
  var tronque = _tronquerResume_(longResume, 'titre test');
  if (tronque.length !== RESUME_MAX_CHARS + 1) { echecs++; Logger.log('FAIL: troncature = %s car', tronque.length); }

  // Usage agrégé.
  var usage = _sommerUsage_(map);
  if (usage.inputTokens !== 17 || usage.outputTokens !== 10) {
    echecs++; Logger.log('FAIL: usage in=%s out=%s (attendu 17/10)', usage.inputTokens, usage.outputTokens);
  }

  Logger.log('--- testerParseSortieClaude : %s ---', echecs === 0 ? 'OK (tous verts)' : (echecs + ' échec(s)'));
}

/**
 * Test OFFLINE de la lecture des tableaux Sources/Destinataires partageant la
 * même ligne d'en-tête (régression du bug « dernière source toujours inactive »).
 *
 * Grille : Sources (A-E) + colonne F vide + Destinataires (G-I). La colonne
 * `Active` figure en A (Sources) ET en G (Destinataires). On distingue les deux :
 * chaque tableau doit lire SA propre colonne `Active`.
 * @return {void}
 */
function testerLireTableauxColonnes() {
  var echecs = 0;
  function check(cond, libelle) {
    if (!cond) { echecs++; Logger.log('FAIL: %s', libelle); }
  }

  // En-têtes : A-E Sources, F vide, G-I Destinataires.
  var H = ['Active', 'Rubrique', 'Nom source', 'URL RSS', 'Filter keywords', '', 'Active', 'Email', 'Nom'];
  // r1 : source active (A=true) / destinataire inactif (G=false)
  var r1 = [true,  'Cyber', 'S1', 'https://a', '', '', false, 'a@x.com', 'A'];
  // r2 : source inactive (A=false) / destinataire actif (G=true)
  var r2 = [false, 'Cyber', 'S2', 'https://b', '', '', true,  'b@x.com', 'B'];
  // r3 : 3e source active (A=true) ; PAS de 3e destinataire (G vide) → preuve du bug
  var r3 = [true,  'IA',    'S3', 'https://c', '', '', '',    '',        ''];
  var grille = [H, r1, r2, r3];

  var sources = _lireSources_(grille, 'TEST');
  check(sources.length === 3, 'sources.length = 3 (got ' + sources.length + ')');
  check(sources[0] && sources[0].active === true, 'source[0].active = true (lit colonne A)');
  check(sources[1] && sources[1].active === false, 'source[1].active = false (lit colonne A, pas G)');
  check(sources[2] && sources[2].active === true, 'source[2].active = true (DERNIÈRE ligne — bug d\'origine)');
  check(sources[2] && sources[2].nomSource === 'S3', 'source[2].nomSource = S3');
  check(sources[2] && sources[2].rubrique === 'IA', 'source[2].rubrique = IA');

  // Symétrie Destinataires : doivent lire la colonne G (Active dest).
  var dests = _lireDestinataires_(grille, 'TEST');
  check(dests.length === 2, 'dests.length = 2 (got ' + dests.length + ')');
  check(dests[0] && dests[0].active === false && dests[0].email === 'a@x.com',
    'dest[0] = {active:false, a@x.com} (lit colonne G)');
  check(dests[1] && dests[1].active === true && dests[1].email === 'b@x.com',
    'dest[1] = {active:true, b@x.com} (lit colonne G)');

  Logger.log('--- testerLireTableauxColonnes : %s ---', echecs === 0 ? 'OK (tous verts)' : (echecs + ' échec(s)'));
}

/**
 * Test OFFLINE du garde-fou d'ambiguïté : deux segments contigus portent la même
 * signature → warning attendu + PREMIER segment retenu (déterministe).
 * @return {void}
 */
function testerLocaliserTableauAmbiguite() {
  var echecs = 0;
  // Deux tableaux Destinataires : A-C et E-G, séparés par la colonne D vide.
  var H = ['Active', 'Email', 'Nom', '', 'Active', 'Email', 'Nom'];
  var grille = [H];
  var tab = _localiserTableau_(grille, ['email', 'nom'], 'TEST');

  if (!tab.trouve) { echecs++; Logger.log('FAIL: tableau non trouvé'); }
  // Premier segment retenu : email en colonne B (index 1), pas F (index 5).
  if (!(tab.colonnes && tab.colonnes['email'] === 1)) {
    echecs++; Logger.log('FAIL: premier segment non retenu (email index = %s, attendu 1)',
      tab.colonnes && tab.colonnes['email']);
  }
  Logger.log('(Un WARNING [ambiguïté détectée] doit apparaître ci-dessus.)');
  Logger.log('--- testerLocaliserTableauAmbiguite : %s ---', echecs === 0 ? 'OK (tous verts)' : (echecs + ' échec(s)'));
}

/**
 * Test RÉEL du pré-filtre sur la newsletter DSI (réseau + clé API requis).
 * Pré-requis : onglet DSI rempli avec des sources actives, ANTHROPIC_API_KEY posée.
 * @return {void}
 */
function testerPrefilter() {
  var config = lireConfig('DSI');
  var collecte = collecterItems('DSI', config);
  var dedup = dedoublonner(collecte.items, 'DSI');
  var conserves = prefilterTitres(dedup.retenus, config);
  Logger.log('=== Pré-filtre DSI ===');
  Logger.log('%s items dédupliqués → %s conservés.', dedup.retenus.length, conserves.length);
  conserves.slice(0, 5).forEach(function(it) {
    Logger.log('  [%s] %s', it.rubrique, it.titre);
  });
}

/**
 * Test RÉEL du scoring + résumé sur la newsletter DSI (réseau + clé API requis).
 * @return {void}
 */
function testerScoring() {
  var config = lireConfig('DSI');
  var collecte = collecterItems('DSI', config);
  var dedup = dedoublonner(collecte.items, 'DSI');
  var conserves = prefilterTitres(dedup.retenus, config);
  var scores = scorerEtResumer(conserves, config);
  Logger.log('=== Scoring DSI ===');
  Logger.log('%s items → %s sélectionnés.', conserves.length, scores.length);
  scores.forEach(function(it) {
    Logger.log('  [%s] score=%s | %s\n    %s', it.rubrique, it.score, it.titre, it.resumeFr);
  });
}

/**
 * Test RÉEL bout-en-bout (collecte → dédup → pré-filtre → scoring) sur DSI.
 * Reproduit le scénario du PRD incr. 3 (~30 items → décisions → ~15 scorés).
 * @return {void}
 */
function testerClaudeBatchBoutEnBout() {
  executerNewsletter('DSI');
  Logger.log('--- testerClaudeBatchBoutEnBout : voir les logs [claude] ci-dessus ---');
}

/**
 * Test OFFLINE de l'échappement HTML.
 * @return {void}
 */
function testerEchapperHtml() {
  var got = _echapperHtml_('a & b < c > d "e" \'f\'');
  var exp = 'a &amp; b &lt; c &gt; d &quot;e&quot; &#39;f&#39;';
  Logger.log('--- testerEchapperHtml : %s ---', got === exp ? 'OK' : ('FAIL\n  got: ' + got + '\n  exp: ' + exp));
}

/**
 * Test OFFLINE de genererHTML (sans réseau). Vérifie des fragments PRÉCIS du HTML
 * produit (pattern testerCanonicaliserUrl). Couvre les 6 asserts minimum exigés.
 * @return {void}
 */
function testerGenererHtml() {
  var config = {
    id: 'TEST',
    nom: 'Newsletter Test',
    couleur: '#1a3e5c',
    sousTitre: 'Sous-titre éditorial',
    promptVersion: 'v2026-06-27',
    sources: [
      { rubrique: 'Cyber' },
      { rubrique: 'Economie' }
    ]
  };
  // items dans un ordre DIFFÉRENT de l'ordre des sources (Economie avant Cyber).
  var items = [
    { rubrique: 'Economie', titre: 'Coût IA', url: 'https://eco.example/a',
      source: 'EcoSource', datePublication: null, resumeFr: 'Résumé éco.' },
    { rubrique: 'Cyber', titre: 'Faille AT&T critique', url: 'https://cyber.example/b',
      source: 'CyberSource', datePublication: null, resumeFr: 'Résumé cyber.' }
  ];
  var html = genererHTML(config, items);
  var echecs = 0;
  function check(cond, libelle) {
    if (!cond) { echecs++; Logger.log('FAIL: %s', libelle); }
  }

  // 1. URL d'un item présente dans un href=
  check(html.indexOf('href="https://cyber.example/b"') !== -1, 'URL item dans href');
  // 2. Titre contenant "&" rendu "&amp;"
  check(html.indexOf('Faille AT&amp;T critique') !== -1, 'titre échappé (&amp;)');
  check(html.indexOf('AT&T') === -1, 'pas de & brut dans le titre');
  // 3. Couleur config dans le fond de l'en-tête
  check(html.indexOf('background:#1a3e5c') !== -1, 'couleur dans le fond en-tête');
  // 4. Ordre des rubriques = ordre des sources (Cyber avant Economie)
  check(html.indexOf('Cyber') !== -1 && html.indexOf('Economie') !== -1 &&
    html.indexOf('Cyber') < html.indexOf('Economie'), 'ordre rubriques = ordre sources');
  // 5. Pied contient la promptVersion
  check(html.indexOf('v2026-06-27') !== -1, 'promptVersion dans le pied');
  // 6. Présence de la media query responsive
  check(html.indexOf('@media only screen and (max-width:600px)') !== -1, 'media query responsive');

  // Cas 0 item : ne lève pas, retourne string vide.
  var vide = genererHTML(config, []);
  check(vide === '', '0 item → string vide');

  Logger.log('--- testerGenererHtml : %s ---', echecs === 0 ? 'OK (tous verts)' : (echecs + ' échec(s)'));
}

/**
 * Test RÉEL minimal de l'écriture du brouillon Drive (sans coût Claude).
 * Écrit un HTML fixe dans `_drafts` et logge l'URL. Vérifie la création du
 * dossier et du fichier.
 * @return {void}
 */
function testerEcrireBrouillon() {
  var config = { id: 'TEST', global: { dryRunGlobal: false } };
  var html = '<!DOCTYPE html><html><body><h1>Test brouillon BIOXA</h1></body></html>';
  var res = livrerNewsletter(config, html, { dryRun: true });
  Logger.log('=== testerEcrireBrouillon ===');
  Logger.log('mode=%s url=%s', res.mode, res.url);
}

/**
 * Test RÉEL bout-en-bout en dry-run sur DSI (réseau + clé API + Drive requis).
 * Produit un fichier HTML dans `_drafts`, sans envoi Gmail.
 * @return {void}
 */
function testerDryRunDSI() {
  executerNewsletter('DSI', { dryRun: true });
  Logger.log('--- testerDryRunDSI : voir le lien [envoi] dry-run ci-dessus ---');
}
