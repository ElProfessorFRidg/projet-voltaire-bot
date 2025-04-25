// src/browser_manager.js

import playwright from 'playwright';
import path from 'path';
import fs from 'fs/promises'; // Utilisation de fs.promises pour async/await
import logger from './logger.js'; // Assurez-vous que le logger est disponible et utilisez l'extension .js pour les imports relatifs en ESM

// En ES Modules, __dirname n'est pas disponible par défaut. Utilisons import.meta.url.
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROFILES_DIR = path.join(__dirname, '..', 'user_profiles'); // Répertoire pour stocker les profils

// Map pour stocker les sessions actives: sessionId -> { browser, context, page }
const activeSessions = new Map();

/**
 * Assure que le répertoire des profils existe.
 */
async function ensureProfilesDirExists() {
    try {
        await fs.mkdir(PROFILES_DIR, { recursive: true });
        logger.debug(`Répertoire des profils assuré : ${PROFILES_DIR}`);
    } catch (error) {
        logger.error(`Impossible de créer le répertoire des profils : ${PROFILES_DIR}`, error);
        throw new Error(`Failed to create profiles directory: ${error.message}`);
    }
}

/**
 * Initialise une instance de navigateur Playwright isolée pour une session donnée.
 * @param {string} sessionId - Un identifiant unique pour la session (ex: 'account_1').
 * @param {object} options - Options de lancement pour Playwright (ex: { headless: false }).
 * @returns {Promise<{browser: import('playwright').Browser, context: import('playwright').BrowserContext, page: import('playwright').Page}>}
 */
export async function initializeBrowserSession(sessionId, options = {}) {
    if (activeSessions.has(sessionId)) {
        logger.warn(`Session ${sessionId} déjà initialisée. Retour de l'instance existante.`);
        return activeSessions.get(sessionId);
    }

    await ensureProfilesDirExists(); // S'assurer que le répertoire parent existe

    // Log du contenu du dossier profil avant lancement
    const userDataDir = path.join(PROFILES_DIR, sessionId);
    // Log du contenu du dossier profil avant lancement
    try {
        const files = await fs.readdir(userDataDir);
        logger.debug(`Contenu du dossier profil ${userDataDir}: ${files.join(', ')}`);
    } catch (e) {
        logger.warn(`Impossible de lire le contenu du dossier profil ${userDataDir}: ${e.message}`);
    }
    logger.info(`Initialisation de la session ${sessionId} avec le profil : ${userDataDir}`);

    let browser;
    try {
        // Options pour launchPersistentContext, sans userDataDir car c'est le premier argument
        const launchOptions = {
            ...options,
            // userDataDir est passé comme premier argument à launchPersistentContext
        };
        // Utilisation de launchPersistentContext pour gérer le profil utilisateur
        logger.debug(`launchPersistentContext: userDataDir=${userDataDir}, options=${JSON.stringify(launchOptions)}`);
        const context = await playwright.chromium.launchPersistentContext(userDataDir, launchOptions);
        if (!context) throw new Error('Échec du lancement du contexte persistant.');

        // Le navigateur est accessible via le contexte persistant
        const page = await context.newPage();
        if (!page) throw new Error('Échec de la création de la page.');

        const sessionData = { context, page };
        activeSessions.set(sessionId, sessionData);
        logger.info(`Session ${sessionId} initialisée avec succès.`);
        return sessionData;

    } catch (error) {
        logger.error(`Erreur lors de l'initialisation de la session ${sessionId}:`, error);
        if (browser) {
            // Tentative de fermeture si le navigateur a été lancé mais autre chose a échoué
            await closeBrowserSession(sessionId); // Utilise la nouvelle fonction pour nettoyer
        }
        // Relance l'erreur pour que l'appelant sache que ça a échoué
        throw new Error(`Erreur lors de l'initialisation de la session ${sessionId}: ${error.message}`);
    }
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
    const sessionData = activeSessions.get(sessionId);
    if (!sessionData || !sessionData.browser) {
        logger.warn(`Tentative de fermeture d'une session inexistante ou déjà fermée : ${sessionId}`);
        return;
    }

    logger.info(`Fermeture de la session ${sessionId}...`);
    try {
        // Tenter de fermer le contexte d'abord peut être plus propre dans certains cas
        if (sessionData.context && typeof sessionData.context.close === 'function') {
             await sessionData.context.close();
        }
        // Ensuite fermer le navigateur principal
        if (typeof sessionData.browser.close === 'function') {
            await sessionData.browser.close();
        }
        logger.info(`Session ${sessionId} fermée avec succès.`);
    } catch (error) {
        logger.error(`Erreur lors de la fermeture de la session ${sessionId}:`, error);
        // Ne pas propager l'erreur pour permettre la fermeture d'autres sessions
    } finally {
        // Supprimer la session de la map même en cas d'erreur de fermeture
        activeSessions.delete(sessionId);
    }
}

/**
 * Ferme toutes les sessions de navigateur actives.
 */
export async function closeAllBrowserSessions() {
    logger.info('Fermeture de toutes les sessions de navigateur actives...');
    const sessionsToClose = Array.from(activeSessions.keys());
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


// Suppression du bloc module.exports car les exports sont maintenant faits individuellement.