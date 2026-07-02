/**
 * src_collecte.gs — Collecte parallèle des flux RSS/Atom (PRD M1).
 *
 * `collecterItems(idNewsletter, config)` récupère les sources actives via
 * UrlFetchApp.fetchAll(), parse RSS 2.0 / Atom / RSS 1.0 (RDF) via XmlService,
 * normalise les items, applique la fenêtre temporelle et le filtre keywords,
 * et remonte les échecs de sources sans jamais interrompre le run.
 *
 * Le titre est conservé VERBATIM (règle métier). Le lien reste l'URL originale.
 * Aucun appel Claude ici (incr. 3). Aucune écriture Sheet ici (incr. 5).
 */

/**
 * Fenêtre temporelle (jours) selon la cadence.
 *
 * ⚠️ DÉPENDANCE ÉDITORIALE — FENETRE_JOURS_HEBDO = 3 (réduit de 7 pour borner le
 * volume envoyé au pré-filtre, cf. DECISIONS.md « dette latence batch »). Cette
 * valeur de 3 jours ne tient QUE si le run est déclenché un JOUR FIXE hebdomadaire
 * (trigger temporel, incrément 6). TANT QUE ce trigger n'existe pas, tout run
 * MANUEL espacé de plus de 3 jours du run précédent crée un TROU DE COUVERTURE
 * SILENCIEUX : les items publiés entre J-7 et J-3 ne sont jamais vus. Ne pas
 * augmenter la cadence manuelle sans repasser à 7, ou attendre l'incr. 6.
 */
var FENETRE_JOURS_HEBDO = 3;
var FENETRE_JOURS_MENSUEL = 30;

/**
 * Plafond d'items par rubrique envoyés au pré-filtre (borne la taille du batch
 * Claude sous le budget de poll 4 min, cf. DECISIONS.md). Appliqué APRÈS la dédup
 * et APRÈS le split par rubrique, jamais avant (sinon la dédup perdrait des items).
 * Inégalité STRICTE : une rubrique pile à ce nombre n'est ni tronquée ni loggée.
 */
var PLAFOND_ITEMS_PAR_RUBRIQUE_AVANT_PREFILTRE = 25;

/** Nombre max d'URL par appel fetchAll (limite Apps Script). */
var MAX_SOURCES_PAR_LOT = 100;

/** Longueur max du résumé brut conservé (borne la charge envoyée à Claude). */
var RESUME_BRUT_MAX = 1000;

/** Budget temps total des fetch en repli séquentiel (sous le cap 6 min). */
var BUDGET_FETCH_MS = 5 * 60 * 1000;

/** Seuil de sources HS au-delà duquel on logge une collecte dégradée. */
var SEUIL_HS_RATIO = 0.5;

/** Seuil d'items sans date par source signalant un souci de parsing. */
var SEUIL_SANS_DATE_SOURCE = 0.3;

/**
 * Collecte les items des sources actives d'une newsletter.
 *
 * @param {string} idNewsletter Identifiant de la newsletter (pour les logs).
 * @param {Object} config Config issue de lireConfig (sources, cadence…).
 * @return {{
 *   items: Array.<Object>,
 *   echecs: Array.<{source: string, rubrique: string, url: string, raison: string}>,
 *   statsParRubrique: !Object.<string, {sourcesOk: number, sourcesHs: number, items: number}>,
 *   santeCollecte: {sourcesTotal: number, sourcesOk: number, sourcesHs: number, ratioHs: number},
 *   sourcesSansDate: Array.<{source: string, ratioSansDate: number, sansDate: number, total: number}>
 * }} Résultat de collecte (items normalisés + diagnostic).
 */
function collecterItems(idNewsletter, config) {
  var debutFetch = (new Date()).getTime();
  var cadence = (config && config.cadence) ? config.cadence : 'hebdo';
  var sourcesActives = ((config && config.sources) || []).filter(function(s) {
    return s.active;
  });

  var echecs = [];
  var stats = {};
  var sourcesSansDate = [];

  function statRubrique(rubrique) {
    if (!stats[rubrique]) {
      stats[rubrique] = { sourcesOk: 0, sourcesHs: 0, items: 0 };
    }
    return stats[rubrique];
  }
  function marquerHs(source, raison) {
    echecs.push({
      source: source.nomSource, rubrique: source.rubrique,
      url: source.urlRss, raison: raison
    });
    statRubrique(source.rubrique).sourcesHs++;
    Logger.log('[collecte][WARN] Source HS "%s" (%s) : %s', source.nomSource, source.rubrique, raison);
  }

  // Sources à URL vide : échec immédiat, non envoyées au fetch.
  var aFetcher = [];
  sourcesActives.forEach(function(s) {
    if (_texte_(s.urlRss) === '') {
      marquerHs(s, 'URL RSS vide');
    } else {
      aFetcher.push(s);
    }
  });

  var reponses = _recupererFlux_(aFetcher, debutFetch);

  var items = [];
  reponses.forEach(function(rep) {
    var s = rep.source;
    if (rep.erreur) { marquerHs(s, rep.erreur); return; }
    if (rep.code < 200 || rep.code > 299) { marquerHs(s, 'HTTP ' + rep.code); return; }
    var corps = _texte_(rep.body);
    if (corps === '') { marquerHs(s, 'corps vide'); return; }

    var bruts;
    try {
      bruts = _parserFlux_(corps, s);
    } catch (e) {
      Logger.log('[collecte][ERREUR] Parsing "%s" : %s', s.nomSource, e.message);
      marquerHs(s, 'réponse non-XML/illisible');
      return;
    }

    var total = 0;
    var sansDate = 0;
    var gardes = [];
    bruts.forEach(function(brut) {
      var item = _normaliserItem_(brut, s);
      total++;
      if (item.datePublication === null) { sansDate++; }
      if (_dansLaFenetre_(item.datePublication, cadence)) {
        gardes.push(item);
      }
    });
    gardes = _appliquerFiltreKeywords_(gardes, s.filterKeywords);

    items = items.concat(gardes);
    statRubrique(s.rubrique).sourcesOk++;
    statRubrique(s.rubrique).items += gardes.length;

    // Garde-fou parsing date : > 30 % d'items sans date pour cette source.
    if (total > 0 && (sansDate / total) > SEUIL_SANS_DATE_SOURCE) {
      Logger.log('[collecte][WARN] Source "%s" : %s/%s items sans date (%s%%) — candidat à investigation parsing.',
        s.nomSource, sansDate, total, Math.round(sansDate / total * 100));
      sourcesSansDate.push({
        source: s.nomSource, ratioSansDate: sansDate / total,
        sansDate: sansDate, total: total
      });
    }
  });

  var sourcesTotal = sourcesActives.length;
  var sourcesHs = echecs.length;
  var sourcesOk = sourcesTotal - sourcesHs;
  var ratioHs = sourcesTotal > 0 ? sourcesHs / sourcesTotal : 0;
  if (ratioHs > SEUIL_HS_RATIO) {
    Logger.log('[collecte][WARN] %s : collecte dégradée — %s/%s sources HS (%s%%).',
      idNewsletter, sourcesHs, sourcesTotal, Math.round(ratioHs * 100));
  }
  Logger.log('[collecte] %s : %s items collectés, %s/%s sources OK.',
    idNewsletter, items.length, sourcesOk, sourcesTotal);

  return {
    items: items,
    echecs: echecs,
    statsParRubrique: stats,
    santeCollecte: {
      sourcesTotal: sourcesTotal, sourcesOk: sourcesOk,
      sourcesHs: sourcesHs, ratioHs: ratioHs
    },
    sourcesSansDate: sourcesSansDate
  };
}

/**
 * Plafonne le nombre d'items PAR RUBRIQUE avant le pré-filtre (borne la taille du
 * batch Claude). À appeler APRÈS dedoublonner (jamais avant : la dédup ne doit pas
 * perdre d'items via un tri prématuré) et AVANT prefilterTitres.
 *
 * Pour chaque rubrique : si (et seulement si) son volume DÉPASSE STRICTEMENT le
 * plafond, tri par date décroissante (items sans date en dernier → écartés en
 * premier) puis troncature. Sinon la rubrique est laissée inchangée (aucun tri,
 * aucun biais). Un log est émis pour CHAQUE rubrique.
 *
 * @param {Array.<Object>} items Items dédupliqués.
 * @return {Array.<Object>} Items plafonnés (concaténation des rubriques).
 */
function plafonnerParRubrique(items) {
  var parRubrique = {};
  (items || []).forEach(function(it) {
    var r = it.rubrique || '';
    if (!parRubrique[r]) { parRubrique[r] = []; }
    parRubrique[r].push(it);
  });

  var sortie = [];
  for (var rubrique in parRubrique) {
    if (!Object.prototype.hasOwnProperty.call(parRubrique, rubrique)) { continue; }
    var liste = parRubrique[rubrique];
    var avant = liste.length;
    if (avant > PLAFOND_ITEMS_PAR_RUBRIQUE_AVANT_PREFILTRE) { // inégalité STRICTE
      liste = liste.slice().sort(_parDateDesc_).slice(0, PLAFOND_ITEMS_PAR_RUBRIQUE_AVANT_PREFILTRE);
      Logger.log('[plafond] %s : %s → %s (%s écartés)', rubrique, avant, liste.length, avant - liste.length);
    } else {
      Logger.log('[plafond] %s : %s → %s (inchangé)', rubrique, avant, avant);
    }
    sortie = sortie.concat(liste);
  }
  return sortie;
}

/**
 * Comparateur : date de publication décroissante ; items sans date en dernier.
 * @param {Object} a
 * @param {Object} b
 * @return {number}
 * @private
 */
function _parDateDesc_(a, b) {
  var ta = a.datePublication ? a.datePublication.getTime() : -Infinity;
  var tb = b.datePublication ? b.datePublication.getTime() : -Infinity;
  return tb - ta;
}

/* ──────────────────────────────────────────────────────────────────────────
 * Récupération réseau.
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Récupère les flux par lots de fetchAll, avec repli séquentiel borné en temps.
 * @param {Array.<Object>} sources Sources (avec urlRss non vide).
 * @param {number} debutFetch Timestamp (ms) de début de phase fetch.
 * @return {Array.<{source: Object, code: number, body: string, erreur: ?string}>}
 * @private
 */
function _recupererFlux_(sources, debutFetch) {
  var resultats = [];
  for (var i = 0; i < sources.length; i += MAX_SOURCES_PAR_LOT) {
    var lot = sources.slice(i, i + MAX_SOURCES_PAR_LOT);
    var requetes = lot.map(function(s) {
      return { url: s.urlRss, muteHttpExceptions: true, followRedirects: true };
    });
    var reponses;
    try {
      reponses = UrlFetchApp.fetchAll(requetes);
    } catch (eLot) {
      Logger.log('[collecte][WARN] fetchAll a échoué sur un lot de %s — repli séquentiel : %s',
        lot.length, eLot.message);
      _fetchSequentiel_(lot, debutFetch, resultats);
      continue;
    }
    for (var j = 0; j < lot.length; j++) {
      try {
        resultats.push({
          source: lot[j], code: reponses[j].getResponseCode(),
          body: _lireCorpsReponse_(reponses[j]), erreur: null
        });
      } catch (eRep) {
        resultats.push({ source: lot[j], code: 0, body: '', erreur: 'lecture réponse : ' + eRep.message });
      }
    }
  }
  return resultats;
}

/**
 * Repli séquentiel source par source, borné par BUDGET_FETCH_MS. Au-delà du
 * budget, les sources restantes sont marquées "timeout cumulé".
 * @param {Array.<Object>} lot
 * @param {number} debutFetch
 * @param {Array} resultats Accumulateur (muté).
 * @return {void}
 * @private
 */
function _fetchSequentiel_(lot, debutFetch, resultats) {
  for (var k = 0; k < lot.length; k++) {
    if ((new Date()).getTime() - debutFetch > BUDGET_FETCH_MS) {
      for (var m = k; m < lot.length; m++) {
        resultats.push({ source: lot[m], code: 0, body: '', erreur: 'timeout cumulé' });
      }
      Logger.log('[collecte][WARN] Budget fetch (%s min) dépassé — %s source(s) non traitée(s).',
        BUDGET_FETCH_MS / 60000, lot.length - k);
      return;
    }
    var s = lot[k];
    try {
      var rep = UrlFetchApp.fetch(s.urlRss, { muteHttpExceptions: true, followRedirects: true });
      resultats.push({ source: s, code: rep.getResponseCode(), body: _lireCorpsReponse_(rep), erreur: null });
    } catch (e) {
      resultats.push({ source: s, code: 0, body: '', erreur: 'fetch : ' + e.message });
    }
  }
}

/* ──────────────────────────────────────────────────────────────────────────
 * Décodage du corps de réponse selon le charset (fix mojibake accents FR).
 * ────────────────────────────────────────────────────────────────────────── */

/** Charsets supportés (liste blanche). Tout autre nom → repli UTF-8. @const */
var CHARSETS_SUPPORTES = { 'utf-8': 'UTF-8', 'iso-8859-1': 'ISO-8859-1', 'windows-1252': 'windows-1252' };

/**
 * Lit le corps d'une réponse en le décodant avec le BON charset.
 *
 * `getContentText()` sans argument décode en UTF-8 ; un flux servi en
 * ISO-8859-1/Windows-1252 (fréquent côté FR) produit alors du mojibake sur les
 * accents (« é » → « ï¿œ »). On détecte donc le charset (en-tête HTTP puis
 * déclaration XML), et on re-décode en conséquence.
 *
 * Auto-réparation : certains flux DÉCLARENT UTF-8 mais SERVENT du Latin-1/1252
 * (misconfiguration serveur, parfois par intermittence dans un même document). On
 * décode selon le charset déclaré, puis on compare un SCORE de mojibake entre ce
 * décodage et un décodage Windows-1252, et on garde le moins mauvais. Le score
 * compte les DEUX modes d'échec : U+FFFD (Latin-1 lu en UTF-8) ET la signature
 * « Ã/Â + octet haut » (UTF-8 lu en 1252) — ce qui évite le faux positif qui
 * transformait « é » (C3 A9) en « Ã© ». Un décodage UTF-8 propre (score 0) n'est
 * jamais retouché. Jamais d'exception : tout échec retombe sur UTF-8.
 *
 * @param {GoogleAppsScript.URL_Fetch.HTTPResponse} response
 * @return {string} Corps décodé.
 * @private
 */
function _lireCorpsReponse_(response) {
  try {
    var contentType = '';
    try {
      var headers = response.getAllHeaders() || {};
      contentType = headers['Content-Type'] || headers['content-type'] || '';
    } catch (eH) {
      contentType = '';
    }
    // Sniff du prolog XML en Latin-1 (mapping octet→char 1:1, ne casse jamais).
    var prolog = '';
    try {
      prolog = response.getContentText('ISO-8859-1').substring(0, 200);
    } catch (eP) {
      prolog = '';
    }
    var charset = _detecterCharset_(contentType, prolog);
    var corps = response.getContentText(charset);
    // Charset explicitement 1252, ou décodage propre → rien à faire (pas de 2e appel).
    if (charset.toLowerCase() === 'windows-1252' || _scoreMojibake_(corps) === 0) {
      return corps;
    }
    var win = response.getContentText('windows-1252');
    var choisi = _choisirDecodage_(corps, win);
    if (choisi !== corps) {
      Logger.log('[collecte] Re-décodage Windows-1252 (score mojibake %s → %s).',
        _scoreMojibake_(corps), _scoreMojibake_(win));
    }
    return choisi;
  } catch (e) {
    Logger.log('[collecte][WARN] Décodage charset impossible, repli UTF-8 : %s', e.message);
    return response.getContentText();
  }
}

/**
 * Détermine le charset à utiliser (PUR, testable offline). Priorité : en-tête
 * HTTP Content-Type, puis déclaration XML `encoding="..."`, puis UTF-8. Le nom
 * détecté est validé contre CHARSETS_SUPPORTES (sinon UTF-8).
 *
 * @param {string} contentType Valeur de l'en-tête Content-Type (peut être vide).
 * @param {string} prolog Début du document (déclaration XML éventuelle).
 * @return {string} Nom de charset canonique accepté par getContentText.
 * @private
 */
function _detecterCharset_(contentType, prolog) {
  var m = _texte_(contentType).match(/charset\s*=\s*["']?([^"';\s]+)/i);
  if (!m) {
    m = _texte_(prolog).match(/encoding\s*=\s*["']([^"']+)["']/i);
  }
  if (m) {
    var nom = m[1].toLowerCase();
    if (Object.prototype.hasOwnProperty.call(CHARSETS_SUPPORTES, nom)) {
      return CHARSETS_SUPPORTES[nom];
    }
  }
  return 'UTF-8';
}

/**
 * Score de mojibake d'un texte décodé (plus bas = mieux). PUR, testable offline.
 * Compte les DEUX modes d'échec de décodage :
 *  - U+FFFD (0xFFFD) : octets invalides — Latin-1/1252 lu comme UTF-8 ;
 *  - signature « Ã/Â (0xC2/0xC3) + caractère ≥ 0x80 » : UTF-8 lu comme 1252
 *    (ex. « é » = C3 A9 → « Ã© »). Quasi inexistante en français/anglais légitime.
 * @param {string} texte
 * @return {number}
 * @private
 */
function _scoreMojibake_(texte) {
  var s = _texte_(texte);
  var score = 0;
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    if (c === 0xFFFD) {
      score++;
    } else if ((c === 0xC2 || c === 0xC3) && i + 1 < s.length && s.charCodeAt(i + 1) >= 0x80) {
      score++;
    }
  }
  return score;
}

/**
 * Choisit, entre le décodage UTF-8 et le décodage Windows-1252, celui qui a le
 * moins de mojibake. UTF-8 propre (score 0) est renvoyé tel quel ; sinon on ne
 * bascule sur 1252 que s'il est STRICTEMENT meilleur (égalité → UTF-8 déclaré).
 * PUR, testable offline.
 * @param {string} utf8 Décodage selon le charset déclaré (généralement UTF-8).
 * @param {string} win Décodage Windows-1252.
 * @return {string}
 * @private
 */
function _choisirDecodage_(utf8, win) {
  if (_scoreMojibake_(utf8) === 0) {
    return utf8;
  }
  return _scoreMojibake_(win) < _scoreMojibake_(utf8) ? win : utf8;
}

/* ──────────────────────────────────────────────────────────────────────────
 * Parsing XML (RSS 2.0 / Atom / RSS 1.0 RDF), par nom local (namespace-agnostique).
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Parse un flux et retourne des items bruts (champs texte non normalisés).
 * @param {string} corps Corps XML.
 * @param {Object} source Source d'origine (pour contexte).
 * @return {Array.<{titre: string, url: string, dateCandidates: Array.<string>, resume: string}>}
 * @throws {Error} Si XmlService ne peut pas parser (flux malformé).
 * @private
 */
function _parserFlux_(corps, source) {
  var racine = XmlService.parse(corps).getRootElement();
  var nomRacine = racine.getName();
  var bruts = [];

  if (nomRacine === 'feed') { // Atom
    _collecterParNomLocal_(racine, 'entry').forEach(function(e) {
      bruts.push({
        titre: _texteEnfantLocal_(e, 'title'),
        url: _lienAtom_(e),
        dateCandidates: [_texteEnfantLocal_(e, 'published'), _texteEnfantLocal_(e, 'updated'),
          _texteEnfantLocal_(e, 'date')],
        resume: _texteEnfantLocal_(e, 'summary') || _texteEnfantLocal_(e, 'content')
      });
    });
  } else { // RSS 2.0 ('rss') ou RSS 1.0 RDF ('RDF')
    _collecterParNomLocal_(racine, 'item').forEach(function(it) {
      bruts.push({
        titre: _texteEnfantLocal_(it, 'title'),
        url: _lienRss_(it),
        dateCandidates: [_texteEnfantLocal_(it, 'pubDate'), _texteEnfantLocal_(it, 'date')],
        resume: _texteEnfantLocal_(it, 'encoded') || _texteEnfantLocal_(it, 'description')
      });
    });
  }
  return bruts;
}

/**
 * Collecte récursivement les éléments d'un nom local donné (ignore le namespace).
 * @param {GoogleAppsScript.XML_Service.Element} element
 * @param {string} nomLocal
 * @return {Array.<GoogleAppsScript.XML_Service.Element>}
 * @private
 */
function _collecterParNomLocal_(element, nomLocal) {
  var acc = [];
  (function rec(el) {
    var enfants = el.getChildren();
    for (var i = 0; i < enfants.length; i++) {
      if (enfants[i].getName() === nomLocal) {
        acc.push(enfants[i]);
      } else {
        rec(enfants[i]);
      }
    }
  })(element);
  return acc;
}

/**
 * Texte du premier enfant direct portant ce nom local ; '' si absent.
 * @param {GoogleAppsScript.XML_Service.Element} element
 * @param {string} nomLocal
 * @return {string}
 * @private
 */
function _texteEnfantLocal_(element, nomLocal) {
  var enfants = element.getChildren();
  for (var i = 0; i < enfants.length; i++) {
    if (enfants[i].getName() === nomLocal) {
      return _texte_(enfants[i].getText());
    }
  }
  return '';
}

/**
 * Lien d'un item RSS : texte de <link>, sinon attribut href (cas atom:link).
 * @param {GoogleAppsScript.XML_Service.Element} item
 * @return {string}
 * @private
 */
function _lienRss_(item) {
  var enfants = item.getChildren();
  var fallbackHref = '';
  for (var i = 0; i < enfants.length; i++) {
    if (enfants[i].getName() === 'link') {
      var texte = _texte_(enfants[i].getText());
      if (texte !== '') { return texte; }
      var href = enfants[i].getAttribute('href');
      if (href && _texte_(href.getValue()) !== '' && fallbackHref === '') {
        fallbackHref = _texte_(href.getValue());
      }
    }
  }
  return fallbackHref;
}

/**
 * Lien d'une entrée Atom : href du <link rel="alternate"> (ou premier href).
 * @param {GoogleAppsScript.XML_Service.Element} entry
 * @return {string}
 * @private
 */
function _lienAtom_(entry) {
  var enfants = entry.getChildren();
  var fallback = '';
  for (var i = 0; i < enfants.length; i++) {
    if (enfants[i].getName() === 'link') {
      var href = enfants[i].getAttribute('href');
      var hrefVal = href ? _texte_(href.getValue()) : '';
      if (hrefVal === '') { continue; }
      var rel = enfants[i].getAttribute('rel');
      if (!rel || _texte_(rel.getValue()) === 'alternate') { return hrefVal; }
      if (fallback === '') { fallback = hrefVal; }
    }
  }
  return fallback;
}

/* ──────────────────────────────────────────────────────────────────────────
 * Normalisation, fenêtre temporelle, filtre keywords, nettoyage.
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Construit l'item normalisé (contrat incr. 3/4/5) à partir d'un item brut.
 * @param {Object} brut
 * @param {Object} source
 * @return {{titre: string, url: string, source: string, rubrique: string,
 *           datePublication: ?Date, resumeBrut: string, urlHash: ?string}}
 * @private
 */
function _normaliserItem_(brut, source) {
  return {
    titre: _texte_(brut.titre),
    url: _texte_(brut.url),
    source: source.nomSource,
    rubrique: source.rubrique,
    datePublication: _parserDate_(brut.dateCandidates),
    resumeBrut: _nettoyerHtml_(brut.resume),
    urlHash: null
  };
}

/**
 * Parse la première date candidate lisible. RFC 822 (RSS) et ISO 8601 (Atom)
 * sont gérés nativement par le moteur V8 ; tout le reste → null.
 * @param {Array.<string>} candidates
 * @return {?Date}
 * @private
 */
function _parserDate_(candidates) {
  for (var i = 0; i < candidates.length; i++) {
    var s = _texte_(candidates[i]);
    if (s === '') { continue; }
    var d = new Date(s);
    if (!isNaN(d.getTime())) { return d; }
  }
  return null;
}

/**
 * Indique si une date est dans la fenêtre (now − N jours). Date null → inclus.
 * @param {?Date} date
 * @param {string} cadence 'hebdo' | 'mensuel'
 * @return {boolean}
 * @private
 */
function _dansLaFenetre_(date, cadence) {
  if (date === null) { return true; }
  var jours = (cadence === 'mensuel') ? FENETRE_JOURS_MENSUEL : FENETRE_JOURS_HEBDO;
  var limite = (new Date()).getTime() - jours * 24 * 60 * 60 * 1000;
  return date.getTime() >= limite;
}

/**
 * Filtre keywords (OR) sur titre + résumé brut. Source sans keywords → tout gardé.
 * @param {Array.<Object>} items
 * @param {string} keywords Liste séparée par virgules/espaces.
 * @return {Array.<Object>}
 * @private
 */
function _appliquerFiltreKeywords_(items, keywords) {
  var kws = _texte_(keywords).toLowerCase().split(/[,\s]+/).filter(function(k) {
    return k !== '';
  });
  if (!kws.length) { return items; }
  return items.filter(function(it) {
    var foin = (it.titre + ' ' + it.resumeBrut).toLowerCase();
    for (var i = 0; i < kws.length; i++) {
      if (foin.indexOf(kws[i]) !== -1) { return true; }
    }
    return false;
  });
}

/**
 * Retire les balises HTML, décode les entités courantes, collapse les espaces,
 * tronque à RESUME_BRUT_MAX. (Ne s'applique JAMAIS au titre, conservé verbatim.)
 * @param {string} s
 * @return {string}
 * @private
 */
function _nettoyerHtml_(s) {
  var t = _texte_(s);
  if (t === '') { return ''; }
  t = t.replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
  if (t.length > RESUME_BRUT_MAX) {
    t = t.substring(0, RESUME_BRUT_MAX) + '…';
  }
  return t;
}
