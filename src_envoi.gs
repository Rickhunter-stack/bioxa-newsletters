/**
 * src_envoi.gs — Livraison de la newsletter (PRD S1 dry-run + M6 envoi réel).
 *
 * `livrerNewsletter(config, html, options)` est le point de livraison unique :
 * - dry-run (S1) : écrit un fichier HTML horodaté dans le dossier Drive `_drafts`
 *   (rendu fidèle, ouvrable au navigateur) ;
 * - réel (M6) : envoi Gmail — implémenté à l'incrément 5.
 *
 * Le dry-run s'active via options.dryRun OU la bascule globale config.global.dryRunGlobal.
 */

/**
 * Livre la newsletter selon le mode (dry-run ou réel).
 * @param {Object} config Config (lireConfig) — id, global.dryRunGlobal.
 * @param {string} html HTML produit par genererHTML ('' si aucun item).
 * @param {{dryRun?: boolean}} [options]
 * @return {{mode: string, url: ?string}} mode ∈ "vide" | "dry-run" | "reel-todo".
 * @throws {Error} Si l'écriture Drive échoue (dry-run).
 */
function livrerNewsletter(config, html, options) {
  options = options || {};
  var dryRun = options.dryRun || (config.global && config.global.dryRunGlobal);

  if (!_texte_(html)) {
    Logger.log('[envoi] %s : HTML vide (0 item) — rien à livrer.', config.id);
    return { mode: 'vide', url: null };
  }

  if (dryRun) {
    var url = _ecrireBrouillonDrive_(config, html);
    Logger.log('[envoi] %s : dry-run — brouillon écrit → %s', config.id, url);
    return { mode: 'dry-run', url: url };
  }

  // TODO incr. 5 : envoyerGmail(config, html, destinataires) + quotas (M6).
  Logger.log('[envoi] %s : mode réel non implémenté (incrément 5).', config.id);
  return { mode: 'reel-todo', url: null };
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
