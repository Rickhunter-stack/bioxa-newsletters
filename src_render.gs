/**
 * src_render.gs — Rendu HTML email responsive (PRD M5 + M7).
 *
 * `genererHTML(config, items)` produit un email HTML mutualisé : masthead avec la
 * marque plateforme (NOM_ORGANISATION) + filet d'accent, bloc « Au sommaire »
 * cliquable (si ≥ 2 rubriques), 1 section par rubrique (en-tête coloré, couleur
 * par rubrique via PALETTE_RUBRIQUES), items en cartes avec filet latéral, pied de
 * marque foncé + version du prompt (M7).
 *
 * Titre affiché = traduction FR de Claude quand le titre original n'est pas déjà
 * français ; sinon le titre original. Le titre original est toujours conservé et
 * exposé en info-bulle (title=) du lien (traçabilité). Le lien pointe toujours
 * vers la source originale.
 *
 * Email-safe : tables + CSS inline (compat Outlook/Gmail), pas de photo par article
 * (flux RSS non fiables en images), conteneur interne max-width 680px centré (plus
 * large sur ordinateur, sous le plafond email-safe ~700px) + media query pleine
 * largeur en mobile.
 *
 * Fonction PURE (string → string), sans effet de bord ni accès réseau/Sheet —
 * testable offline. L'écriture du brouillon (dry-run) vit dans src_envoi.gs.
 *
 * Sécurité : tout contenu issu des flux est échappé en HTML. L'échappement est
 * une transformation TECHNIQUE (encodage de `& < > " '`), pas une reformulation.
 */

/** Palette de couleurs d'accent par rubrique (cyclique, ordre d'apparition). @const */
var PALETTE_RUBRIQUES = ['#1a3e5c', '#c0392b', '#8e44ad', '#1f8a5b', '#b9770e', '#2c7fb8'];

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
  var sommaire = (groupes.length >= 2) ? _rendreSommaire_(groupes) : '';
  var sections = groupes.map(function(g, idx) {
    return _rendreRubrique_(g.rubrique, g.items, _couleurRubrique_(idx), idx);
  }).join('');

  return '<!DOCTYPE html>\n' +
    '<html lang="fr"><head>\n' +
    '<meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
    '<style>\n' +
    '@media only screen and (max-width:680px){ .bx-conteneur{width:100% !important;} }\n' +
    '</style>\n' +
    '</head>\n' +
    '<body style="margin:0;padding:0;background:#eef1f4;">\n' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eef1f4;">\n' +
    '<tr><td align="center" style="padding:20px;">\n' +
    '<table role="presentation" class="bx-conteneur" width="680" cellpadding="0" cellspacing="0" border="0" ' +
    'style="max-width:680px;margin:0 auto;background:#ffffff;font-family:\'Segoe UI\',Arial,Helvetica,sans-serif;' +
    'box-shadow:0 1px 4px rgba(0,0,0,0.08);">\n' +
    _rendreEntete_(nom, sousTitre, dateEnvoi, couleur) +
    sommaire +
    sections +
    _rendrePied_(version) +
    '</table>\n</td></tr>\n</table>\n</body></html>';
}

/**
 * Couleur d'accent d'une rubrique selon son rang d'apparition (cyclique).
 * @param {number} idx
 * @return {string}
 * @private
 */
function _couleurRubrique_(idx) {
  return PALETTE_RUBRIQUES[idx % PALETTE_RUBRIQUES.length];
}

/* ──────────────────────────────────────────────────────────────────────────
 * Blocs de rendu (privés).
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Masthead : marque plateforme (eyebrow) + nom, filet d'accent, sous-titre, date ;
 * fond = couleur de la newsletter.
 * @private
 */
function _rendreEntete_(nom, sousTitre, dateEnvoi, couleur) {
  var ligneSous = sousTitre ? (sousTitre + ' — ') : '';
  var marque = _echapperHtml_(_texte_(NOM_ORGANISATION));
  var eyebrow = marque
    ? '<div style="font-size:11px;letter-spacing:3px;text-transform:uppercase;color:rgba(255,255,255,0.65);margin:0 0 10px;">' +
      marque + '</div>\n'
    : '';
  return '<tr><td style="background:' + couleur + ';padding:28px 32px 24px;">\n' +
    eyebrow +
    '<h1 style="margin:0;font-size:27px;line-height:1.2;color:#ffffff;font-weight:700;">' + nom + '</h1>\n' +
    '<div style="height:3px;width:48px;background:rgba(255,255,255,0.5);margin:12px 0;"></div>\n' +
    '<p style="margin:0;font-size:13px;color:rgba(255,255,255,0.8);">' + ligneSous + dateEnvoi + '</p>\n' +
    '</td></tr>\n';
}

/**
 * Bloc « Au sommaire » : rubriques + nombre d'items, liens d'ancre vers chaque
 * section. Rendu seulement si ≥ 2 rubriques (décision dans genererHTML).
 * @param {Array.<{rubrique: string, items: Array}>} groupes
 * @private
 */
function _rendreSommaire_(groupes) {
  var liens = groupes.map(function(g, idx) {
    // Piste 1 : puce de couleur par rubrique (● coloré = fiable en email, Outlook OK).
    var puce = '<span style="color:' + _couleurRubrique_(idx) + ';">●</span> ';
    return '<a href="#bx-r' + idx + '" style="display:inline-block;font-size:13px;color:#1a3e5c;' +
      'text-decoration:none;margin:0 16px 6px 0;">' + puce + _echapperHtml_(g.rubrique) +
      ' <span style="color:#8a96a3;">· ' + g.items.length + '</span></a>';
  }).join('\n');
  return '<tr><td style="padding:20px 32px 6px;">\n' +
    '<div style="background:#f5f7f9;border:1px solid #e5e9ee;border-radius:8px;padding:14px 18px;">\n' +
    '<div style="font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:#8a96a3;margin:0 0 8px;">Au sommaire</div>\n' +
    liens + '\n</div>\n</td></tr>\n';
}

/**
 * Section d'une rubrique : en-tête coloré (barre + titre) ancré + items en cartes.
 * @param {string} rubrique
 * @param {Array.<Object>} items
 * @param {string} couleur Couleur d'accent de la rubrique.
 * @param {number} idx Rang (pour l'ancre du sommaire).
 * @private
 */
function _rendreRubrique_(rubrique, items, couleur, idx) {
  var entete = '<tr><td id="bx-r' + idx + '" style="padding:22px 32px 2px;">\n' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>\n' +
    '<td style="width:4px;background:' + couleur + ';border-radius:2px;">&nbsp;</td>\n' +
    '<td style="padding-left:12px;"><h2 style="margin:0;font-size:16px;color:' + couleur +
    ';font-weight:700;text-transform:uppercase;letter-spacing:.6px;">' + _echapperHtml_(rubrique) + '</h2></td>\n' +
    '</tr></table>\n</td></tr>\n';
  var corps = items.map(function(it) { return _rendreItem_(it, couleur); }).join('');
  return entete + corps;
}

/**
 * Item : carte avec filet latéral (couleur rubrique), titre lié à la source
 * originale, méta (source · date), résumé.
 * @private
 */
function _rendreItem_(item, couleur) {
  var url = _echapperHtml_(_texte_(item.url));
  var titreOriginal = _texte_(item.titre);
  var source = _echapperHtml_(_texte_(item.source));
  var date = item.datePublication ? _formaterDateFr_(item.datePublication) : '';
  var resume = _echapperHtml_(_texte_(item.resumeFr));
  var meta = date ? (source + ' · ' + date) : source;

  // Titre AFFICHÉ = traduction FR de Claude quand le titre original n'est pas déjà
  // français (double garde : null côté Claude + heuristique _estFrancais_) ; sinon
  // le titre original. Le titre original n'est jamais perdu : il est exposé en
  // info-bulle (title=) du lien pour la traçabilité. Le lien pointe toujours vers
  // la source originale.
  var traduction = _texte_(item.titreTraduction);
  var titreAffiche, infoBulle;
  if (traduction !== '' && !_estFrancais_(titreOriginal)) {
    titreAffiche = _echapperHtml_(traduction);
    infoBulle = ' title="' + _echapperHtml_(titreOriginal) + '"';
  } else {
    titreAffiche = _echapperHtml_(titreOriginal);
    infoBulle = '';
  }

  return '<tr><td style="padding:7px 32px;">\n' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ' +
    'style="border:1px solid #e9edf1;border-left:3px solid ' + couleur + ';border-radius:6px;">\n' +
    '<tr><td style="padding:16px 18px;">\n' +
    '<a href="' + url + '"' + infoBulle + ' style="font-size:16px;font-weight:700;color:#14324a;' +
    'text-decoration:none;line-height:1.35;">' + titreAffiche + '</a>\n' +
    // Piste 2 : méta en capitales espacées, plus discrète.
    '<div style="font-size:11px;color:#8a96a3;text-transform:uppercase;letter-spacing:.4px;margin:6px 0 7px;">' +
    meta + '</div>\n' +
    '<div style="font-size:14px;color:#3a4653;line-height:1.55;">' + resume + '</div>\n' +
    // Piste 4 : affordance « Lire l'article → » (couleur rubrique).
    '<div style="margin-top:9px;"><a href="' + url + '"' + infoBulle + ' style="font-size:12px;' +
    'font-weight:700;color:' + couleur + ';text-decoration:none;">Lire l\'article →</a></div>\n' +
    '</td></tr>\n</table>\n</td></tr>\n';
}

/**
 * Pied foncé : marque plateforme + version du prompt (M7) + mention désinscription
 * (v1 : répondre au mail).
 * @private
 */
function _rendrePied_(version) {
  var marque = _echapperHtml_(_texte_(NOM_ORGANISATION));
  var ligneMarque = marque
    ? '<div style="font-size:13px;color:#ffffff;font-weight:700;">' + marque + '</div>\n'
    : '';
  return '<tr><td style="background:#14324a;padding:22px 32px;">\n' +
    ligneMarque +
    '<div style="font-size:11px;color:rgba(255,255,255,0.6);line-height:1.6;margin-top:4px;">\n' +
    'Veille automatisée — newsletter générée automatiquement · modèle de tri : ' + version + '<br>\n' +
    'Désinscription : répondre à ce mail.\n' +
    '</div>\n</td></tr>\n';
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
