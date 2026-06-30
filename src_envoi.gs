/**
 * src_envoi.gs — Livraison de la newsletter (PRD S1 dry-run + M6 envoi réel).
 *
 * `livrerNewsletter(config, html, options)` est le point de livraison unique :
 * - dry-run (S1) : écrit un fichier HTML horodaté dans le dossier Drive `_drafts`
 *   (rendu fidèle, ouvrable au navigateur) ;
 * - réel (M6) : `envoyerGmail`, 1 envoi par destinataire actif, try/catch par
 *   destinataire, respect du quota Gmail journalier.
 *
 * Le dry-run s'active via options.dryRun OU la bascule globale config.global.dryRunGlobal.
 */

/**
 * Livre la newsletter selon le mode (dry-run ou réel).
 * @param {Object} config Config (lireConfig).
 * @param {string} html HTML produit par genererHTML ('' si aucun item).
 * @param {{dryRun?: boolean}} [options]
 * @return {{mode: string, url: ?string, envoyes: number,
 *           echecs: Array.<{email: string, raison: string}>, quotaAtteint: boolean}}
 *   mode ∈ "vide" | "dry-run" | "reel" | "partiel".
 * @throws {Error} Si l'écriture Drive échoue (dry-run).
 */
function livrerNewsletter(config, html, options) {
  options = options || {};
  var dryRun = options.dryRun || (config.global && config.global.dryRunGlobal);

  if (!_texte_(html)) {
    Logger.log('[envoi] %s : HTML vide (0 item) — rien à livrer.', config.id);
    return { mode: 'vide', url: null, envoyes: 0, echecs: [], quotaAtteint: false };
  }

  if (dryRun) {
    var url = _ecrireBrouillonDrive_(config, html);
    Logger.log('[envoi] %s : dry-run — brouillon écrit → %s', config.id, url);
    return { mode: 'dry-run', url: url, envoyes: 0, echecs: [], quotaAtteint: false };
  }

  var sujet = _genererSujet_(config);
  var res = envoyerGmail(config, html, sujet);
  var mode = (res.quotaAtteint || res.echecs.length) ? 'partiel' : 'reel';
  Logger.log('[envoi] %s : %s — %s envoyé(s), %s échec(s)%s.',
    config.id, mode, res.envoyes, res.echecs.length, res.quotaAtteint ? ', quota atteint' : '');
  return {
    mode: mode, url: null, envoyes: res.envoyes,
    echecs: res.echecs, quotaAtteint: res.quotaAtteint
  };
}

/**
 * Envoie le HTML à chaque destinataire actif (M6). 1 envoi par destinataire (pas
 * de BCC, pour journaliser par destinataire), try/catch par destinataire (un échec
 * n'arrête pas les autres). Arrêt si le quota Gmail est atteint.
 *
 * @param {Object} config Config (lireConfig) — destinataires, global.gmailQuotaJour.
 * @param {string} html
 * @param {string} sujet
 * @return {{envoyes: number, echecs: Array.<{email: string, raison: string}>,
 *           quotaAtteint: boolean}}
 */
function envoyerGmail(config, html, sujet) {
  var destinataires = _destinatairesActifs_(config);
  var corpsTexte = _htmlVersTexte_(html);
  var capConfig = (config.global && config.global.gmailQuotaJour) || GMAIL_QUOTA_DEFAUT;

  var envoyes = 0;
  var echecs = [];
  var quotaAtteint = false;

  for (var i = 0; i < destinataires.length; i++) {
    // Garde-fou quota : min(quota réel API, plafond configuré).
    if (envoyes >= capConfig || GmailApp.getRemainingDailyQuota() <= 0) {
      quotaAtteint = true;
      Logger.log('[envoi][WARN] %s : quota atteint (envoyés=%s, cap=%s) — %s destinataire(s) non servi(s).',
        config.id, envoyes, capConfig, destinataires.length - i);
      break;
    }
    var d = destinataires[i];
    try {
      GmailApp.sendEmail(d.email, sujet, corpsTexte, { htmlBody: html, name: NOM_EXPEDITEUR });
      envoyes++;
    } catch (e) {
      echecs.push({ email: d.email, raison: e.message });
      Logger.log('[envoi][WARN] %s : échec envoi à %s : %s', config.id, d.email, e.message);
    }
  }
  return { envoyes: envoyes, echecs: echecs, quotaAtteint: quotaAtteint };
}

/* ──────────────────────────────────────────────────────────────────────────
 * Sujet, destinataires, version texte (privés).
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Sujet de l'email : « {nom} — {jj/mm/aaaa} » (généré en code, non paramétrable v1).
 * @param {Object} config
 * @return {string}
 * @private
 */
function _genererSujet_(config) {
  var nom = _texte_(config.nom) || _texte_(config.id);
  var date = Utilities.formatDate(new Date(), 'Europe/Paris', 'dd/MM/yyyy');
  return nom + ' — ' + date;
}

/**
 * Destinataires actifs et à email non vide.
 * @param {Object} config
 * @return {Array.<{active: boolean, email: string, nom: string}>}
 * @private
 */
function _destinatairesActifs_(config) {
  return ((config && config.destinataires) || []).filter(function(d) {
    return d.active && _texte_(d.email) !== '';
  });
}

/**
 * Version texte brute du HTML (corps de repli pour GmailApp.sendEmail).
 * @param {string} html
 * @return {string}
 * @private
 */
function _htmlVersTexte_(html) {
  return _texte_(html)
    .replace(/<\s*(br|\/p|\/h1|\/h2|\/tr|\/div)\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/* ──────────────────────────────────────────────────────────────────────────
 * Dry-run : écriture Drive (privés).
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Écrit le HTML dans un fichier horodaté du dossier `_drafts`.
 * @param {Object} config
 * @param {string} html
 * @return {string} URL du fichier créé.
 * @throws {Error} Si Drive échoue (quota, permission).
 * @private
 */
function _ecrireBrouillonDrive_(config, html) {
  try {
    var dossier = _obtenirDossierDrafts_();
    var horodatage = Utilities.formatDate(new Date(), 'Europe/Paris', 'yyyy-MM-dd_HH-mm');
    var nom = 'dryrun-' + config.id + '-' + horodatage + '.html';
    var fichier = dossier.createFile(nom, html, MimeType.HTML);
    return fichier.getUrl();
  } catch (e) {
    throw new Error('[envoi] Écriture brouillon Drive impossible : ' + e.message);
  }
}

/**
 * Récupère le dossier Drive `_drafts`, le crée s'il n'existe pas.
 * @return {GoogleAppsScript.Drive.Folder}
 * @private
 */
function _obtenirDossierDrafts_() {
  var iter = DriveApp.getFoldersByName(NOM_DOSSIER_DRAFTS);
  if (iter.hasNext()) {
    return iter.next();
  }
  return DriveApp.createFolder(NOM_DOSSIER_DRAFTS);
}
