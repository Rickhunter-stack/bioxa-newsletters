/**
 * src_claude.gs — Appels Claude via la Message Batches API (PRD M3 + M4).
 *
 * RÈGLE CLAUDE.md : tout appel à l'API Claude passe par appelerClaudeBatch().
 * Pipeline : prefilterTitres (M3, titre seul) PUIS scorerEtResumer (M4) — le
 * pré-filtre précède TOUJOURS le scoring (non négociable).
 *
 * Architecture (cf. DECISIONS.md, incr. 3) :
 * - Option A : poll synchrone borné (budget 4 min) dans un seul run.
 * - Option 2 : un batch de N requêtes (1 par item), custom_id = urlHash.
 * - Structured outputs (output_config.format) activés — supportés en Batches —
 *   + parse défensif de repli (une garantie API n'est jamais 100 %).
 *
 * Anti-fuite : seuls titre + résumé brut (publics) sont envoyés. Le titre n'est
 * jamais reformulé. Le résumé final est tronqué à 200 caractères.
 */

/** Clé Script Property de la clé API Anthropic (jamais dans le code/Sheet). */
var PROP_CLE_API_ANTHROPIC = 'ANTHROPIC_API_KEY';

/** Version d'API Anthropic (en-tête anthropic-version). */
var ANTHROPIC_VERSION = '2023-06-01';

/** Retries sur 429/5xx (PRD P6 : 2 retries). */
var CLAUDE_MAX_RETRIES = 2;
/** Backoff exponentiel de base (2 s, 4 s). */
var CLAUDE_BACKOFF_BASE_MS = 2000;

/** Budget total d'attente de fin de batch (Option A). */
var BATCH_POLL_BUDGET_MS = 4 * 60 * 1000;

/** Remise Batch API (−50 %) pour l'estimation de coût. */
var REMISE_BATCH = 0.5;

/** Longueur max du résumé final (PRD M4). */
var RESUME_MAX_CHARS = 200;

/**
 * Template de prompt du pré-filtre — versionné dans Git (NON stocké en Sheet).
 * `{{rubrique}}` est substitué à l'exécution. Le scoring, lui, utilise le prompt
 * système versionné de l'onglet newsletter (config.promptSysteme).
 */
var PROMPT_PREFILTER_TEMPLATE =
  '# prefilter v2026-06-27\n' +
  'Tu filtres des titres d\'articles pour une newsletter de veille professionnelle.\n' +
  'Question : ce titre concerne-t-il la rubrique « {{rubrique}} » ?\n' +
  'Réponds « oui » si le titre est plausiblement pertinent pour cette rubrique, « non » sinon.\n' +
  'Ne reformule pas le titre, ne l\'explique pas.';

/** Schéma de sortie structurée du pré-filtre. */
var FORMAT_PREFILTER = {
  type: 'json_schema',
  schema: {
    type: 'object',
    properties: { decision: { type: 'string', enum: ['oui', 'non'] } },
    required: ['decision'],
    additionalProperties: false
  }
};

/** Schéma de sortie structurée du scoring (contraintes numériques bornées en code). */
var FORMAT_SCORING = {
  type: 'json_schema',
  schema: {
    type: 'object',
    properties: {
      score: { type: 'integer' },
      resume_fr: { type: 'string' },
      titre_traduction: { type: ['string', 'null'] },
      raison: { type: 'string' }
    },
    required: ['score', 'resume_fr', 'titre_traduction', 'raison'],
    additionalProperties: false
  }
};

/**
 * Instruction de traduction ajoutée au prompt système de scoring (auto-contenu,
 * indépendant du prompt Sheet). Le titre original reste verbatim ; la traduction
 * est un champ ADDITIONNEL distinct.
 */
var SUFFIXE_PROMPT_TRADUCTION =
  '\n\nEn plus du score, du résumé et de la raison, renseigne "titre_traduction" : ' +
  'la traduction française fidèle du titre de l\'article. Si le titre est DÉJÀ en ' +
  'français, mets "titre_traduction" à null. Ne modifie jamais le titre original.';

/* ──────────────────────────────────────────────────────────────────────────
 * M3 — Pré-filtre IA sur titre seul.
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Pré-filtre : pour chaque item, demande à Claude si le titre concerne sa
 * rubrique. Conserve les « oui ». Un item en échec d'appel est CONSERVÉ + warning
 * (ne jamais perdre un item potentiellement pertinent sur une erreur technique).
 *
 * @param {Array.<Object>} items Items dédupliqués (urlHash renseigné).
 * @param {Object} config Config (lireConfig) — global.claudeModel, etc.
 * @return {{items: Array.<Object>, usage: {inputTokens: number, outputTokens: number}}}
 *   Items conservés + usage tokens du batch (pour l'estimation de coût, incr. 5).
 */
function prefilterTitres(items, config) {
  if (!items || !items.length) {
    return { items: [], usage: { inputTokens: 0, outputTokens: 0 } };
  }
  var requetes = [];
  items.forEach(function(item) {
    if (!item.urlHash) {
      Logger.log('[claude][WARN] Item sans urlHash ignoré au pré-filtre : %s', item.titre);
      return;
    }
    var systeme = PROMPT_PREFILTER_TEMPLATE.split('{{rubrique}}').join(item.rubrique || '');
    requetes.push({
      custom_id: item.urlHash,
      params: {
        max_tokens: 16,
        system: systeme,
        messages: [{ role: 'user', content: 'Titre : ' + item.titre }],
        output_config: { format: FORMAT_PREFILTER }
      }
    });
  });

  var sortie = appelerClaudeBatch(requetes, config, 'prefilter');
  var resultats = sortie.resultats;

  var conserves = [];
  items.forEach(function(item) {
    var r = resultats[item.urlHash];
    if (!r || !r.ok) {
      Logger.log('[claude][WARN] Pré-filtre en échec pour "%s" — item conservé par prudence.', item.titre);
      conserves.push(item);
      return;
    }
    var parsed = _extraireSortie_(r.message);
    var decision = parsed ? _texte_(parsed.decision).toLowerCase() : '';
    if (decision === 'non') {
      return; // rejeté
    }
    if (decision !== 'oui') {
      Logger.log('[claude][WARN] Décision pré-filtre illisible pour "%s" — item conservé.', item.titre);
    }
    conserves.push(item);
  });

  Logger.log('[claude] Pré-filtre : %s/%s items conservés.', conserves.length, items.length);
  return { items: conserves, usage: sortie.usage };
}

/* ──────────────────────────────────────────────────────────────────────────
 * M4 — Scoring + résumé.
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Scoring + résumé : pour chaque item, Claude renvoie {score 0-10, resume_fr ≤200,
 * raison}. Sélectionne ensuite le top N par rubrique (config.nItemsParRubrique).
 * Un item en échec d'appel ou illisible est écarté (non scoré = non classable) + warning.
 *
 * @param {Array.<Object>} items Items ayant passé le pré-filtre.
 * @param {Object} config Config (lireConfig) — promptSysteme requis.
 * @return {{items: Array.<Object>, usage: {inputTokens: number, outputTokens: number}}}
 *   Items enrichis (score, resumeFr, raison) top N/rubrique + usage tokens du batch.
 * @throws {Error} Si config.promptSysteme est absent (scoring impossible).
 */
function scorerEtResumer(items, config) {
  if (!config || !config.promptSysteme) {
    throw new Error('scorerEtResumer : prompt système absent (onglet newsletter) — scoring impossible.');
  }
  if (!items || !items.length) {
    return { items: [], usage: { inputTokens: 0, outputTokens: 0 } };
  }

  var requetes = [];
  items.forEach(function(item) {
    if (!item.urlHash) {
      Logger.log('[claude][WARN] Item sans urlHash ignoré au scoring : %s', item.titre);
      return;
    }
    var contenu = 'Titre : ' + item.titre + '\n' +
      'Source : ' + item.source + '\n' +
      'Rubrique : ' + item.rubrique + '\n' +
      'Résumé brut : ' + item.resumeBrut;
    requetes.push({
      custom_id: item.urlHash,
      params: {
        max_tokens: 400,
        system: config.promptSysteme + SUFFIXE_PROMPT_TRADUCTION,
        messages: [{ role: 'user', content: contenu }],
        output_config: { format: FORMAT_SCORING }
      }
    });
  });

  var sortie = appelerClaudeBatch(requetes, config, 'scoring');
  var resultats = sortie.resultats;

  var scores = [];
  items.forEach(function(item) {
    var r = resultats[item.urlHash];
    if (!r || !r.ok) {
      Logger.log('[claude][WARN] Scoring en échec pour "%s" — item écarté.', item.titre);
      return;
    }
    var parsed = _extraireSortie_(r.message);
    if (!parsed || typeof parsed.score === 'undefined') {
      Logger.log('[claude][WARN] Score illisible pour "%s" — item écarté.', item.titre);
      return;
    }
    item.score = _bornerScore_(parsed.score);
    item.resumeFr = _tronquerResume_(_texte_(parsed.resume_fr), item.titre);
    // Traduction FR additionnelle (null/absente → '' ; jamais le titre original).
    item.titreTraduction = _texte_(parsed.titre_traduction);
    item.raison = _texte_(parsed.raison);
    scores.push(item);
  });

  var selection = _selectionnerTopParRubrique_(scores, config.nItemsParRubrique);
  Logger.log('[claude] Scoring : %s items scorés, %s sélectionnés (top %s/rubrique).',
    scores.length, selection.length, config.nItemsParRubrique);
  return { items: selection, usage: sortie.usage };
}

/* ──────────────────────────────────────────────────────────────────────────
 * Choke-point unique : création + poll + récupération du batch.
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Exécute un batch Claude : crée le batch, attend sa fin (poll borné), récupère
 * et ré-apparie les résultats par custom_id, logge le coût estimé.
 * Le modèle est injecté depuis config.global.claudeModel dans chaque requête.
 *
 * @param {Array.<{custom_id: string, params: Object}>} requetes
 * @param {Object} config Config (lireConfig).
 * @param {string} etiquette Libellé pour les logs (ex. "prefilter", "scoring").
 * @return {{resultats: !Object.<string, Object>, usage: {inputTokens: number, outputTokens: number}, nbItems: number}}
 * @throws {Error} Si la clé API est absente, l'appel échoue après retries, ou le
 *   batch ne se termine pas dans le budget.
 */
function appelerClaudeBatch(requetes, config, etiquette) {
  if (!requetes || !requetes.length) {
    return { resultats: {}, usage: { inputTokens: 0, outputTokens: 0 }, nbItems: 0 };
  }

  var cle = PropertiesService.getScriptProperties().getProperty(PROP_CLE_API_ANTHROPIC);
  if (!_texte_(cle)) {
    throw new Error('appelerClaudeBatch : clé API absente (Script Property "' + PROP_CLE_API_ANTHROPIC + '").');
  }
  var modele = config.global.claudeModel;
  var endpoint = config.global.claudeApiEndpoint;

  // Injection du modèle dans chaque requête.
  var requetesCompletes = requetes.map(function(req) {
    var params = {};
    for (var k in req.params) {
      if (Object.prototype.hasOwnProperty.call(req.params, k)) {
        params[k] = req.params[k];
      }
    }
    params.model = modele;
    return { custom_id: req.custom_id, params: params };
  });

  var enTetes = {
    'x-api-key': cle,
    'anthropic-version': ANTHROPIC_VERSION,
    'content-type': 'application/json'
  };

  // 1. Création du batch.
  var batch = _appelerAvecRetry_(endpoint, {
    method: 'post',
    headers: enTetes,
    contentType: 'application/json',
    payload: JSON.stringify({ requests: requetesCompletes }),
    muteHttpExceptions: true
  }, etiquette + ':create');
  Logger.log('[claude] Batch "%s" créé (id=%s, %s requêtes).', etiquette, batch.id, requetesCompletes.length);

  // 2. Attente de fin (poll borné).
  var debut = (new Date()).getTime();
  var termine = _attendreFinBatch_(batch.id, endpoint, enTetes, debut + BATCH_POLL_BUDGET_MS, etiquette);

  // 3. Récupération + ré-appariement.
  var lignes = _recupererResultats_(termine.results_url, enTetes, etiquette);
  var resultats = _indexerResultats_(lignes);

  // 4. Coût.
  var usage = _sommerUsage_(resultats);
  _loggerCout_(etiquette, requetesCompletes.length, usage, config);

  return { resultats: resultats, usage: usage, nbItems: requetesCompletes.length };
}

/* ──────────────────────────────────────────────────────────────────────────
 * HTTP + poll (privés).
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * UrlFetchApp.fetch avec retry exponentiel sur 429/5xx et erreurs réseau.
 * @param {string} url
 * @param {Object} options Options UrlFetchApp (muteHttpExceptions attendu).
 * @param {string} contexte Pour les logs.
 * @return {Object} Corps JSON parsé.
 * @throws {Error} Sur 4xx non-retryable ou après épuisement des retries.
 * @private
 */
function _appelerAvecRetry_(url, options, contexte) {
  var derniereErreur = '';
  for (var tentative = 0; tentative <= CLAUDE_MAX_RETRIES; tentative++) {
    if (tentative > 0) {
      Utilities.sleep(CLAUDE_BACKOFF_BASE_MS * Math.pow(2, tentative - 1));
    }
    var code;
    var corps;
    try {
      var reponse = UrlFetchApp.fetch(url, options);
      code = reponse.getResponseCode();
      corps = reponse.getContentText();
    } catch (e) {
      derniereErreur = 'réseau : ' + e.message;
      Logger.log('[claude][WARN] %s tentative %s : %s', contexte, tentative + 1, derniereErreur);
      continue; // retry réseau
    }
    if (code >= 200 && code < 300) {
      try {
        return JSON.parse(corps);
      } catch (eJson) {
        throw new Error('[claude] ' + contexte + ' : réponse 2xx non-JSON : ' + eJson.message);
      }
    }
    if (code === 429 || code >= 500) {
      derniereErreur = 'HTTP ' + code + ' : ' + corps;
      Logger.log('[claude][WARN] %s tentative %s : %s', contexte, tentative + 1, derniereErreur);
      continue; // retry
    }
    // 4xx non-retryable.
    throw new Error('[claude] ' + contexte + ' : HTTP ' + code + ' : ' + corps);
  }
  throw new Error('[claude] ' + contexte + ' : échec après ' + (CLAUDE_MAX_RETRIES + 1) +
    ' tentatives — ' + derniereErreur);
}

/**
 * Poll le statut du batch jusqu'à "ended" ou dépassement du budget.
 * Intervalle : 10 s (< 1 min écoulée), 20 s (< 2 min), 30 s ensuite.
 * @param {string} batchId
 * @param {string} endpointCreate Endpoint de création (base pour le GET).
 * @param {Object} enTetes
 * @param {number} deadline Timestamp (ms) limite.
 * @param {string} etiquette
 * @return {Object} Objet batch terminé (avec results_url).
 * @throws {Error} Si le budget est dépassé avant "ended".
 * @private
 */
function _attendreFinBatch_(batchId, endpointCreate, enTetes, deadline, etiquette) {
  var urlStatut = endpointCreate + '/' + batchId;
  var debut = (new Date()).getTime();
  while (true) {
    var batch = _appelerAvecRetry_(urlStatut, {
      method: 'get', headers: enTetes, muteHttpExceptions: true
    }, etiquette + ':poll');
    if (batch.processing_status === 'ended') {
      return batch;
    }
    var maintenant = (new Date()).getTime();
    if (maintenant >= deadline) {
      throw new Error('[claude] ' + etiquette + ' : batch ' + batchId +
        ' non terminé dans le budget (' + (BATCH_POLL_BUDGET_MS / 60000) + ' min) — run annulé.');
    }
    var ecoule = maintenant - debut;
    var intervalle = ecoule < 60000 ? 10000 : (ecoule < 120000 ? 20000 : 30000);
    Utilities.sleep(intervalle);
  }
}

/**
 * Récupère le JSONL des résultats depuis results_url et le parse.
 * @param {string} resultsUrl
 * @param {Object} enTetes
 * @param {string} etiquette
 * @return {Array.<Object>} Lignes de résultats parsées.
 * @throws {Error} Si le téléchargement échoue.
 * @private
 */
function _recupererResultats_(resultsUrl, enTetes, etiquette) {
  if (!_texte_(resultsUrl)) {
    throw new Error('[claude] ' + etiquette + ' : results_url absent sur le batch terminé.');
  }
  var reponse;
  try {
    reponse = UrlFetchApp.fetch(resultsUrl, { method: 'get', headers: enTetes, muteHttpExceptions: true });
  } catch (e) {
    throw new Error('[claude] ' + etiquette + ' : échec téléchargement résultats : ' + e.message);
  }
  if (reponse.getResponseCode() < 200 || reponse.getResponseCode() >= 300) {
    throw new Error('[claude] ' + etiquette + ' : HTTP ' + reponse.getResponseCode() + ' sur results_url.');
  }
  return _parserResultatsJsonl_(reponse.getContentText());
}

/* ──────────────────────────────────────────────────────────────────────────
 * Parsing (purs, testables offline).
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Parse un texte JSONL en tableau d'objets. Une ligne illisible est loggée et ignorée.
 * @param {string} texte
 * @return {Array.<Object>}
 * @private
 */
function _parserResultatsJsonl_(texte) {
  var lignes = _texte_(texte).split('\n');
  var out = [];
  for (var i = 0; i < lignes.length; i++) {
    var ligne = lignes[i].trim();
    if (ligne === '') { continue; }
    try {
      out.push(JSON.parse(ligne));
    } catch (e) {
      Logger.log('[claude][WARN] Ligne JSONL illisible ignorée : %s', e.message);
    }
  }
  return out;
}

/**
 * Indexe les lignes de résultats par custom_id (ordre non garanti, PRD M4).
 * @param {Array.<Object>} lignes
 * @return {!Object.<string, {ok: boolean, message: ?Object, erreur: ?string}>}
 * @private
 */
function _indexerResultats_(lignes) {
  var map = {};
  for (var i = 0; i < lignes.length; i++) {
    var l = lignes[i];
    if (!l || !l.custom_id || !l.result) { continue; }
    if (l.result.type === 'succeeded') {
      map[l.custom_id] = { ok: true, message: l.result.message, erreur: null };
    } else {
      var raison = l.result.type;
      if (l.result.error && l.result.error.type) {
        raison += ' : ' + l.result.error.type;
      }
      map[l.custom_id] = { ok: false, message: null, erreur: raison };
    }
  }
  return map;
}

/**
 * Extrait l'objet JSON de sortie d'un message Claude (premier bloc texte),
 * avec parse défensif (les structured outputs garantissent le format, mais on
 * ne s'y fie jamais à 100 %).
 * @param {?Object} message
 * @return {?Object} Objet parsé, ou null si illisible.
 * @private
 */
function _extraireSortie_(message) {
  if (!message || !message.content || !message.content.length) {
    return null;
  }
  for (var i = 0; i < message.content.length; i++) {
    var bloc = message.content[i];
    if (bloc && bloc.type === 'text' && _texte_(bloc.text) !== '') {
      try {
        return JSON.parse(bloc.text);
      } catch (e) {
        Logger.log('[claude][WARN] Sortie structurée non-JSON : %s', e.message);
        return null;
      }
    }
  }
  return null;
}

/* ──────────────────────────────────────────────────────────────────────────
 * Sélection, bornage, troncature, coût (privés).
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Top N par rubrique, trié par score décroissant.
 * @param {Array.<Object>} items Items scorés.
 * @param {number} n
 * @return {Array.<Object>}
 * @private
 */
function _selectionnerTopParRubrique_(items, n) {
  var parRubrique = {};
  items.forEach(function(it) {
    var r = it.rubrique || '';
    if (!parRubrique[r]) { parRubrique[r] = []; }
    parRubrique[r].push(it);
  });
  var out = [];
  for (var rub in parRubrique) {
    if (!Object.prototype.hasOwnProperty.call(parRubrique, rub)) { continue; }
    var liste = parRubrique[rub].sort(function(a, b) { return b.score - a.score; });
    out = out.concat(liste.slice(0, n));
  }
  return out;
}

/**
 * Borne un score dans [0, 10] (les structured outputs ne supportent pas
 * min/max — bornage en code).
 * @param {*} valeur
 * @return {number}
 * @private
 */
function _bornerScore_(valeur) {
  var n = parseFloat(valeur);
  if (isNaN(n)) { return 0; }
  if (n < 0) { return 0; }
  if (n > 10) { return 10; }
  return Math.round(n);
}

/**
 * Tronque un résumé à 200 caractères + « … » avec warning (PRD M4).
 * @param {string} resume
 * @param {string} titre Pour le log.
 * @return {string}
 * @private
 */
function _tronquerResume_(resume, titre) {
  if (resume.length <= RESUME_MAX_CHARS) {
    return resume;
  }
  Logger.log('[claude][WARN] Résumé > %s car tronqué pour "%s".', RESUME_MAX_CHARS, titre);
  return resume.substring(0, RESUME_MAX_CHARS) + '…';
}

/**
 * Somme les tokens input/output des résultats réussis (depuis usage).
 * @param {!Object} resultats
 * @return {{inputTokens: number, outputTokens: number}}
 * @private
 */
function _sommerUsage_(resultats) {
  var inputTokens = 0;
  var outputTokens = 0;
  for (var id in resultats) {
    if (!Object.prototype.hasOwnProperty.call(resultats, id)) { continue; }
    var r = resultats[id];
    if (r.ok && r.message && r.message.usage) {
      inputTokens += r.message.usage.input_tokens || 0;
      outputTokens += r.message.usage.output_tokens || 0;
    }
  }
  return { inputTokens: inputTokens, outputTokens: outputTokens };
}

/**
 * Calcule le coût estimé d'un usage tokens (prix _config, remise Batch −50 %).
 * @param {{inputTokens: number, outputTokens: number}} usage
 * @param {Object} config
 * @return {number} Coût estimé (devise des prix _config, défaut USD).
 */
function _calculerCout_(usage, config) {
  var pIn = config.global.prixInputParMillion;
  var pOut = config.global.prixOutputParMillion;
  return (usage.inputTokens / 1e6 * pIn + usage.outputTokens / 1e6 * pOut) * REMISE_BATCH;
}

/**
 * Additionne deux usages tokens.
 * @param {{inputTokens: number, outputTokens: number}} a
 * @param {{inputTokens: number, outputTokens: number}} b
 * @return {{inputTokens: number, outputTokens: number}}
 */
function _additionnerUsage_(a, b) {
  return {
    inputTokens: (a.inputTokens || 0) + (b.inputTokens || 0),
    outputTokens: (a.outputTokens || 0) + (b.outputTokens || 0)
  };
}

/**
 * Logge l'estimation de coût (alimente le récap admin S4).
 * @param {string} etiquette
 * @param {number} nbItems
 * @param {{inputTokens: number, outputTokens: number}} usage
 * @param {Object} config
 * @return {void}
 * @private
 */
function _loggerCout_(etiquette, nbItems, usage, config) {
  var cout = _calculerCout_(usage, config);
  Logger.log('[claude][cout] %s : %s items | tokens in=%s out=%s | coût estimé=%s (prix %s/%s par M, remise batch %s).',
    etiquette, nbItems, usage.inputTokens, usage.outputTokens, cout.toFixed(4),
    config.global.prixInputParMillion, config.global.prixOutputParMillion, REMISE_BATCH);
}
