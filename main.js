// 1. Importations
import logger from './src/logger.js';
import { initializeBrowserSession, closeBrowserSession, closeAllBrowserSessions, getActiveSessionIds } from './src/browser_manager.js';
import { login } from './src/auth_handler.js';
import { solveSingleExercise } from './src/solver_engine.js';
import { solvePopup } from './src/popup_solver.js';
import { config, loadAccountsFromJSON } from './src/config_loader.js'; // Importe la config et loadAccountsFromJSON
import { startServer } from './src/server.js'; // Importe la fonction de démarrage du serveur
import fs from 'fs/promises'; // Pour lire le fichier des comptes actifs
import path from 'path'; // Pour gérer les chemins
import selectors from './src/selectors.js'; // Correction : centralisation des sélecteurs popup
// import { spawn } from 'child_process'; // Désactivé car non utilisé pour le redémarrage

// Si Node < 18, décommenter la ligne suivante et installer node-fetch
// import fetch from 'node-fetch';
// --- Initialisation universelle de fetch pour Node.js ---
let fetchRef = globalThis.fetch;
if (!fetchRef) {
    // Node < 18 : import dynamique de node-fetch
    import('node-fetch').then(mod => {
        fetchRef = mod.default;
        globalThis.fetch = fetchRef;
    }).catch(err => {
        console.error('Impossible de charger node-fetch. Installez-le avec "npm install node-fetch".', err);
        process.exit(1);
    });
} else {
    globalThis.fetch = fetchRef;
}

// --- État Global ---
/** Stocke les IDs des sessions dont le minuteur a expiré */
const expiredAccounts = new Set();
// Fonction utilitaire pour "dé-expirer" un compte si sa sessionEnd a été prolongée
function resetExpiredAccountIfNeeded(account) {
    if (expiredAccounts.has(account.id) && account.sessionEnd && account.sessionEnd > Date.now()) {
        expiredAccounts.delete(account.id);
        logger.info(`[${account.id}] Le compte a été réactivé (sessionEnd prolongé).`);
    }
}

// --- Fonctions utilitaires internes ---

/**
 * Convertit une chaîne de durée (ex: "2.5h") en millisecondes.
 * @param {string | undefined} durationString La chaîne de durée.
 * @returns {number | null} La durée en millisecondes, ou null si invalide.
 */
function parseDurationToMs(durationString) {
    if (!durationString || typeof durationString !== 'string') {
        return null;
    }
    const match = durationString.trim().match(/^(\d+(\.\d+)?)\s*h$/i); // Accepte Nombreh ou Nombre.Decimaleh
    if (match && match[1]) {
        const hours = parseFloat(match[1]);
        if (Number.isFinite(hours) && hours > 0) {
            return hours * 60 * 60 * 1000; // Convertit les heures en millisecondes
        }
    }
    logger.warn(`Format de durée invalide : "${durationString}". Attendu : "Nombreh" (ex: "1.5h").`);
    return null;
}


/**
 * Vérifie la présence du popup d'entraînement intensif et le résout si présent.
 * @param {import('playwright').Page} page
 * @param {string} popupSelector
 * @param {number} timeout
 * @param {string} sessionId Pour le logging
 */
async function checkAndSolvePopup(page, popupSelector, timeout, sessionId) {
    try {
        const isPopupVisible = await page.locator(popupSelector).isVisible({ timeout });
        if (isPopupVisible) {
            logger.info(`[${sessionId}] Popup d'entraînement intensif détecté. Lancement de solvePopup...`);
            await solvePopup(page); // solvePopup pourrait aussi avoir besoin du sessionId pour log
            logger.info(`[${sessionId}] solvePopup terminé.`);
            return true;
        }
    } catch (error) {
        // Ne log que si ce n'est pas une erreur de timeout standard
        if (!error.message.includes('Timeout') && !error.message.includes('waiting for selector')) {
             logger.warn(`[${sessionId}] Erreur inattendue lors de la vérification du popup (${popupSelector}): ${error.message}`);
        } else {
             logger.debug(`[${sessionId}] Popup non détecté ou timeout (${popupSelector}).`);
        }
    }
    return false;
}

/**
 * Sélectionne et clique sur le prochain exercice disponible.
 * @param {import('playwright').Page} page
 * @param {string} sessionId Pour le logging
 * @returns {Promise<boolean>} true si un exercice a été cliqué, false sinon
 */
async function selectNextExercise(page, sessionId) {
    const nextExerciseCellSelector = `
        .validation-activity-cell.readyToRun,
        .activity-selector-cell.readyToRun,
        .activity-selector-cell.unit.orange,
        .activity-selector-cell.inProgress, /* Selector for in-progress standard exercises */
        .validation-activity-cell.inProgress /* Selector for in-progress validation exercises */
    `;
    const launchButtonSelector = 'button.activity-selector-cell-launch-button, button.validation-activity-cell-launch-button';

    logger.debug(`[${sessionId}] Recherche du prochain exercice à lancer (Selector: ${nextExerciseCellSelector.replace(/\s+/g, ' ').trim()})...`);

    try {
        // Find the first VISIBLE element matching the selector
        logger.debug(`[${sessionId}] Recherche de la première cellule cible VISIBLE...`);
        const targetCell = page.locator(nextExerciseCellSelector).filter({ has: page.locator(':visible') }).first();

        // Wait for the located visible element (optional, but good practice for stability)
        logger.debug(`[${sessionId}] Attente de la cellule visible localisée...`);
        await targetCell.waitFor({ state: 'visible', timeout: 15000 }); // Keep a timeout

        const cellHTML = await targetCell.innerHTML().catch(() => 'N/A'); // Get HTML for logging
        logger.debug(`[${sessionId}] Cellule d'exercice visible trouvée. HTML (extrait): ${cellHTML.substring(0, 100)}...`);

        const launchButton = targetCell.locator(launchButtonSelector);
        // Reduced timeout for button check as the cell is already confirmed visible
        const isButtonVisible = await launchButton.isVisible({ timeout: 2000 });
        logger.debug(`[${sessionId}] Vérification du bouton 'Lancer' (Selector: ${launchButtonSelector}). Visible: ${isButtonVisible}`);

        if (isButtonVisible) {
            logger.debug(`[${sessionId}] Bouton "Lancer" trouvé et visible. Clic sur le bouton...`);
            await launchButton.click({ timeout: 5000 });
        } else {
            // If the button isn't there or visible quickly, click the cell itself
            logger.debug(`[${sessionId}] Bouton "Lancer" non visible rapidement. Clic sur la cellule principale...`);
            await targetCell.click({ timeout: 5000 });
        }
        logger.debug(`[${sessionId}] Clic effectué sur l'exercice/bouton.`);
        return true;
    } catch (error) {
        // ... existing error handling ...
        if (error.name === 'TimeoutError') {
            // Log specific timeout details
            if (error.message.includes('waitFor') || error.message.includes('filter')) { // Updated check
                 logger.debug(`[${sessionId}] Timeout: Aucun exercice VISIBLE correspondant aux sélecteurs n'a été trouvé dans les délais.`);
            } else if (error.message.includes('click')) {
                 logger.warn(`[${sessionId}] Timeout lors du clic sur l'élément trouvé. L'élément est peut-être devenu non interactif.`);
            } else {
                 logger.warn(`[${sessionId}] TimeoutError lors de la sélection/clic sur l'exercice: ${error.message}`);
            }
        } else {
            logger.error(`[${sessionId}] Erreur inattendue lors de la sélection/clic sur l'exercice: ${error.message}`, error.stack);
        }
        // ... existing screenshot logic ...
        return false;
    }
}

// --- Logique spécifique à une session ---
/**
 * Gère le cycle de vie d'une session pour un compte donné.
 * @param {{id: string, email: string, password: string}} account
 */
async function runAccountSession(account) {
    const sessionId = account.id;
    let sessionData = null;
    let sessionTimerId = null; // Pour stocker l'ID du timer
    let sessionTimeIntervalId = null; // Pour l'intervalle d'envoi du temps restant
    logger.info(`[${sessionId}] Démarrage de la session pour ${account.email}...`);

    // --- Gestion du Minuteur de Session ---
    const durationMs = parseDurationToMs(account.sessionDuration);
    if (durationMs !== null) {
        logger.debug(`[${sessionId}] Minuteur de session configuré pour ${account.sessionDuration} (${durationMs}ms).`);
        sessionTimerId = setTimeout(async () => {
            logger.debug(`[${sessionId}] Fonction de rappel du minuteur déclenchée.`);
            // Vérifier si le compte n'est pas déjà marqué comme expiré (évite double exécution)
            if (expiredAccounts.has(sessionId)) {
                logger.debug(`[${sessionId}] Minuteur déclenché, mais session déjà marquée comme expirée.`);
                return;
            }

            logger.warn(`[${sessionId}] Le temps de session (${account.sessionDuration}) a expiré. Fermeture de la session.`);
            expiredAccounts.add(sessionId); // Marquer comme expiré

            // Tenter de fermer la session associée
            // Il est possible que la session soit déjà en cours de fermeture ou fermée par une autre logique
            try {
                await closeBrowserSession(sessionId);
                logger.info(`[${sessionId}] Session fermée avec succès suite à l'expiration du minuteur.`);
            } catch (closeError) {
                // Log l'erreur mais ne pas la propager, car l'important est que le compte soit marqué expiré
                logger.error(`[${sessionId}] Erreur lors de la fermeture de la session après expiration du minuteur: ${closeError.message}`);
            }
        }, durationMs);
    } else if (account.sessionDuration) {
        // Si une durée était fournie mais invalide
        logger.warn(`[${sessionId}] Durée de session fournie ("${account.sessionDuration}") invalide. Aucun minuteur démarré.`);
    } else {
        logger.debug(`[${sessionId}] Aucune durée de session configurée. Session illimitée.`);
    }
    // -------------------------------------

    // --- Envoi régulier du temps restant au serveur web ---
    if (durationMs !== null) {
        const sessionStart = Date.now();
        // Fonction pour attendre que fetch soit bien disponible
        async function waitForFetchAndStartInterval() {
            let maxTries = 20;
            while (typeof globalThis.fetch !== 'function' && maxTries-- > 0) {
                await new Promise(res => setTimeout(res, 100));
            }
            if (typeof globalThis.fetch !== 'function') {
                logger.error(`[${sessionId}] fetch n'est pas disponible après attente. Impossible d'envoyer le temps de session.`);
                return;
            }
            sessionTimeIntervalId = setInterval(async () => {
                const now = Date.now();
                const elapsed = now - sessionStart;
                const timeLeftMs = Math.max(durationMs - elapsed, 0);
                try {
                    await fetchRef(`http://localhost:3000/session-update/${encodeURIComponent(sessionId)}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ timeLeftMs })
                    });
                } catch (err) {
                    logger.warn(`[${sessionId}] Erreur lors de l'envoi du temps de session restant : ${err.message}`);
                }
                if (timeLeftMs <= 0) {
                    clearInterval(sessionTimeIntervalId);
                }
            }, 1000);
        }
        waitForFetchAndStartInterval();
    }
    // ------------------------------------------------------

    try {
        logger.debug(`[${sessionId}] Initialisation du navigateur...`);
        // Utilise les options de config pour headless, etc.
        sessionData = await initializeBrowserSession(sessionId, { headless: false }); // TODO: Rendre headless configurable
        const { page } = sessionData;
        logger.debug(`[${sessionId}] Navigateur initialisé.`);

        logger.debug(`[${sessionId}] Tentative de connexion...`);
        logger.debug(`[${sessionId}] Appel de login avec email: ${account.email}`);
        const loginResult = await login(page, account.email, account.password);
        logger.debug(`[${sessionId}] Retour de login: ${JSON.stringify(loginResult)}`);

        if (!loginResult.success) {
            logger.error(`[${sessionId}] Échec de la connexion: ${loginResult.error || 'Raison inconnue'}`);
            throw new Error('Échec de la connexion'); // Arrête cette session
        }
        logger.debug(`[${sessionId}] Connexion réussie.`);
        logger.debug(`[${sessionId}] Connexion réussie. Préparation de la boucle principale.`);

        const popupSelector = selectors.popup; // Correction : utilisation du sélecteur centralisé
        const popupCheckTimeout = 3000;

        // Boucle principale pour CETTE session
        logger.debug(`[${sessionId}] Entrée dans la boucle principale.`);
        mainLoop: while (true) {
            logger.debug(`[${sessionId}] Début de la boucle: Recherche/attente exercice...`);
            logger.debug(`[${sessionId}] Début de l'itération de la boucle principale.`);

            // Vérifier si la page/contexte est toujours valide avant chaque action majeure
             if (!page || page.isClosed()) {
                logger.error(`[${sessionId}] La page est fermée avant selectNextExercise. Arrêt de la session.`);
                break mainLoop;
            }

            // *** NOUVEAU: Attendre que la page soit potentiellement stable ***
            try {
                logger.debug(`[${sessionId}] Attente de stabilisation de la page (load/domcontentloaded)...`);
                // Attendre que le réseau soit inactif ou qu'un état de chargement soit atteint
                // 'load' ou 'domcontentloaded' sont de bons candidats après une navigation ou action majeure.
                // 'networkidle' peut être trop long ou ne jamais se déclencher sur des pages très dynamiques.
                await page.waitForLoadState('domcontentloaded', { timeout: 10000 }); // Attente max 10s
                logger.debug(`[${sessionId}] Stabilisation terminée ou timeout atteint.`);
            } catch (waitError) {
                 if (!page || page.isClosed()) {
                    logger.error(`[${sessionId}] La page est fermée pendant l'attente de stabilisation. Arrêt.`);
                    break mainLoop;
                }
                logger.warn(`[${sessionId}] Timeout ou erreur lors de waitForLoadState: ${waitError.message}. Continuation...`);
            }
            // *** FIN NOUVEAU ***


            let exerciseSelected = false;
            try {
                logger.debug(`[${sessionId}] Appel de selectNextExercise.`);
                exerciseSelected = await selectNextExercise(page, sessionId); // Existing call
                logger.debug(`[${sessionId}] Retour de selectNextExercise: ${exerciseSelected}`);
                if (exerciseSelected) {
                    logger.debug(`[${sessionId}] Exercice sélectionné avec succès.`);
                    // Short delay after successful selection/click might be needed for UI to update
                    await page.waitForTimeout(config.MIN_ACTION_DELAY + Math.random() * (config.MAX_ACTION_DELAY - config.MIN_ACTION_DELAY));
                } else {
                    logger.debug(`[${sessionId}] Aucun exercice n'a pu être sélectionné/cliqué cette fois.`);
                    // Consider if a longer wait or different action is needed here
                    await page.waitForTimeout(5000); // Increased wait time if nothing was selected
                }
            } catch (error) {
                 // This catch block might be redundant if selectNextExercise handles its errors,
                 // but keep it for unexpected errors during the call itself.
                 if (!page || page.isClosed()) {
                    logger.error(`[${sessionId}] La page est fermée après l'appel à selectNextExercise. Arrêt.`);
                    break mainLoop;
                }
                logger.error(`[${sessionId}] Erreur inattendue AUTOUR de l'appel selectNextExercise: ${error.message}. Poursuite...`);
                await page.waitForTimeout(2000); // Wait after unexpected error
            }


            // Vérification du popup (avant ou pendant l'exercice)
            // Ensure page is still valid before popup check
            if (!page || page.isClosed()) {
                logger.error(`[${sessionId}] La page est fermée avant checkAndSolvePopup. Arrêt.`);
                break mainLoop;
            }
            await checkAndSolvePopup(page, popupSelector, popupCheckTimeout, sessionId);

             // Ensure page is still valid before inner loop
             if (!page || page.isClosed()) {
                logger.error(`[${sessionId}] La page est fermée avant la boucle interne de résolution. Arrêt.`);
                break mainLoop;
            }

            // Boucle interne pour résoudre les étapes (only if an exercise was potentially selected)
            // We might want to skip this if exerciseSelected is false, depending on desired logic
            if (exerciseSelected) { // Optional: Only try solving if selection seemed successful
                logger.debug(`[${sessionId}] Tentative de résolution de l'exercice sélectionné...`);
                innerLoop: while (true) {
                    // ... (rest of the inner loop remains the same)
                     if (!page || page.isClosed()) {
                        logger.error(`[${sessionId}] La page est fermée dans la boucle interne. Arrêt.`);
                        break mainLoop; // Sortir aussi de la boucle principale
                    }

                    // Vérification du popup
                    await checkAndSolvePopup(page, popupSelector, popupCheckTimeout, sessionId);

                     if (!page || page.isClosed()) { // Vérifier après le popup
                        logger.error(`[${sessionId}] La page est fermée après vérif popup dans boucle interne. Arrêt.`);
                        break mainLoop;
                    }

                    // Résolution de l'étape
                    logger.debug(`[${sessionId}] Lancement de solveSingleExercise...`);
                    const solveResult = await solveSingleExercise(page, sessionId); // Passe sessionId pour logging interne

                    // Gérer le redémarrage (pour l'instant, arrête juste la session)
                    if (solveResult.restartBrowser) {
                        logger.error(`[${sessionId}] Redémarrage demandé par solveSingleExercise. Arrêt de la session.`);
                        break mainLoop;
                    }

                    if (!solveResult.success) {
                        logger.warn(`[${sessionId}] Échec résolution étape: ${solveResult.error || 'Erreur inconnue'}. Retour sélection.`);
                        break innerLoop; // Retourne à la sélection d'exercice
                    }

                    if (solveResult.exerciseComplete) {
                        logger.debug(`[${sessionId}] Exercice terminé.`);
                        break innerLoop; // Cherche le prochain exercice
                    }

                    logger.debug(`[${sessionId}] Étape résolue. Passage à la suivante...`);
                    await page.waitForTimeout(500 + Math.random() * 500); // Pause
                } // Fin innerLoop
            } else {
                 logger.debug(`[${sessionId}] Saut de la boucle de résolution car aucun exercice n'a été sélectionné.`);
                 // Wait a bit before trying to select again
                 await page.waitForTimeout(2000 + Math.random() * 1000);
            }

            logger.debug(`[${sessionId}] Fin de l'itération principale. Retour sélection/attente...`);
            // Removed the extra wait here as waits are handled within the loop logic now
            // await page.waitForTimeout(1000 + Math.random() * 1000);

        } // Fin mainLoop

        logger.info(`[${sessionId}] Sortie de la boucle principale.`);

    } catch (error) {
        logger.error(`[${sessionId}] Erreur critique non gérée dans le bloc try de runAccountSession: ${error.message}`, error.stack);
        // Ne relance pas l'erreur pour ne pas arrêter les autres sessions
    } finally {
        logger.debug(`[${sessionId}] Entrée dans le bloc finally de runAccountSession.`);
        // Annule le minuteur s'il était actif pour éviter une exécution inutile
        if (sessionTimerId) {
            clearTimeout(sessionTimerId);
            logger.debug(`[${sessionId}] Minuteur de session annulé car la session se termine.`);
        }
        if (sessionTimeIntervalId) {
            clearInterval(sessionTimeIntervalId);
            logger.debug(`[${sessionId}] Intervalle d'envoi du temps de session annulé.`);
        }
        // Ferme la session spécifique, même en cas d'erreur (si pas déjà fermée par le minuteur)
        // On vérifie si le compte est marqué comme expiré pour éviter une tentative de fermeture redondante
        if (!expiredAccounts.has(sessionId)) {
            logger.debug(`[${sessionId}] Nettoyage et fermeture de la session (non expirée)...`);
            await closeBrowserSession(sessionId); // Utilise la fonction de fermeture spécifique
            logger.info(`[${sessionId}] Session terminée (non expirée).`);
        } else {
             logger.debug(`[${sessionId}] Session déjà marquée comme expirée ou fermée par le minuteur. Nettoyage final.`);
             // On pourrait s'assurer ici que la ressource navigateur est bien libérée,
             // mais closeBrowserSession est censé gérer cela même si appelé plusieurs fois.
        }
}
}

// --- Fonction Principale d'Orchestration ---
async function startAllSessions() {
    logger.info('Démarrage du bot Projet Voltaire - Mode Multi-Sessions');
    let allAccounts = [];
    let activeAccountIds = null;
    const activeAccountsPath = path.resolve('config/active_accounts.json');
    const sessionTimesPath = path.resolve('config/session_times.json');
    let sessionTimes = {};

    try {
        // Charger session_times.json pour la persistance du temps restant
        try {
            const sessionTimesRaw = await fs.readFile(sessionTimesPath, 'utf-8');
            sessionTimes = JSON.parse(sessionTimesRaw);
        } catch (e) {
            sessionTimes = {};
        }

        // 1. Charger tous les comptes depuis le fichier JSON de configuration
        allAccounts = await loadAccountsFromJSON();

        // Initialiser expiredAccounts en fonction de sessionTimes.json et de la config
        for (const account of allAccounts) {
            const st = sessionTimes[account.id];
            let remaining = null;
            if (st && typeof st.remainingTime === "number" && typeof st.lastUpdate === "number") {
                remaining = st.remainingTime - (now - st.lastUpdate);
            }
            // Si la durée a été prolongée (sessionEnd > now et différente de la précédente), on "dé-expire"
            if (account.sessionEnd && account.sessionEnd > now) {
                // Si la sessionTimes n'est pas à jour, on la met à jour
                if (!st || !st.remainingTime || (st.lastUpdate && remaining <= 0)) {
                    sessionTimes[account.id] = {
                        remainingTime: account.sessionEnd - now,
                        lastUpdate: now
                    };
                }
            }
        // Si le temps restant est <= 0, on expire le compte
            if (remaining !== null && remaining <= 0) {
                expiredAccounts.add(account.id);
                // Désactive automatiquement le compte expiré
                try {
                    const accountsPath = path.resolve('config/accounts_config.json');
                    const accountsData = JSON.parse(await fs.readFile(accountsPath, 'utf-8'));
                    const idx = accountsData.findIndex(acc => acc.id === account.id);
                    if (idx !== -1 && accountsData[idx].isEnabled !== false) {
                        accountsData[idx].isEnabled = false;
                        await fs.writeFile(accountsPath, JSON.stringify(accountsData, null, 2));
                        logger.info(`[${account.id}] Compte désactivé automatiquement car expiré.`);
                    }
                } catch (e) {
                    logger.warn(`[${account.id}] Impossible de désactiver automatiquement le compte expiré : ${e.message}`);
                }
            }
        }
    } catch (error) {
        // Erreur lors du chargement des comptes ou autre erreur globale
        logger.error('Erreur critique lors du chargement des comptes:', error);
    }

    try {
        if (allAccounts.length === 0) {
            logger.warn("Aucun compte n'a été chargé depuis .env. Vérifiez votre fichier .env");
            return; // Ne rien faire s'il n'y a pas de comptes
        }
        logger.info(`${allAccounts.length} compte(s) trouvé(s) dans accounts_config.json.`);

        // 2. Essayer de lire les comptes actifs sélectionnés
        try {
            const data = await fs.readFile(activeAccountsPath, 'utf-8');
            const parsedData = JSON.parse(data);
            if (Array.isArray(parsedData)) {
                activeAccountIds = new Set(parsedData); // Utilise un Set pour une recherche rapide
                logger.debug(`Sélection de comptes actifs chargée depuis ${activeAccountsPath}: [${parsedData.join(', ')}]`);
            } else {
                logger.warn(`Le fichier ${activeAccountsPath} ne contient pas un tableau valide. Tous les comptes seront considérés.`);
            }
        } catch (readError) {
            if (readError.code === 'ENOENT') {
                logger.info(`Le fichier ${activeAccountsPath} n'existe pas. Tous les comptes seront considérés.`);
            } else {
                logger.warn(`Erreur lors de la lecture de ${activeAccountsPath}: ${readError.message}. Tous les comptes seront considérés.`);
            }
        }

        // 3. Filtrer les comptes basés sur la sélection (si disponible)
        let accountsToConsider = allAccounts;
        if (activeAccountIds) {
            accountsToConsider = allAccounts.filter(account => activeAccountIds.has(account.id));
            logger.debug(`Filtrage basé sur la sélection : ${accountsToConsider.length} compte(s) actif(s) sélectionné(s).`);
            if (accountsToConsider.length === 0 && allAccounts.length > 0) {
                 logger.warn("Aucun des comptes sélectionnés n'est valide ou trouvé. Vérifiez votre sélection et .env.");
                 // On pourrait vouloir arrêter ici ou continuer avec tous les comptes comme fallback ?
                 // Pour l'instant, on arrête s'il y avait une sélection mais qu'elle est vide/invalide.
                 return;
            }
        } else {
             logger.debug("Aucune sélection de comptes actifs trouvée, tous les comptes .env seront lancés.");
        }


        // 4. Filtrer les comptes déjà expirés (parmi ceux à considérer)
        const accountsToRun = accountsToConsider.filter(account => {
            if (expiredAccounts.has(account.id)) {
                logger.warn(`[${account.id}] Session non démarrée car le temps alloué est écoulé.`);
                return false;
            }
            if (account.isEnabled === false) {
                logger.info(`[${account.id}] Session non démarrée car le compte est désactivé (isEnabled=false).`);
                return false;
            }
            return true;
        });

        if (accountsToRun.length === 0) {
             logger.info("Aucun compte actif à lancer (tous expirés ou aucun configuré).");
             // On pourrait vouloir quitter ici si aucun compte n'est actif
             // process.exit(0); // Optionnel: quitter si rien à faire
             return; // Ou juste ne rien lancer
        }

        logger.info(`Lancement effectif de ${accountsToRun.length} session(s)...`);
        logger.info('Comptes lancés :', accountsToRun.map(acc => `${acc.id} (${acc.email})`).join(', '));
        if (accountsToRun.length === 0) {
            logger.warn('Aucun compte actif à lancer (tous expirés, désactivés ou non sélectionnés). Vérifiez accounts_config.json et active_accounts.json.');
        }

        // *** NOUVEAU: Log pour confirmer le lancement parallèle ***
        logger.debug(`[Orchestrator] Lancement des ${accountsToRun.length} sessions en parallèle via Promise.allSettled...`);
        // *** FIN NOUVEAU ***

        // Lance les sessions non expirées en parallèle
        const sessionPromises = accountsToRun.map(account => runAccountSession(account));

        // Attend que toutes les sessions lancées se terminent (ou échouent individuellement)
        await Promise.allSettled(sessionPromises);

        logger.info('Toutes les sessions ont terminé leur exécution.');

    } catch (error) {
        // Erreur lors du chargement des comptes ou autre erreur globale
        logger.error('Erreur critique lors du démarrage ou de l\'orchestration:', error);
    } finally {
        // Assure la fermeture de toute session restante (au cas où Promise.allSettled ne suffirait pas)
        logger.debug('Nettoyage final: Fermeture de toutes les sessions potentiellement restantes...');
        await closeAllBrowserSessions();
        logger.info('Arrêt complet du bot.');
        process.exit(0); // Quitte proprement
    }
}

// --- Gestion des signaux d'arrêt ---
let isShuttingDown = false;
async function gracefulShutdown(signal) {
    if (isShuttingDown) return;
    isShuttingDown = true;
    logger.warn(`Signal ${signal} reçu. Tentative d'arrêt progressif...`);
    logger.debug('Fermeture de toutes les sessions...');
    await closeAllBrowserSessions();
    logger.info('Arrêt terminé.');
    process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT')); // Ctrl+C
process.on('SIGTERM', () => gracefulShutdown('SIGTERM')); // Arrêt système

// --- Exécution ---
async function main() {
    await startServer(); // Démarre le serveur web
    // Si MODE=server, ne pas lancer le bot
    if (process.env.MODE === "server") {
        logger.info("MODE=server : seul le serveur web est lancé.");
        return;
    }
    startAllSessions(); // Démarre les sessions du bot
}

main();