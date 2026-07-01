/**
 * src_render.gs — Rendu HTML email responsive (PRD M5 + M7).
 *
 * `genererHTML(config, items)` produit un email HTML mutualisé : en-tête
 * configurable par newsletter (nom, couleur, sous-titre), 1 section par rubrique,
 * lien vers la source originale par item, pied avec la version du prompt (M7).
 *
 * Email-safe : tables + CSS inline (compat Outlook/Gmail) ; conteneur interne
 * max-width 600px centré + 1 media query pour empiler proprement en mobile.
 *
 * Fonction PURE (string → string), sans effet de bord ni accès réseau/Sheet —
 * testable offline. L'écriture du brouillon (dry-run) vit dans src_envoi.gs.
 *
 * Sécurité : tout contenu issu des flux est échappé en HTML. L'échappement est
 * une transformation TECHNIQUE (encodage de `& < > " '`), pas une reformulation —
 * compatible avec la règle métier « titre verbatim » (la sémantique est identique).
 */

/**
 * Génère le HTML complet de la newsletter.
 * @param {Object} config Config (lireConfig) — nom, couleur, sousTitre, promptVersion, sources.
 * @param {Array.<Object>} items Items sélectionnés (titre, url, source, rubrique,
 *   datePublication, resumeFr).
 * @return {string} HTML email, ou '' si aucun item (marqueur pour livrerNewsletter).
 */
function genererHTML(config, items) {
  if (!items || !items.length) {
    return ''; // 0 item → string vide : livrerNewsletter saura ne rien écrire.
  }

  var couleur = _texte_(config.couleur) || '#1a3e5c';
  var nom = _echapperHtml_(_texte_(config.nom) || _texte_(config.id));
  var sousTitre = _echapperHtml_(_texte_(config.sousTitre));
  var dateEnvoi = _formaterDateFr_(new Date());
  var version = _echapperHtml_(_texte_(config.promptVersion) || 'non versionné');

  var groupes = _grouperParRubrique_(items, config.sources);
  var sections = groupes.map(function(g) {
    return _rendreRubrique_(g.rubrique, g.items, couleur);
  }).join('');

  return '<!DOCTYPE html>\n' +
    '<html lang="fr"><head>\n' +
    '<meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
    '<style>\n' +
    '@media only screen and (max-width:600px){\n' +
    '  .bx-conteneur{width:100% !important;}\n' +
    '  .bx-col{display:block !important;width:100% !important;text-align:left !important;}\n' +
    '}\n' +
    '</style>\n' +
    '</head>\n' +
    '<body style="margin:0;padding:0;background:#f4f4f4;">\n' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f4f4;">\n' +
    '<tr><td align="center" style="padding:16px;">\n' +
    '<table role="presentation" class="bx-conteneur" width="600" cellpadding="0" cellspacing="0" border="0" ' +
    'style="max-width:600px;margin:0 auto;background:#ffffff;font-family:Arial,Helvetica,sans-serif;">\n' +
    _rendreEntete_(nom, sousTitre, dateEnvoi, couleur) +
    sections +
    _rendrePied_(version) +
    '</table>\n</td></tr>\n</table>\n</body></html>';
}

/* ──────────────────────────────────────────────────────────────────────────
 * Blocs de rendu (privés).
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * En-tête : nom, sous-titre, date ; fond = couleur de la newsletter.
 * @private
 */
function _rendreEntete_(nom, sousTitre, dateEnvoi, couleur) {
  var ligneSous = sousTitre ? (sousTitre + ' — ') : '';
  return '<tr><td style="background:' + couleur + ';color:#ffffff;padding:24px 20px;">\n' +
    '<h1 style="margin:0;font-size:22px;line-height:1.2;">' + nom + '</h1>\n' +
    '<p style="margin:6px 0 0;font-size:13px;color:#eaeaea;">' + ligneSous + dateEnvoi + '</p>\n' +
    '</td></tr>\n';
}

/**
 * Section d'une rubrique : titre + items.
 * @private
 */
function _rendreRubrique_(rubrique, items, couleur) {
  var entete = '<tr><td style="padding:18px 20px 4px;">\n' +
    '<h2 style="margin:0;font-size:18px;color:' + couleur + ';border-bottom:2px solid #eeeeee;padding-bottom:6px;">' +
    _echapperHtml_(rubrique) + '</h2>\n</td></tr>\n';
  var corps = items.map(function(it) { return _rendreItem_(it, couleur); }).join('');
  return entete + corps;
}

/**
 * Item : titre lié à la source originale, méta (source · date) en 2 colonnes
 * empilables, résumé.
 * @private
 */
function _rendreItem_(item, couleur) {
  var url = _echapperHtml_(_texte_(item.url));
  var titre = _echapperHtml_(_texte_(item.titre));
  var source = _echapperHtml_(_texte_(item.source));
  var date = item.datePublication ? _formaterDateFr_(item.datePublication) : '';
  var resume = _echapperHtml_(_texte_(item.resumeFr));

  // Traduction FR additionnelle : affichée en sous-titre gris SOUS le titre, et
  // SEULEMENT si une traduction existe ET que le titre original n'est pas déjà FR
  // (double garde : null côté Claude + heuristique côté code). Titre original
  // toujours conservé verbatim.
  var traduction = '';
  if (_texte_(item.titreTraduction) !== '' && !_estFrancais_(item.titre)) {
    traduction = '<div style="font-size:13px;color:#888888;font-style:italic;margin-top:2px;">' +
      _echapperHtml_(_texte_(item.titreTraduction)) + '</div>\n';
  }

  return '<tr><td style="padding:14px 20px;border-bottom:1px solid #eeeeee;">\n' +
    '<a href="' + url + '" style="font-size:16px;font-weight:bold;color:' + couleur +
    ';text-decoration:none;">' + titre + '</a>\n' +
    traduction +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0;">\n' +
    '<tr>\n' +
    '<td class="bx-col" align="left" style="font-size:12px;color:#888888;">' + source + '</td>\n' +
    '<td class="bx-col" align="right" style="font-size:12px;color:#888888;">' + date + '</td>\n' +
    '</tr>\n</table>\n' +
    '<div style="font-size:14px;color:#333333;line-height:1.45;">' + resume + '</div>\n' +
    '</td></tr>\n';
}

/**
 * Pied : version du prompt (M7) + mention désinscription (v1 : répondre au mail).
 * @private
 */
function _rendrePied_(version) {
  return '<tr><td style="background:#eeeeee;padding:14px 20px;font-size:11px;color:#555555;line-height:1.4;">\n' +
    'Newsletter générée automatiquement — modèle de tri : ' + version + '<br>\n' +
    'Désinscription : répondre à ce mail.\n' +
    '</td></tr>\n';
}

/* ──────────────────────────────────────────────────────────────────────────
 * Regroupement, échappement, date (privés).
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Regroupe les items par rubrique. ORDRE = ordre de PREMIÈRE apparition d'une
 * rubrique dans la colonne Rubrique du tableau Sources (config.sources). Une
 * rubrique qui réapparaît plus bas dans les sources GARDE sa position d'origine.
 * Les rubriques d'items absentes des sources (cas anormal) sont ajoutées à la fin
 * dans leur ordre de rencontre.
 * @param {Array.<Object>} items
 * @param {Array.<Object>} sources config.sources (peut être vide/undefined).
 * @return {Array.<{rubrique: string, items: Array.<Object>}>}
 * @private
 */
function _grouperParRubrique_(items, sources) {
  var ordre = [];
  var vues = {};
  (sources || []).forEach(function(s) {
    var r = _texte_(s.rubrique);
    if (r !== '' && !vues[r]) { vues[r] = true; ordre.push(r); }
  });

  var groupes = {};
  items.forEach(function(it) {
    var r = _texte_(it.rubrique);
    if (!groupes[r]) {
      groupes[r] = [];
      if (!vues[r]) { vues[r] = true; ordre.push(r); } // rubrique hors sources → fin
    }
    groupes[r].push(it);
  });

  var sortie = [];
  ordre.forEach(function(r) {
    if (groupes[r] && groupes[r].length) {
      sortie.push({ rubrique: r, items: groupes[r] });
    }
  });
  return sortie;
}

/**
 * Échappe les caractères HTML sensibles (transformation technique, pas une
 * reformulation). `&` traité en premier.
 * @param {string} s
 * @return {string}
 * @private
 */
function _echapperHtml_(s) {
  return _texte_(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Formate une date en jj/mm/aaaa (Europe/Paris).
 * @param {Date} date
 * @return {string}
 * @private
 */
function _formaterDateFr_(date) {
  return Utilities.formatDate(date, FUSEAU_PLATEFORME, 'dd/MM/yyyy');
}

/**
 * Détection langue RUDIMENTAIRE : un texte est considéré français s'il contient
 * un accent français OU ≥ 2 mots français fréquents. Sert de garde pour ne pas
 * afficher de traduction sur un titre déjà francophone.
 * @param {string} texte
 * @return {boolean}
 * @private
 */
function _estFrancais_(texte) {
  var t = _texte_(texte);
  if (t === '') {
    return false;
  }
  if (/[éèêëàâäçôöîïùûü]/i.test(t)) {
    return true;
  }
  var mots = t.toLowerCase().split(/[^a-zàâäéèêëîïôöùûüç]+/);
  var n = 0;
  for (var i = 0; i < mots.length; i++) {
    if (MOTS_FR_FREQUENTS[mots[i]]) {
      n++;
    }
  }
  return n >= 2;
}

/** Mots français fréquents (heuristique de détection de langue). @const */
var MOTS_FR_FREQUENTS = {
  le: 1, la: 1, les: 1, des: 1, du: 1, un: 1, une: 1, et: 1, pour: 1, avec: 1,
  dans: 1, sur: 1, par: 1, que: 1, qui: 1, ne: 1, pas: 1, au: 1, aux: 1, ce: 1,
  cette: 1, est: 1, sont: 1, plus: 1, son: 1, ses: 1, leur: 1
};
