// src/browser_manager.js

import playwright from 'playwright';
import path from 'path';
import fs from 'fs/promises'; // Utilisation de fs.promises pour async/await
import logger from './logger.js'; // Assurez-vous que le logger est disponible et utilisez l'extension .js pour les imports relatifs en ESM
import { Mutex, Semaphore } from './async_utils.js'; // Ajout pour la gestion de la concurrence

// En ES Modules, __dirname n'est pas disponible par défaut. Utilisons import.meta.url.
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROFILES_DIR = path.join(__dirname, '..', 'user_profiles'); // Répertoire pour stocker les profils

// Map pour stocker les sessions actives: sessionId -> { browser, context, page }
const activeSessions = new Map();

// Sémaphore pour limiter le nombre de ses
// sions navigateur simultanées (ex : 4)
const sessionSemaphore = new Semaphore(4);

// Mutex global pour protéger l'accès aux sessions et aux ressources critiques
const sessionMutex = new Mutex();

/**
 * Assure que le répertoire des profils existe.
 */
async function ensureProfilesDirExists() {
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
 */
export async function initializeBrowserSession(sessionId, options = {}) {
    logger.info(`[BROWSER] Initialisation de la session navigateur pour ${sessionId}`);
    // Limitation du nombre de sessions simultanées via le sémaphore
    return await sessionSemaphore.runExclusive(async () => {
        let sessionData;
        let mutexReleased = false;
        // 1. Vérification atomique de l'existence de la session (mutex)
        try {
            await sessionMutex.runExclusive(() => {
                if (activeSessions.has(sessionId)) {
                    logger.warn(`[BROWSER] Session ${sessionId} déjà initialisée. Retour de l'instance existante.`);
                    sessionData = activeSessions.get(sessionId);
                }
            });
            if (sessionData) return sessionData;
        } catch (err) {
            logger.error(`[BROWSER] ERREUR lors de la vérification atomique de la session ${sessionId} : ${err.message}\nSTACK: ${err.stack}`);
            throw err;
        }

        // 2. S'assurer que le dossier des profils existe (hors mutex)
        try {
            await ensureProfilesDirExists();
        } catch (err) {
            logger.error(`[BROWSER] [${sessionId}] ERREUR ensureProfilesDirExists: ${err.message}\nSTACK: ${err.stack}`);
            throw err;
        }

        // 3. Création du dossier userDataDir pour la session si besoin (hors mutex)
        const userDataDir = path.join(PROFILES_DIR, sessionId);
        try {
            await fs.mkdir(userDataDir, { recursive: true });
            logger.debug(`[BROWSER] [${sessionId}] Dossier profil utilisateur prêt : ${userDataDir}`);
        } catch (e) {
            logger.error(`[BROWSER] [${sessionId}] ERREUR création userDataDir: ${e.message}\nSTACK: ${e.stack}`);
            throw new Error(`Impossible de créer le dossier profil utilisateur pour la session ${sessionId} : ${e.message}`);
        }

        // 4. Log du contenu du dossier profil (hors mutex)
        try {
            const files = await fs.readdir(userDataDir);
            logger.debug(`[BROWSER] [${sessionId}] Contenu du dossier profil ${userDataDir}: ${files.join(', ')}`);
        } catch (e) {
            logger.warn(`[BROWSER] [${sessionId}] Impossible de lire le contenu du dossier profil ${userDataDir}: ${e.message}\nSTACK: ${e.stack}`);
        }

        // 5. Lancement du navigateur Playwright et création de la page
        let context, page;
        try {
            const launchOptions = { ...options };
            logger.debug(`[BROWSER] [${sessionId}] Lancement de launchPersistentContext: userDataDir=${userDataDir}, options=${JSON.stringify(launchOptions)}`);
            context = await playwright.chromium.launchPersistentContext(userDataDir, launchOptions);
            if (!context) throw new Error('Échec du lancement du contexte persistant.');
            logger.debug(`[BROWSER] [${sessionId}] Contexte persistant lancé.`);

            page = await context.newPage();
            if (!page) throw new Error('Échec de la création de la page.');
            logger.debug(`[BROWSER] [${sessionId}] Page créée avec succès.`);
        } catch (error) {
            logger.error(`[BROWSER] [${sessionId}] ERREUR lors du lancement du navigateur ou de la page: ${error.message}\nSTACK: ${error.stack}`);
            // Nettoyage si besoin
            try {
                if (context && typeof context.close === 'function') {
                    await context.close();
                    logger.debug(`[BROWSER] [${sessionId}] Contexte Playwright fermé après échec.`);
                }
            } catch (cleanupErr) {
                logger.error(`[BROWSER] [${sessionId}] ERREUR lors du nettoyage du contexte après échec: ${cleanupErr.message}\nSTACK: ${cleanupErr.stack}`);
            }
            throw new Error(`Erreur lors de l'initialisation de la session ${sessionId}: ${error.message}`);
        }

        // 6. Enregistrement atomique de la session (mutex)
        try {
            await sessionMutex.runExclusive(() => {
                activeSessions.set(sessionId, { context, page });
            });
        } catch (err) {
            logger.error(`[BROWSER] [${sessionId}] ERREUR lors de l'enregistrement atomique de la session: ${err.message}\nSTACK: ${err.stack}`);
            // Nettoyage si besoin
            try {
                if (context && typeof context.close === 'function') {
                    await context.close();
                    logger.debug(`[BROWSER] [${sessionId}] Contexte Playwright fermé après échec d'enregistrement.`);
                }
            } catch (cleanupErr) {
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

/**
 * Ferme proprement l'instance du navigateur pour une session spécifique.
 * @param {string} sessionId - L'identifiant de la session à fermer.
 */
export async function closeBrowserSession(sessionId) {
    // Protection de la fermeture de session par le mutex
    await sessionMutex.runExclusive(async () => {
        const sessionData = activeSessions.get(sessionId);
        if (!sessionData || !sessionData.context) {
            logger.warn(`Tentative de fermeture d'une session inexistante ou déjà fermée : ${sessionId}`);
            return;
        }

        logger.debug(`Fermeture de la session ${sessionId}...`);
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
                        logger.debug(`Browser process for session ${sessionId} closed.`);
                    }
                } catch (err) {
                    logger.warn(`Impossible de fermer le browser sous-jacent pour la session ${sessionId}: ${err.message}`);
                }
            }
            logger.info(`Session ${sessionId} fermée avec succès.`);
        } catch (error) {
            logger.error(`Erreur lors de la fermeture de la session ${sessionId}:`, error);
            // Ne pas propager l'erreur pour permettre la fermeture d'autres sessions
        }
    });
}

/**
 * Ferme toutes les sessions de navigateur actives.
 */
export async function closeAllBrowserSessions() {
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


// Gestion des signaux système pour fermeture propre des navigateurs Playwright
const handleSignal = async (signal) => {
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