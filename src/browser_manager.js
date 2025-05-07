// DEBUG: src/browser_manager.js chargé le {new Date().toISOString()}
console.log("DEBUG: src/browser_manager.js importé à l'exécution Node.js");
/**
 * Ce module utilise l’API asynchrone du logger.
 * Pour chaque fonction asynchrone ou callback, obtenir l’instance du logger via :
 *   const logger = await getLogger();
 * avant chaque utilisation (info, error, warn, debug, etc.).
 * Voir ./logger.js pour l’implémentation.
 */

// src/browser_manager.js

import playwright from 'playwright';
const logger = await getLogger();
import path from 'path';
import fs from 'fs/promises'; // Utilisation de fs.promises pour async/await
import getLogger from './logger.js'; // Migration vers l’API asynchrone du logger
import { Mutex, Semaphore } from './async_utils.js'; // Ajout pour la gestion de la concurrence
import { validateBrowserSessionOptions } from './validation_utils.js';

// En ES Modules, __dirname n'est pas disponible par défaut. Utilisons import.meta.url.
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROFILES_DIR = path.join(__dirname, '..', 'user_profiles'); // Répertoire pour stocker les profils

/**
 * Tente de réparer automatiquement l’environnement Playwright pour une session donnée.
 * - Corrige la config du compte si sessionDuration/sessionEnd sont incohérents
 * - Arrête les processus Chrome/Chromium/Playwright
 * - Supprime le dossier de profil utilisateur du compte
 * - Loggue toutes les actions
 * @param {string} sessionId
 */
export async function autoFixPlaywrightEnvironment(sessionId) {
    const logger = await getLogger();
    try {
        logger.warn(`[AUTOFIX] Démarrage de la réparation automatique Playwright pour la session ${sessionId}...`);

        // 1. Corriger la config du compte si besoin
        const accountsPath = path.join(__dirname, '..', 'config', 'accounts_config.json');
        let accounts = [];
        try {
            const data = await fs.readFile(accountsPath, 'utf-8');
            accounts = JSON.parse(data);
        } catch (e) {
            logger.error(`[AUTOFIX] Impossible de lire accounts_config.json: ${e.message}`);
        }
        let changed = false;
        for (const account of accounts) {
            if (account.id === sessionId) {
                // Correction sessionDuration absurde
                if (!account.sessionDuration || typeof account.sessionDuration !== 'string' || account.sessionDuration.length > 10 || account.sessionDuration.match(/[^0-9\.h]/) || account.sessionDuration === "" || account.sessionDuration === null || account.sessionDuration === undefined || account.sessionDuration.match(/^1[0-9]{5,}/)) {
                    logger.warn(`[AUTOFIX] Correction de sessionDuration pour ${sessionId} (valeur: ${account.sessionDuration})`);
                    account.sessionDuration = "2h";
                    changed = true;
                }
                // Correction sessionEnd absurde
                if (account.sessionEnd && (typeof account.sessionEnd !== 'number' || account.sessionEnd > Date.now() + 1000 * 60 * 60 * 24 * 365 * 10)) {
                    logger.warn(`[AUTOFIX] Correction de sessionEnd pour ${sessionId} (valeur: ${account.sessionEnd})`);
                    account.sessionEnd = null;
                    changed = true;
                }
            }
        }
        if (changed) {
            try {
                await fs.writeFile(accountsPath, JSON.stringify(accounts, null, 2), 'utf-8');
                logger.info(`[AUTOFIX] accounts_config.json corrigé pour ${sessionId}`);
            } catch (e) {
                logger.error(`[AUTOFIX] Impossible d'écrire accounts_config.json: ${e.message}`);
            }
        }

        // 2. Arrêter les processus Chrome/Chromium/Playwright (Windows)
        try {
            const { execSync } = await import('child_process');
            execSync('taskkill /IM chrome.exe /F', { stdio: 'ignore' });
            logger.info(`[AUTOFIX] Tous les processus chrome.exe arrêtés`);
        } catch (e) {
            logger.warn(`[AUTOFIX] Erreur lors de l'arrêt des processus chrome.exe: ${e.message}`);
        }

        // 3. Supprimer le dossier de profil utilisateur Playwright
        const userDataDir = path.join(__dirname, '..', 'user_profiles', sessionId);
        try {
            await fs.rm(userDataDir, { recursive: true, force: true });
            logger.info(`[AUTOFIX] Dossier profil utilisateur supprimé: ${userDataDir}`);
        } catch (e) {
            logger.warn(`[AUTOFIX] Impossible de supprimer le dossier profil utilisateur: ${e.message}`);
        }

        logger.info(`[AUTOFIX] Réparation automatique terminée pour la session ${sessionId}.`);
    } catch (e) {
        logger.error(`[AUTOFIX] Erreur inattendue dans autoFixPlaywrightEnvironment: ${e.message}`);
    }
}
// Map pour stocker les sessions actives: sessionId -> { browser, context, page }
const activeSessions = new Map();
// Structure d’une session : {
//   context, page, accumulatedTimeMs, lastStartTimestamp, sessionDurationMs,
//   inactivityTimer, sessionTimer, suspended, ...
// }

// Sémaphore pour limiter le nombre de ses
// sions navigateur simultanées (ex : 4)
const sessionSemaphore = new Semaphore(4);

// Mutex global pour protéger l'accès aux sessions et aux ressources critiques
const sessionMutex = new Mutex();

/**
 * Assure que le répertoire des profils existe.
 */
async function ensureProfilesDirExists() {
    const logger = await getLogger();
    logger.debug(`[PROFILES] Vérification de l'existence du dossier profils : ${PROFILES_DIR}`);
    let alreadyChecked = false;
    // On protège uniquement la vérification atomique avec le mutex, sans I/O bloquant dans le runExclusive
    await sessionMutex.runExclusive(() => {
        if (!ensureProfilesDirExists._checked) {
            ensureProfilesDirExists._checked = true;
            alreadyChecked = false;
        } else {
            alreadyChecked = true;
        }
    });
    if (alreadyChecked) {
        logger.debug(`[PROFILES] Dossier profils déjà vérifié précédemment (${PROFILES_DIR})`);
        return;
    }
    try {
        await fs.mkdir(PROFILES_DIR, { recursive: true });
        logger.debug(`[PROFILES] Dossier profils créé ou déjà existant : ${PROFILES_DIR}`);
    } catch (error) {
        logger.error(`[PROFILES] ERREUR lors de la création du dossier profils : ${PROFILES_DIR}\nMessage: ${error.message}\nStack: ${error.stack}`);
        throw new Error(`Impossible de créer le répertoire des profils : ${error.message}`);
    }
}

/**
 * Initialise une instance de navigateur Playwright isolée pour une session donnée.
 * @param {string} sessionId - Un identifiant unique pour la session (ex: 'account_1').
 * @param {object} options - Options de lancement pour Playwright (ex: { headless: false }).
 * @returns {Promise<{browser: import('playwright').Browser, context: import('playwright').BrowserContext, page: import('playwright').Page}>}
**/
export async function initializeBrowserSession(sessionId, options = {}) {
    const logger = await getLogger();
    logger.info(`[BROWSER] Initialisation de la session navigateur pour ${sessionId}`);

    // 0. Validation stricte des options
    try {
        validateBrowserSessionOptions(options);
    } catch (validationErr) {
        logger.error(`[BROWSER] [${sessionId}] Options invalides : ${validationErr.message}`, { options, stack: validationErr.stack });
        throw validationErr;
    }

    // Limitation du nombre de sessions simultanées via le sémaphore
    return await sessionSemaphore.runExclusive(async () => {
        let sessionData;
        // 1. Vérification atomique de l'existence de la session (mutex)
        try {
            await sessionMutex.runExclusive(async () => {
                if (activeSessions.has(sessionId)) {
                    const logger = await getLogger();
                    logger.warn(`[BROWSER] Session ${sessionId} déjà initialisée. Retour de l'instance existante.`);
                    sessionData = activeSessions.get(sessionId);
                }
            });
            if (sessionData) return sessionData;
        } catch (err) {
            const logger = await getLogger();
            logger.error(`[BROWSER] ERREUR lors de la vérification atomique de la session ${sessionId} : ${err.message}\nSTACK: ${err.stack}`);
            throw err;
        }

        // 2. S'assurer que le dossier des profils existe (hors mutex)
        try {
            await ensureProfilesDirExists();
        } catch (err) {
            const logger = await getLogger();
            logger.error(`[BROWSER] [${sessionId}] ERREUR ensureProfilesDirExists: ${err.message}\nSTACK: ${err.stack}`);
            throw err;
        }

        // 3. Création du dossier userDataDir pour la session si besoin (hors mutex)
        const userDataDir = path.join(PROFILES_DIR, sessionId);
        try {
            await fs.mkdir(userDataDir, { recursive: true });
            const logger = await getLogger();
            logger.debug(`[BROWSER] [${sessionId}] Dossier profil utilisateur prêt : ${userDataDir}`);
        } catch (e) {
            const logger = await getLogger();
            logger.error(`[BROWSER] [${sessionId}] ERREUR création userDataDir: ${e.message}\nSTACK: ${e.stack}`);
            throw new Error(`Impossible de créer le dossier profil utilisateur pour la session ${sessionId} : ${e.message}`);
        }

        // 4. Log du contenu du dossier profil (hors mutex)
        try {
            const files = await fs.readdir(userDataDir);
            const logger = await getLogger();
            logger.debug(`[BROWSER] [${sessionId}] Contenu du dossier profil ${userDataDir}: ${files.join(', ')}`);
        } catch (e) {
            const logger = await getLogger();
            logger.warn(`[BROWSER] [${sessionId}] Impossible de lire le contenu du dossier profil ${userDataDir}: ${e.message}\nSTACK: ${e.stack}`);
        }

        // 5. Lancement du navigateur Playwright et création de la page
        let context, page;
        try {
            const launchOptions = { ...options };
            const logger = await getLogger();
            logger.debug(`[BROWSER] [${sessionId}] Lancement de launchPersistentContext: userDataDir=${userDataDir}, options=${JSON.stringify(launchOptions)}`);
            context = await playwright.chromium.launchPersistentContext(userDataDir, launchOptions);
            if (!context) throw new Error('Échec du lancement du contexte persistant.');
            logger.debug(`[BROWSER] [${sessionId}] Contexte persistant lancé.`);

            page = await context.newPage();
            if (!page) throw new Error('Échec de la création de la page.');
            logger.debug(`[BROWSER] [${sessionId}] Page créée avec succès.`);

            // Gestion proactive de la fermeture de page
            page.on('close', async () => {
                const logger = await getLogger();
                logger.warn(`[${sessionId}] Page closed unexpectedly, aborting current operations.`);
                const sessionData = activeSessions.get(sessionId);
                if (sessionData && sessionData.abortController && !sessionData.abortController.signal.aborted) {
                    sessionData.abortController.abort();
                }
            });

            // Ajout du listener pour redémarrage automatique en cas de fermeture du contexte
            context.on('close', async () => {
                const logger = await getLogger();
                logger.warn(`[BROWSER] [${sessionId}] Fermeture inattendue du contexte détectée. Tentative de redémarrage dans 5 secondes...`);
                await sessionMutex.runExclusive(async () => {
                    activeSessions.delete(sessionId);
                });
                setTimeout(async () => {
                    try {
                        logger.info(`[BROWSER] [${sessionId}] Redémarrage automatique de la session...`);
                        await restartBrowserSession(sessionId, options);
                        logger.info(`[BROWSER] [${sessionId}] Session relancée automatiquement après fermeture.`);
                    } catch (err) {
                        logger.error(`[BROWSER] [${sessionId}] Échec du redémarrage automatique : ${err.message}`);
                    }
                }, 5000);
            });
        } catch (error) {
            const logger = await getLogger();
            logger.error(`[BROWSER] [${sessionId}] ERREUR lors du lancement du navigateur ou de la page: ${error.message}\nSTACK: ${error.stack}`);
            // Nettoyage si besoin
            try {
                if (context && typeof context.close === 'function') {
                    await context.close();
                    const logger = await getLogger();
                    logger.debug(`[BROWSER] [${sessionId}] Contexte Playwright fermé après échec.`);
                }
            } catch (cleanupErr) {
                const logger = await getLogger();
                logger.error(`[BROWSER] [${sessionId}] ERREUR lors du nettoyage du contexte après échec: ${cleanupErr.message}\nSTACK: ${cleanupErr.stack}`);
            }
            // Appel de la réparation automatique Playwright
            await autoFixPlaywrightEnvironment(sessionId);
            throw new Error(`Erreur lors de l'initialisation de la session ${sessionId}: ${error.message}`);
        }

        // 6. Enregistrement atomique de la session (mutex)
        try {
            await sessionMutex.runExclusive(async () => {
                // Initialisation du suivi du temps de session
                const now = Date.now();
                let previousData = activeSessions.get(sessionId) || {};
                let accumulatedTimeMs = previousData.accumulatedTimeMs || 0;
                if (global.sessionTimes && global.sessionTimes.has(sessionId)) {
                    accumulatedTimeMs = global.sessionTimes.get(sessionId).accumulatedTimeMs || 0;
                }
                const sessionDurationMs = options.sessionDurationMs || previousData.sessionDurationMs || null;

                // --- Timers d’inactivité et de durée de session ---
                // Nettoyage préalable si redémarrage
                if (previousData.inactivityTimer) clearTimeout(previousData.inactivityTimer);
                if (previousData.sessionTimer) clearTimeout(previousData.sessionTimer);

                let inactivityTimer = null;
                let sessionTimer = null;
                let suspended = false;

                // Timer d’inactivité (optionnel)
                if (typeof options.inactivityTimeoutMs === 'number' && options.inactivityTimeoutMs > 0) {
                    inactivityTimer = setTimeout(async () => {
                        const logger = await getLogger();
                        logger.info(`[BROWSER] [${sessionId}] Inactivité détectée (${options.inactivityTimeoutMs} ms). Fermeture automatique.`);
                        await closeBrowserSession(sessionId);
                    }, options.inactivityTimeoutMs);
                }

                // Timer de durée de session (optionnel)
                if (typeof sessionDurationMs === 'number' && sessionDurationMs > 0) {
                    sessionTimer = setTimeout(async () => {
                        const logger = await getLogger();
                        logger.info(`[BROWSER] [${sessionId}] Durée de session atteinte (${sessionDurationMs} ms). Fermeture automatique.`);
                        await closeBrowserSession(sessionId);
                    }, sessionDurationMs);
                }

                // Ajout AbortController pour la session
                let abortController = previousData.abortController;
                if (!abortController || abortController.signal.aborted) {
                    abortController = new AbortController();
                }
                activeSessions.set(sessionId, {
                    context,
                    page,
                    accumulatedTimeMs,
                    lastStartTimestamp: now,
                    sessionDurationMs,
                    inactivityTimer,
                    sessionTimer,
                    suspended,
                    abortController
                });
                logger.debug(`[BROWSER] [${sessionId}] Session enregistrée dans activeSessions (état: active, abortController inclus).`);
            });
        } catch (err) {
            const logger = await getLogger();
            logger.error(`[BROWSER] [${sessionId}] ERREUR lors de l'enregistrement atomique de la session: ${err.message}\nSTACK: ${err.stack}`);
            // Nettoyage si besoin
            try {
                if (context && typeof context.close === 'function') {
                    await context.close();
                    const logger = await getLogger();
                    logger.debug(`[BROWSER] [${sessionId}] Contexte Playwright fermé après échec d'enregistrement.`);
                }
            } catch (cleanupErr) {
                const logger = await getLogger();
                logger.error(`[BROWSER] [${sessionId}] ERREUR lors du nettoyage du contexte après échec d'enregistrement: ${cleanupErr.message}\nSTACK: ${cleanupErr.stack}`);
            }
            throw new Error(`Erreur lors de l'enregistrement de la session ${sessionId}: ${err.message}`);
        }

      
        logger.info(`[BROWSER] [${sessionId}] Session initialisée avec succès.`);
        return { context, page };
    });
}

/**
 * Récupère les données d'une session active.
 * @param {string} sessionId - L'identifiant de la session.
 * @returns {{browser: import('playwright').Browser, context: import('playwright').BrowserContext, page: import('playwright').Page} | undefined}
 */
export function getSession(sessionId) {
    return activeSessions.get(sessionId);
}

// Utilitaire pour obtenir/créer l'AbortController d'une session
export function getSessionAbortSignal(sessionId) {
    const sessionData = activeSessions.get(sessionId);
    if (!sessionData) return undefined;
    if (!sessionData.abortController || sessionData.abortController.signal.aborted) {
        sessionData.abortController = new AbortController();
    }
    return sessionData.abortController.signal;
}

/**
 * Ferme proprement l'instance du navigateur pour une session spécifique.
 * @param {string} sessionId - L'identifiant de la session à fermer.
 */
export async function closeBrowserSession(sessionId) {
    // Protection de la fermeture de session par le mutex
    await sessionMutex.runExclusive(async () => {
        const logger = await getLogger();
        const sessionData = activeSessions.get(sessionId);
        if (!sessionData || !sessionData.context) {
            logger.warn(`Tentative de fermeture d'une session inexistante ou déjà fermée : ${sessionId}`);
            return;
        }

        // --- Nettoyage des timers et ressources ---
        if (sessionData.inactivityTimer) {
            clearTimeout(sessionData.inactivityTimer);
            logger.debug(`[BROWSER] [${sessionId}] Timer d’inactivité annulé à la fermeture.`);
        }
        if (sessionData.sessionTimer) {
            clearTimeout(sessionData.sessionTimer);
            logger.debug(`[BROWSER] [${sessionId}] Timer de durée de session annulé à la fermeture.`);
        }

        // --- Gestion du temps accumulé ---
        const now = Date.now();
        let accumulatedTimeMs = sessionData.accumulatedTimeMs || 0;
        if (sessionData.lastStartTimestamp) {
            accumulatedTimeMs += now - sessionData.lastStartTimestamp;
        }
        // On conserve le temps accumulé dans une Map globale pour la session
        if (!global.sessionTimes) global.sessionTimes = new Map();
        global.sessionTimes.set(sessionId, {
            accumulatedTimeMs,
            sessionDurationMs: sessionData.sessionDurationMs || null
        });
        logger.debug(`[BROWSER] [${sessionId}] Temps accumulé calculé et stocké globalement: ${accumulatedTimeMs} ms`); // Log amélioré

        // --- Sauvegarde du temps écoulé dans session_times.json ---
        const sessionTimesPath = path.join(__dirname, '..', 'config', 'session_times.json');
        // Removed redundant try block and duplicate variable declaration below
        try {
            const logger = await getLogger(); // Obtenir logger ici
            let sessionTimesData = {}; // Initialiser comme un objet
            try {
                    const fileContent = await fs.readFile(sessionTimesPath, 'utf-8');
                    sessionTimesData = JSON.parse(fileContent);
                    // Vérifier si c'est bien un objet (et non null ou autre type)
                    if (typeof sessionTimesData !== 'object' || sessionTimesData === null || Array.isArray(sessionTimesData)) {
                       logger.error(`[BROWSER] [${sessionId}] Le contenu de ${sessionTimesPath} n'est pas un objet JSON valide. Tentative de récupération impossible.`);
                       throw new Error('Le contenu de session_times.json n\'est pas un objet JSON valide.');
                    }
                } catch (readError) {
                    logger.error(`[BROWSER] [${sessionId}] Impossible de lire ou parser ${sessionTimesPath}: ${readError.message}. La mise à jour de elapsedTime pourrait échouer.`);
                    // Si le fichier n'existe pas (ENOENT), on part d'un objet vide.
                    // Si une autre erreur de lecture/parsing survient, on ne continue pas pour éviter d'écraser le fichier.
                    if (readError.code !== 'ENOENT') {
                        throw readError; // Relancer l'erreur si ce n'est pas "fichier non trouvé"
                    }
                    sessionTimesData = {}; // Partir d'un objet vide si le fichier n'existe pas
                }
    
                // Vérifier si le compte (sessionId) existe comme clé dans l'objet
                if (sessionTimesData.hasOwnProperty(sessionId)) {
                     // S'assurer que la valeur associée à la clé est un objet (au cas où)
                     if (typeof sessionTimesData[sessionId] !== 'object' || sessionTimesData[sessionId] === null) {
                        logger.warn(`[BROWSER] [${sessionId}] La valeur pour la clé ${sessionId} dans ${sessionTimesPath} n'est pas un objet. Elle sera réinitialisée.`);
                        sessionTimesData[sessionId] = {}; // Réinitialiser si ce n'est pas un objet
                     }
                     // Vérifier si elapsedTime existe et est un nombre, sinon l'initialiser
                     if (typeof sessionTimesData[sessionId].elapsedTime !== 'number' || !Number.isFinite(sessionTimesData[sessionId].elapsedTime)) {
                         logger.warn(`[BROWSER] [${sessionId}] elapsedTime manquant ou invalide pour ${sessionId}. Initialisation à 0 avant ajout.`);
                         sessionTimesData[sessionId].elapsedTime = 0;
                     }
                    // Mettre à jour elapsedTime en ajoutant le temps accumulé
                    sessionTimesData[sessionId].elapsedTime += accumulatedTimeMs; // Correction: Utiliser += pour ajouter
                    logger.debug(`[BROWSER] [${sessionId}] Mise à jour de elapsedTime à ${sessionTimesData[sessionId].elapsedTime} ms (+${accumulatedTimeMs} ms) pour le compte ${sessionId} dans ${sessionTimesPath}`); // Correction: Afficher la nouvelle valeur totale

                } else {
                    // Compte non trouvé dans l'objet JSON. Créer une nouvelle entrée.
                    logger.info(`[BROWSER] [${sessionId}] Compte (clé) '${sessionId}' non trouvé dans ${sessionTimesPath}. Création d'une nouvelle entrée.`);
                    sessionTimesData[sessionId] = {
                        elapsedTime: accumulatedTimeMs // Initialiser elapsedTime avec le temps accumulé de cette session
                    };
                    logger.debug(`[BROWSER] [${sessionId}] Nouvelle entrée créée avec elapsedTime: ${accumulatedTimeMs} ms`);
                }

                // Écrire l'objet JSON mis à jour dans le fichier (déplacé hors du if/else)
                try {
                    await fs.writeFile(sessionTimesPath, JSON.stringify(sessionTimesData, null, 2), 'utf-8');
                    logger.debug(`[BROWSER] [${sessionId}] Fichier ${sessionTimesPath} sauvegardé avec succès.`);
                } catch (writeError) {
                     logger.error(`[BROWSER] [${sessionId}] ERREUR lors de l'écriture de ${sessionTimesPath}: ${writeError.message}`);
                     // Ne pas propager l'erreur pour ne pas bloquer la fermeture du navigateur
                }
            } catch (error) {
                const logger = await getLogger(); // Obtenir logger ici aussi
                logger.error(`[BROWSER] [${sessionId}] Erreur lors de la tentative de mise à jour de elapsedTime dans ${sessionTimesPath}: ${error.message}\nStack: ${error.stack}`);
                // Ne pas propager l'erreur pour ne pas bloquer la fermeture du navigateur
                // Ne pas propager l'erreur pour ne pas bloquer la fermeture du navigateur
            }
        // End of the try block for file operations

        logger.debug(`[BROWSER] [${sessionId}] Poursuite de la fermeture de la session ${sessionId}...`); // Log ajusté
        // Supprimer immédiatement la session pour éviter les doubles fermetures
        activeSessions.delete(sessionId);
        try {
            // Fermer le contexte Playwright (équivalent à fermer le navigateur pour launchPersistentContext)
            if (sessionData.context && typeof sessionData.context.close === 'function') {
                await sessionData.context.close();
                // Fermer également le navigateur sous-jacent pour les contexts persistants
                try {
                    const browser = sessionData.context.browser();
                    if (browser && typeof browser.close === 'function') {
                        await browser.close();
                        const logger = await getLogger();
                        logger.debug(`Browser process for session ${sessionId} closed.`);
                    }
                } catch (err) {
                    const logger = await getLogger();
                    logger.warn(`Impossible de fermer le browser sous-jacent pour la session ${sessionId}: ${err.message}`);
                }
            }
            // TODO: Nettoyer les listeners ou connexions IPC si présents
            logger.info(`Session ${sessionId} fermée avec succès.`);
        } catch (error) {
            logger.error(`Erreur lors de la fermeture de la session ${sessionId}:`, error);
            // Ne pas propager l'erreur pour permettre la fermeture d'autres sessions
        }
    });
}
/**
 * Restarts the browser session for a given sessionId.
 * Closes the current session and initializes a new one with the provided options.
 * @param {string} sessionId - The ID of the session to restart.
 * @param {object} options - The original Playwright launch options used for initialization.
 * @returns {Promise&lt;{context: import('playwright').BrowserContext, page: import('playwright').Page}&gt;} - The new context and page.
 * @throws {Error} If the restart fails.
 */
export async function restartBrowserSession(sessionId, options = {}) {
    // Ensure getLogger is available, assuming it's imported and initialized correctly
    const logger = await getLogger();
    logger.warn(`[BROWSER] [${sessionId}] Attempting to restart browser session due to an error.`);

    // Annulation des opérations en cours via AbortController
    await sessionMutex.runExclusive(async () => {
        const sessionData = activeSessions.get(sessionId);
        if (sessionData && sessionData.abortController && !sessionData.abortController.signal.aborted) {
            logger.info(`[BROWSER] [${sessionId}] Appel de abort() sur AbortController avant fermeture du contexte.`);
            sessionData.abortController.abort();
        }
    });

    // Validate options
    try {
        validateBrowserSessionOptions(options);
    } catch (validationErr) {
        logger.error(`[BROWSER] [${sessionId}] Invalid options provided for restart: ${validationErr.message}`, { options, stack: validationErr.stack });
        throw validationErr;
    }

    let contextToClose = null;
    let browserToClose = null;

    // Step 1: Atomically mark session for closure and remove from map
    await sessionMutex.runExclusive(async () => {
        const sessionData = activeSessions.get(sessionId);
        if (sessionData && sessionData.context) {
            logger.info(`[BROWSER] [${sessionId}] Preparing to close existing session (inside mutex)...`);
            contextToClose = sessionData.context; // Store context ref
            if (sessionData.inactivityTimer) clearTimeout(sessionData.inactivityTimer);
            if (sessionData.sessionTimer) clearTimeout(sessionData.sessionTimer);
            activeSessions.delete(sessionId); // Remove from map
            logger.debug(`[BROWSER] [${sessionId}] Session marked for closure and removed from map.`);
        } else {
             logger.warn(`[BROWSER] [${sessionId}] No active session found to close during restart request (inside mutex).`);
        }
    }); // Mutex released

    // Step 2: Close the context and browser outside the mutex
    if (contextToClose) {
        logger.info(`[BROWSER] [${sessionId}] Closing context and browser (outside mutex)...`);
        try {
            browserToClose = contextToClose.browser(); // Get browser instance before closing context
            await contextToClose.close();
            logger.debug(`[BROWSER] [${sessionId}] Context closed successfully.`);
            if (browserToClose && typeof browserToClose.close === 'function') {
                await browserToClose.close();
                logger.debug(`[BROWSER] [${sessionId}] Underlying browser process closed.`);
            }
        } catch (closeErr) {
             logger.error(`[BROWSER] [${sessionId}] Error closing Playwright context/browser during restart (outside mutex): ${closeErr.message}`, closeErr);
             // Consider if autoFix should be triggered here too
        }
    }

    // Step 3: Initialize the new session (handles its own locking)
    logger.info(`[BROWSER] [${sessionId}] Initializing new browser session...`);
    try {
        // Ensure initializeBrowserSession is correctly called and awaited
        const newSession = await initializeBrowserSession(sessionId, options);
        // Attente explicite de stabilité de la page après redémarrage
        const { page } = newSession;
        const sessionData = activeSessions.get(sessionId);
        const signal = sessionData && sessionData.abortController ? sessionData.abortController.signal : undefined;
        if (page) {
            await page.waitForLoadState('domcontentloaded');
            await page.waitForLoadState('networkidle', { signal });
        }
        logger.info(`[BROWSER] [${sessionId}] Browser session restarted successfully.`);
        return newSession; // Return { context, page }
    } catch (initError) {
        logger.error(`[BROWSER] [${sessionId}] Failed to initialize new session during restart: ${initError.message}`, initError);
        logger.warn(`[BROWSER] [${sessionId}] Attempting auto-fix after failed restart initialization...`);
        await autoFixPlaywrightEnvironment(sessionId); // Attempt auto-fix
        // Rethrow the original initialization error after attempting fix
        throw new Error(`Failed to restart session ${sessionId} after auto-fix attempt: ${initError.message}`);
    }
}

/**
 * Ferme toutes les sessions de navigateur actives.
 */
export async function closeAllBrowserSessions() {
    const logger = await getLogger();
    logger.debug('Fermeture de toutes les sessions de navigateur actives...');
    const sessionsToClose = Array.from(activeSessions.keys());
    // Fermeture séquentielle protégée par le mutex pour éviter les accès concurrents
    for (const sessionId of sessionsToClose) {
        await closeBrowserSession(sessionId);
    }
    logger.info('Toutes les sessions ont été traitées pour fermeture.');
}

/**
 * Retourne la liste des ID des sessions actives.
 * @returns {string[]}
 */
export function getActiveSessionIds() {
    return Array.from(activeSessions.keys());
}


/**
 * Suspend toutes les actions critiques (timers) pour toutes les sessions actives.
 * Utilisé lors de l’inactivité ou de la veille.
 */
export async function suspendCriticalActions() {
    const logger = await getLogger();
    await sessionMutex.runExclusive(async () => {
        for (const [sessionId, sessionData] of activeSessions.entries()) {
            if (sessionData.suspended) continue;
            if (sessionData.inactivityTimer) {
                clearTimeout(sessionData.inactivityTimer);
                sessionData.inactivityTimer = null;
            }
            if (sessionData.sessionTimer) {
                clearTimeout(sessionData.sessionTimer);
                sessionData.sessionTimer = null;
            }
            sessionData.suspended = true;
            logger.info(`[BROWSER] [${sessionId}] Actions critiques suspendues (timers arrêtés).`);
        }
    });
}

/**
 * Reprend toutes les actions critiques (timers) pour toutes les sessions actives.
 * Utilisé lors de la reprise d’activité.
 */
export async function resumeCriticalActions() {
    const logger = await getLogger();
    await sessionMutex.runExclusive(async () => {
        for (const [sessionId, sessionData] of activeSessions.entries()) {
            if (!sessionData.suspended) continue;
            // Recréer les timers si besoin
            if (typeof sessionData.sessionDurationMs === 'number' && sessionData.sessionDurationMs > 0) {
                const now = Date.now();
                let elapsed = 0;
                if (sessionData.lastStartTimestamp) {
                    elapsed = now - sessionData.lastStartTimestamp;
                }
                const remaining = sessionData.sessionDurationMs - (sessionData.accumulatedTimeMs || 0) - elapsed;
                if (remaining > 0) {
                    sessionData.sessionTimer = setTimeout(async () => {
                        const logger = await getLogger();
                        logger.info(`[BROWSER] [${sessionId}] Durée de session atteinte (reprise). Fermeture automatique.`);
                        await closeBrowserSession(sessionId);
                    }, remaining);
                }
            }
            // Pas de relance automatique du timer d’inactivité ici (dépend du front)
            sessionData.suspended = false;
            logger.info(`[BROWSER] [${sessionId}] Actions critiques reprises (timers relancés si applicable).`);
        }
    });
}
// Gestion des signaux système pour fermeture propre des navigateurs Playwright
const handleSignal = async (signal) => {
    const logger = await getLogger();
    try {
        logger.info(`[SIGNAL] Signal ${signal} reçu. Fermeture propre des sessions navigateur...`);
        await closeAllBrowserSessions();
        logger.info('[SIGNAL] Toutes les sessions navigateur ont été fermées. Arrêt du processus.');
    } catch (err) {
        logger.error(`[SIGNAL] Erreur lors de la fermeture des sessions navigateur : ${err.message}`);
    } finally {
        process.exit(0);
    }
};

process.on('SIGINT', () => handleSignal('SIGINT'));
process.on('SIGTERM', () => handleSignal('SIGTERM'));
// Suppression du bloc module.exports car les exports sont maintenant faits individuellement.
// --- Utilitaire pour obtenir le temps restant d'une session Playwright ---
/**
 * Retourne le temps restant (en ms) pour une session Playwright.
 * @param {string} sessionId
 * @returns {number|null} Temps restant en ms, ou null si durée inconnue
 */
export function getSessionRemainingTime(sessionId) {
    try { // Ajout d'un bloc try...catch global pour la robustesse
        let accumulatedTimeMs = 0;
        let sessionDurationMs = null;
        const sessionData = activeSessions.get(sessionId);

        // Lecture des données depuis activeSessions ou global.sessionTimes
        if (sessionData) {
            accumulatedTimeMs = Number(sessionData.accumulatedTimeMs) || 0; // Assurer que c'est un nombre
            if (sessionData.lastStartTimestamp && typeof sessionData.lastStartTimestamp === 'number') {
                 // Vérifier que Date.now() et lastStartTimestamp sont valides avant soustraction
                 const now = Date.now();
                 if (Number.isFinite(now) && Number.isFinite(sessionData.lastStartTimestamp)) {
                    accumulatedTimeMs += now - sessionData.lastStartTimestamp;
                 } else {
                     const logger = global.getLogger ? global.getLogger() : console;
                     logger.warn(`[BROWSER] [${sessionId}] Timestamp invalide détecté (now: ${now}, lastStart: ${sessionData.lastStartTimestamp})`);
                 }
            }
            sessionDurationMs = sessionData.sessionDurationMs; // Pas de || null ici pour détecter type invalide plus tard
        } else if (global.sessionTimes && global.sessionTimes.has(sessionId)) {
            const data = global.sessionTimes.get(sessionId);
            accumulatedTimeMs = Number(data.accumulatedTimeMs) || 0; // Assurer que c'est un nombre
            sessionDurationMs = data.sessionDurationMs;
        }

        // Validation plus stricte de sessionDurationMs
        if (typeof sessionDurationMs !== 'number' || !Number.isFinite(sessionDurationMs)) {
            // Ne pas logguer d'erreur ici si c'est juste null/undefined, c'est un cas normal (pas de durée)
            if (sessionDurationMs !== null && sessionDurationMs !== undefined) {
                const logger = global.getLogger ? global.getLogger() : console;
                logger.warn(`[BROWSER] [${sessionId}] sessionDurationMs invalide dans getSessionRemainingTime: ${sessionDurationMs} (type: ${typeof sessionDurationMs}). Retourne null.`);
            }
            return null; // Pas de durée définie ou invalide
        }

        // Validation des bornes
        if (sessionDurationMs < 0 || sessionDurationMs > Number.MAX_SAFE_INTEGER) {
            const logger = global.getLogger ? global.getLogger() : console;
            logger.warn(`[BROWSER] [${sessionId}] sessionDurationMs hors bornes dans getSessionRemainingTime: ${sessionDurationMs}. Retourne null.`);
            return null;
        }

        // Validation de accumulatedTimeMs (doit être un nombre fini)
        if (typeof accumulatedTimeMs !== 'number' || !Number.isFinite(accumulatedTimeMs)) {
             const logger = global.getLogger ? global.getLogger() : console;
             logger.warn(`[BROWSER] [${sessionId}] accumulatedTimeMs invalide: ${accumulatedTimeMs} (type: ${typeof accumulatedTimeMs}). Utilisation de 0.`);
             accumulatedTimeMs = 0;
        }


        const remaining = sessionDurationMs - accumulatedTimeMs;

        // Validation finale du résultat
        if (!Number.isFinite(remaining)) {
            const logger = global.getLogger ? global.getLogger() : console;
            logger.warn(`[BROWSER] [${sessionId}] Calcul du temps restant invalide (résultat non fini): ${remaining}. Retourne 0.`);
            return 0; // Retourner 0 en cas de calcul invalide
        }

        return remaining > 0 ? remaining : 0;

    } catch (error) {
        // Intercepter toute erreur inattendue dans la fonction
        const logger = global.getLogger ? global.getLogger() : console;
        logger.error(`[BROWSER] [${sessionId}] Erreur inattendue dans getSessionRemainingTime: ${error.message}`, error.stack);
        return null; // Retourner null en cas d'erreur pour ne pas planter la route /accounts
    }
}