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
 * Test OFFLINE (sans réseau, sans clé API) du traitement des réponses Claude
 * synchrones : extraction de la sortie structurée (`_extraireSortie_`), agrégat
 * d'usage sur une map de résultats (comme la produit `appelerClaudeMessages`),
 * bornage/troncature, et dérivation du endpoint Messages (`_endpointMessages_`).
 * @return {void}
 */
function testerParseSortieClaude() {
  var echecs = 0;
  function check(cond, libelle) {
    if (!cond) { echecs++; Logger.log('FAIL: %s', libelle); }
  }

  // Map de résultats telle que la construit appelerClaudeMessages (par custom_id) :
  // 2 succès (pré-filtre + scoring) + 1 en échec.
  var map = {
    hashA: { ok: true, erreur: null, message: {
      content: [{ type: 'text', text: '{"decision": "oui"}' }],
      usage: { input_tokens: 5, output_tokens: 2 }
    } },
    hashB: { ok: true, erreur: null, message: {
      content: [{ type: 'text', text: '{"score": 7, "resume_fr": "Résumé B.", "titre_traduction": null, "raison": "Pertinent."}' }],
      usage: { input_tokens: 12, output_tokens: 8 }
    } },
    hashC: { ok: false, message: null, erreur: 'HTTP 400 : invalid_request' }
  };

  // Extraction des sorties structurées.
  var sortieA = _extraireSortie_(map.hashA.message);
  check(sortieA && sortieA.decision === 'oui', 'décision hashA = oui');
  var sortieB = _extraireSortie_(map.hashB.message);
  check(sortieB && sortieB.score === 7, 'score hashB = 7');
  // Résultat en échec : pas de message à extraire.
  check(map.hashC.ok === false && map.hashC.message === null, 'hashC en échec (message null)');

  // Bornage + troncature.
  check(_bornerScore_(99) === 10 && _bornerScore_(-3) === 0 && _bornerScore_('abc') === 0,
    'bornage score [0,10]');
  var longResume = new Array(260).join('x'); // 259 caractères
  var tronque = _tronquerResume_(longResume, 'titre test');
  check(tronque.length === RESUME_MAX_CHARS + 1, 'troncature résumé à 200 + …');

  // Usage agrégé (seuls les succès comptent) : 5+12 in, 2+8 out.
  var usage = _sommerUsage_(map);
  check(usage.inputTokens === 17 && usage.outputTokens === 10, 'usage in=17 out=10 (échecs exclus)');

  // Dérivation du endpoint Messages (strip /batches, sinon inchangé).
  check(_endpointMessages_('https://api.anthropic.com/v1/messages/batches') === 'https://api.anthropic.com/v1/messages',
    'endpoint : /batches retiré');
  check(_endpointMessages_('https://api.anthropic.com/v1/messages') === 'https://api.anthropic.com/v1/messages',
    'endpoint : /v1/messages inchangé');

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
  var conserves = prefilterTitres(dedup.retenus, config).items;
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
  var conserves = prefilterTitres(dedup.retenus, config).items;
  var scores = scorerEtResumer(conserves, config).items;
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
  // 6. Responsive : conteneur élargi 680px + media queries (680 conteneur, 600 colonnes)
  check(html.indexOf('max-width:680px') !== -1, 'conteneur élargi à 680px (desktop)');
  check(html.indexOf('@media only screen and (max-width:680px)') !== -1, 'media query conteneur 680');
  check(html.indexOf('@media only screen and (max-width:600px)') !== -1, 'media query colonnes 600 (mobile)');
  // 7. Marque plateforme présente (en-tête + pied)
  check(html.indexOf('Laboratoire BIOXA') !== -1, 'marque organisation présente');

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

/**
 * Test OFFLINE de la construction des lignes _logs/_historique (par en-tête),
 * du calcul de coût et du sujet. (Sans réseau ni Sheet.)
 * @return {void}
 */
function testerLogsOffline() {
  var echecs = 0;
  function check(cond, libelle) {
    if (!cond) { echecs++; Logger.log('FAIL: %s', libelle); }
  }

  // Construction de ligne par en-tête : place chaque valeur sous sa colonne.
  var entetes = ['url_hash', 'sent_at', 'newsletter', 'url', 'title'];
  var ligne = _construireLigneParEntetes_(entetes,
    { url_hash: 'h1', newsletter: 'DSI', url: 'https://x', title: 'T', colonne_inconnue: 'ignorée' });
  check(ligne.length === 5, 'ligne longueur = 5');
  check(ligne[0] === 'h1', 'url_hash en colonne 0');
  check(ligne[2] === 'DSI', 'newsletter en colonne 2');
  check(ligne[4] === 'T', 'title en colonne 4');
  check(ligne[1] === '', 'sent_at non fourni → vide');

  // Calcul de coût : prix 1/5 USD/M, remise batch 0.5.
  var cfg = { global: { prixInputParMillion: 1, prixOutputParMillion: 5 } };
  var cout = _calculerCout_({ inputTokens: 1000000, outputTokens: 1000000 }, cfg);
  // (1*1 + 1*5) * 0.5 = 3
  check(Math.abs(cout - 3) < 1e-9, 'coût = 3 (got ' + cout + ')');
  var somme = _additionnerUsage_({ inputTokens: 5, outputTokens: 2 }, { inputTokens: 10, outputTokens: 3 });
  check(somme.inputTokens === 15 && somme.outputTokens === 5, 'usage additionné 15/5');

  // Sujet : « {nom} — {date} ».
  var sujet = _genererSujet_({ nom: 'DSI — Cyber et IA' });
  check(sujet.indexOf('DSI — Cyber et IA — ') === 0, 'sujet préfixé par le nom (got ' + sujet + ')');

  // Destinataires actifs : filtre active + email non vide.
  var actifs = _destinatairesActifs_({ destinataires: [
    { active: true, email: 'a@x.com' }, { active: false, email: 'b@x.com' }, { active: true, email: '' }
  ] });
  check(actifs.length === 1 && actifs[0].email === 'a@x.com', 'destinataires actifs filtrés');

  Logger.log('--- testerLogsOffline : %s ---', echecs === 0 ? 'OK (tous verts)' : (echecs + ' échec(s)'));
}

/**
 * Test RÉEL de l'envoi Gmail bout-en-bout sur DSI (réseau + clé API + Drive +
 * Gmail requis). ⚠️ ENVOIE DE VRAIS EMAILS aux destinataires actifs de DSI.
 * Pré-requis : 1 destinataire de test `active=TRUE`, ANTHROPIC_API_KEY posée.
 * Vérifier ensuite les onglets `_historique` (1 ligne/item) et `_logs` (1 ligne).
 * @return {void}
 */
function testerEnvoiReelDSI() {
  executerNewsletter('DSI', { dryRun: false });
  Logger.log('--- testerEnvoiReelDSI : vérifier la boîte de test + onglets _historique et _logs ---');
}

/**
 * Test RÉEL du rapport hebdo (S4) : envoie le récap 7 jours à admin_email.
 * @return {void}
 */
function testerRapportHebdo() {
  envoyerRapportHebdo();
  Logger.log('--- testerRapportHebdo : vérifier la boîte admin ---');
}

/**
 * Test OFFLINE de la détection de langue rudimentaire (_estFrancais_).
 * @return {void}
 */
function testerEstFrancais() {
  var echecs = 0;
  function check(cond, libelle) {
    if (!cond) { echecs++; Logger.log('FAIL: %s', libelle); }
  }
  check(_estFrancais_('Faille critique détectée') === true, 'accent é → FR');
  check(_estFrancais_('The Hacker News reports a breach') === false, 'EN sans accent ni mots FR → non FR');
  check(_estFrancais_('Le rapport sur la sécurité') === true, 'accent + mots FR → FR');
  check(_estFrancais_('Un nouveau modele pour les entreprises') === true, 'mots FR (un, pour, les) sans accent → FR');
  check(_estFrancais_('') === false, 'vide → non FR');
  Logger.log('--- testerEstFrancais : %s ---', echecs === 0 ? 'OK (tous verts)' : (echecs + ' échec(s)'));
}

/**
 * Test OFFLINE du titre affiché : pour un titre anglophone, le titre affiché
 * (texte du lien) est la TRADUCTION FR et le titre original est conservé en
 * info-bulle (title=) ; pour un titre déjà français, le titre original est
 * affiché et la traduction (erronée) de Claude est ignorée.
 * @return {void}
 */
function testerTraductionTitre() {
  var echecs = 0;
  function check(cond, libelle) {
    if (!cond) { echecs++; Logger.log('FAIL: %s', libelle); }
  }
  var config = {
    id: 'TEST', nom: 'Test', couleur: '#1a3e5c', sousTitre: '', promptVersion: 'v1',
    sources: [{ rubrique: 'Cyber' }]
  };
  var items = [
    { rubrique: 'Cyber', titre: 'Critical AT&T breach', url: 'https://x/a', source: 'S',
      datePublication: null, resumeFr: 'r', titreTraduction: 'Faille critique chez AT&T' },
    { rubrique: 'Cyber', titre: 'Faille critique détectée', url: 'https://x/b', source: 'S',
      datePublication: null, resumeFr: 'r', titreTraduction: 'Critical breach detected' }
  ];
  var html = genererHTML(config, items);

  // Item EN : titre AFFICHÉ (texte du lien) = traduction FR ; original en info-bulle.
  check(html.indexOf('>Faille critique chez AT&amp;T</a>') !== -1,
    'titre affiché = traduction FR (texte du lien) pour titre EN');
  check(html.indexOf('title="Critical AT&amp;T breach"') !== -1,
    'titre original EN conservé en info-bulle (traçabilité)');
  // Item FR : titre original affiché ; traduction erronée de Claude ignorée (pas d'info-bulle).
  check(html.indexOf('>Faille critique détectée</a>') !== -1, 'titre FR original affiché');
  check(html.indexOf('Critical breach detected') === -1, 'traduction ignorée pour titre déjà FR');

  Logger.log('--- testerTraductionTitre : %s ---', echecs === 0 ? 'OK (tous verts)' : (echecs + ' échec(s)'));
}

/**
 * Test OFFLINE du plafond par rubrique avant pré-filtre (borne du batch Claude).
 * Rubrique > plafond → tronquée par date desc (sans-date écartés en premier) ;
 * rubrique < plafond → inchangée ; rubrique PILE au plafond → inchangée + ordre
 * d'origine préservé (vérifie l'inégalité STRICTE `> 25`).
 * @return {void}
 */
function testerPlafondRubrique() {
  var echecs = 0;
  function check(cond, libelle) {
    if (!cond) { echecs++; Logger.log('FAIL: %s', libelle); }
  }
  function d(n) { return new Date(2026, 0, n); }

  var items = [];
  // Over : 26 datés (jours 1..26) + 1 sans date = 27 > 25.
  for (var i = 1; i <= 26; i++) { items.push({ rubrique: 'Over', titre: 'o' + i, datePublication: d(i) }); }
  items.push({ rubrique: 'Over', titre: 'oNull', datePublication: null });
  // Under : 8 < 25.
  for (var j = 1; j <= 8; j++) { items.push({ rubrique: 'Under', titre: 'u' + j, datePublication: d(j) }); }
  // Exact : 25 items, dates ASCENDANTES (ordre d'origine, pour détecter un tri indu).
  for (var k = 1; k <= 25; k++) { items.push({ rubrique: 'Exact', titre: 'e' + k, datePublication: d(k) }); }

  var res = plafonnerParRubrique(items);
  function parRub(r) { return res.filter(function(x) { return x.rubrique === r; }); }
  var over = parRub('Over'), under = parRub('Under'), exact = parRub('Exact');

  check(over.length === 25, 'Over plafonné à 25 (got ' + over.length + ')');
  check(over.every(function(x) { return x.datePublication !== null; }), 'Over : sans-date écartés en premier');
  check(over[0].titre === 'o26', 'Over : trié par date desc (o26 en tête)');
  check(!over.some(function(x) { return x.titre === 'o1'; }), 'Over : écarte le plus ancien (o1)');

  check(under.length === 8, 'Under inchangé à 8');

  check(exact.length === 25, 'Exact conservé à 25 (inégalité stricte)');
  check(exact[0].titre === 'e1', 'Exact : ordre d\'origine préservé → pas de tri → inégalité STRICTE');

  Logger.log('--- testerPlafondRubrique : %s ---', echecs === 0 ? 'OK (tous verts)' : (echecs + ' échec(s)'));
}

/**
 * Test OFFLINE de la décision de planification (incr. 6). Vérifie les fonctions
 * PURES du dispatcher, sans créer de vrai trigger ni toucher la Sheet :
 *  - `_estDueMaintenant_` : hebdo (bon/mauvais jour, bonne/mauvaise heure), mensuel
 *    (1re occurrence vs 2e), config incomplète, heure 0 (minuit) ;
 *  - `_creneauDejaServi_` : garde-fou double-run (même newsletter/jour/heure).
 * @return {void}
 */
function testerTriggersDispatch() {
  var echecs = 0;
  function check(cond, libelle) {
    if (!cond) { echecs++; Logger.log('FAIL: %s', libelle); }
  }

  // --- _estDueMaintenant_ : cadence hebdo ---
  var hebdo = { id: 'DSI', jourEnvoi: 'Lundi', heureEnvoi: 8, cadence: 'hebdo' };
  check(_estDueMaintenant_(hebdo, 'lundi', 8, 1) === true, 'hebdo bon jour+heure → due (casse tolérée)');
  check(_estDueMaintenant_(hebdo, 'mardi', 8, 2) === false, 'hebdo mauvais jour → pas due');
  check(_estDueMaintenant_(hebdo, 'lundi', 9, 1) === false, 'hebdo mauvaise heure → pas due');

  // --- _estDueMaintenant_ : cadence mensuel (1re occurrence du jour = jourDuMois <= 7) ---
  var mensuel = { id: 'RH', jourEnvoi: 'jeudi', heureEnvoi: 7, cadence: 'mensuel' };
  check(_estDueMaintenant_(mensuel, 'jeudi', 7, 3) === true, 'mensuel 1re occurrence (jour 3) → due');
  check(_estDueMaintenant_(mensuel, 'jeudi', 7, 7) === true, 'mensuel jour 7 (limite 1re occurrence) → due');
  check(_estDueMaintenant_(mensuel, 'jeudi', 7, 8) === false, 'mensuel jour 8 (> 7) → pas due');
  check(_estDueMaintenant_(mensuel, 'jeudi', 7, 10) === false, 'mensuel 2e occurrence (jour 10) → pas due');

  // --- _estDueMaintenant_ : cas limites ---
  var incomplet = { id: 'X', jourEnvoi: '', heureEnvoi: null, cadence: 'hebdo' };
  check(_estDueMaintenant_(incomplet, 'lundi', 8, 1) === false, 'config incomplète (jour/heure vides) → jamais due');
  var minuit = { id: 'Z', jourEnvoi: 'dimanche', heureEnvoi: 0, cadence: 'hebdo' };
  check(_estDueMaintenant_(minuit, 'dimanche', 0, 6) === true, 'heure 0 (minuit) valide → due (pas confondue avec absente)');

  // --- _creneauDejaServi_ : garde-fou double-run ---
  var creneaux = [
    { newsletter: 'DSI', jour: '2026-07-06', heure: 8 },
    { newsletter: 'RH', jour: '2026-07-06', heure: 7 }
  ];
  check(_creneauDejaServi_(creneaux, 'DSI', '2026-07-06', 8) === true, 'DSI déjà servie ce créneau → skip');
  check(_creneauDejaServi_(creneaux, 'DSI', '2026-07-06', 9) === false, 'DSI autre heure même jour → pas skip');
  check(_creneauDejaServi_(creneaux, 'DSI', '2026-07-07', 8) === false, 'DSI autre jour → pas skip');
  check(_creneauDejaServi_(creneaux, 'Qualite', '2026-07-06', 8) === false, 'autre newsletter → pas skip');

  Logger.log('--- testerTriggersDispatch : %s ---', echecs === 0 ? 'OK (tous verts)' : (echecs + ' échec(s)'));
}

/**
 * Test OFFLINE de la détection de charset (fix mojibake accents FR). Vérifie la
 * fonction PURE `_detecterCharset_` : priorité en-tête HTTP > déclaration XML,
 * liste blanche, repli UTF-8. Aucun accès réseau.
 * @return {void}
 */
function testerDetecterCharset() {
  var echecs = 0;
  function check(cond, libelle) {
    if (!cond) { echecs++; Logger.log('FAIL: %s', libelle); }
  }

  // 1. charset dans l'en-tête HTTP.
  check(_detecterCharset_('text/xml; charset=ISO-8859-1', '') === 'ISO-8859-1',
    'header charset ISO-8859-1');
  check(_detecterCharset_('application/rss+xml; charset=utf-8', '') === 'UTF-8',
    'header charset utf-8 → UTF-8 canonique');
  // 2. header absent → déclaration XML.
  check(_detecterCharset_('', '<?xml version="1.0" encoding="windows-1252"?>') === 'windows-1252',
    'prolog XML windows-1252');
  // 3. header ET prolog absents → UTF-8 par défaut.
  check(_detecterCharset_('', '') === 'UTF-8', 'ni header ni prolog → UTF-8');
  check(_detecterCharset_('text/xml', '<?xml version="1.0"?>') === 'UTF-8',
    'header sans charset + prolog sans encoding → UTF-8');
  // 4. charset hors liste blanche → repli UTF-8.
  check(_detecterCharset_('text/xml; charset=Shift_JIS', '') === 'UTF-8',
    'charset exotique → repli UTF-8');
  // 5. priorité header > prolog quand les deux diffèrent.
  check(_detecterCharset_('text/xml; charset=ISO-8859-1', '<?xml encoding="utf-8"?>') === 'ISO-8859-1',
    'header prioritaire sur le prolog');

  Logger.log('--- testerDetecterCharset : %s ---', echecs === 0 ? 'OK (tous verts)' : (echecs + ' échec(s)'));
}
