/**
 * src_dedup.gs — Déduplication des items par hash d'URL canonicalisée (PRD M2).
 *
 * `dedoublonner(items, idNewsletter)` calcule pour chaque item un SHA-256 de son
 * URL canonicalisée, puis rejette les doublons intra-run et ceux déjà présents
 * dans l'onglet `_historique` (déduplication GLOBALE plateforme). Lecture seule
 * de l'historique ; l'écriture y est l'incrément 5.
 */

/**
 * Paramètres de query string retirés à la canonicalisation (en plus du préfixe
 * `utm_`). Trackers publicitaires/analytics sans valeur d'identification.
 * @const
 */
var PARAMS_TRACKING_STRIP = ['fbclid', 'gclid', 'mc_cid', 'mc_eid', 'ref'];

/**
 * Déduplique une liste d'items (intra-run + contre `_historique`).
 * Renseigne `item.urlHash` sur les items retenus.
 *
 * @param {Array.<Object>} items Items normalisés (issus de collecterItems).
 * @param {string} idNewsletter Identifiant de la newsletter (pour les logs).
 * @return {{retenus: Array.<Object>, rejetesIntraRun: number, rejetesHistorique: number}}
 */
function dedoublonner(items, idNewsletter) {
  var historique = _lireHashesHistorique_();
  var vus = {};
  var retenus = [];
  var rejetesIntraRun = 0;
  var rejetesHistorique = 0;

  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    var canonique = _canonicaliserUrl_(item.url);
    var hash = _hashUrlHex_(canonique);

    if (historique.has(hash)) {
      rejetesHistorique++;
      continue;
    }
    if (vus[hash]) {
      rejetesIntraRun++;
      continue;
    }
    vus[hash] = true;
    item.urlHash = hash;
    retenus.push(item);
  }

  Logger.log('[dedup] %s : %s retenus, %s rejet(s) intra-run, %s rejet(s) historique.',
    idNewsletter, retenus.length, rejetesIntraRun, rejetesHistorique);

  return {
    retenus: retenus,
    rejetesIntraRun: rejetesIntraRun,
    rejetesHistorique: rejetesHistorique
  };
}

/* ──────────────────────────────────────────────────────────────────────────
 * Canonicalisation + hash.
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Canonicalise une URL pour la déduplication. Règles (cf. DECISIONS.md) :
 * scheme+host en minuscule, retrait `www.` et port par défaut, path conservé en
 * casse sans trailing slash, fragment retiré, params `utm_*`/trackers retirés et
 * params restants triés alphabétiquement. (Apps Script n'a pas de parseur d'URL.)
 *
 * @param {string} url URL originale.
 * @return {string} Forme canonique (chaîne hachée ensuite).
 * @private
 */
function _canonicaliserUrl_(url) {
  var u = _texte_(url);
  if (u === '') { return ''; }

  // Fragment.
  var diese = u.indexOf('#');
  if (diese !== -1) { u = u.substring(0, diese); }

  // Query.
  var query = '';
  var pointInterro = u.indexOf('?');
  if (pointInterro !== -1) {
    query = u.substring(pointInterro + 1);
    u = u.substring(0, pointInterro);
  }

  // Scheme.
  var scheme = '';
  var reste = u;
  var matchScheme = u.match(/^([a-zA-Z][a-zA-Z0-9+.\-]*):\/\//);
  if (matchScheme) {
    scheme = matchScheme[1].toLowerCase();
    reste = u.substring(matchScheme[0].length);
  }

  // Host:port + path.
  var slash = reste.indexOf('/');
  var hostPort;
  var path;
  if (slash === -1) {
    hostPort = reste;
    path = '';
  } else {
    hostPort = reste.substring(0, slash);
    path = reste.substring(slash);
  }
  hostPort = hostPort.toLowerCase().replace(/^www\./, '');
  if (scheme === 'http') { hostPort = hostPort.replace(/:80$/, ''); }
  if (scheme === 'https') { hostPort = hostPort.replace(/:443$/, ''); }

  // Trailing slash du path.
  if (path.length > 1) {
    path = path.replace(/\/+$/, '');
  } else if (path === '/') {
    path = '';
  }

  var base = scheme ? (scheme + '://' + hostPort + path) : (hostPort + path);
  var queryCanon = _canonQuery_(query);
  return queryCanon ? (base + '?' + queryCanon) : base;
}

/**
 * Filtre et trie les paramètres de query (retire utm_*, fbclid, gclid, mc_cid,
 * mc_eid, ref ; conserve le reste, casse préservée, trié alphabétiquement).
 * @param {string} query
 * @return {string}
 * @private
 */
function _canonQuery_(query) {
  if (_texte_(query) === '') { return ''; }
  var gardees = [];
  var paires = query.split('&');
  for (var i = 0; i < paires.length; i++) {
    var paire = paires[i];
    if (paire === '') { continue; }
    var eq = paire.indexOf('=');
    var cle = (eq === -1 ? paire : paire.substring(0, eq)).toLowerCase();
    if (cle.indexOf('utm_') === 0) { continue; }
    if (PARAMS_TRACKING_STRIP.indexOf(cle) !== -1) { continue; }
    gardees.push(paire);
  }
  gardees.sort();
  return gardees.join('&');
}

/**
 * Hash SHA-256 hexadécimal d'une chaîne (UTF-8).
 * @param {string} s
 * @return {string} Hex minuscule (64 caractères).
 * @private
 */
function _hashUrlHex_(s) {
  var octets = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8);
  var hex = '';
  for (var i = 0; i < octets.length; i++) {
    var b = (octets[i] + 256) % 256;
    var c = b.toString(16);
    hex += (c.length === 1) ? ('0' + c) : c;
  }
  return hex;
}

/* ──────────────────────────────────────────────────────────────────────────
 * Lecture de l'historique.
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Charge les url_hash de l'onglet `_historique` dans un Set (lookup O(1)).
 * Onglet absent / colonne absente → Set vide + warning (1er run sur Sheet neuve).
 * @return {!Set.<string>}
 * @private
 */
function _lireHashesHistorique_() {
  var set = new Set();
  var valeurs;
  try {
    valeurs = _lireColonneOnglet_(ONGLETS_TECHNIQUES.historique, 'url_hash');
  } catch (e) {
    Logger.log('[dedup][WARN] Lecture _historique impossible (%s) — dédup historique ignorée.', e.message);
    return set;
  }
  for (var i = 0; i < valeurs.length; i++) {
    var h = _texte_(valeurs[i]);
    if (h !== '') { set.add(h); }
  }
  return set;
}
