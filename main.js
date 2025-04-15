// 1. Importations
import logger from './src/logger.js';
import { initializeBrowser, closeBrowser } from './src/browser_manager.js';
import { login } from './src/auth_handler.js';
import { solveSingleExercise } from './src/solver_engine.js';
import { solvePopup } from './src/popup_solver.js';
import config from './src/config_loader.js';

// --- Fonctions utilitaires internes ---
/**
 * Vérifie la présence du popup d'entraînement intensif et le résout si présent.
 * @param {import('playwright').Page} page 
 * @param {string} popupSelector 
 * @param {number} timeout 
 */
async function checkAndSolvePopup(page, popupSelector, timeout) {
    try {
        const isPopupVisible = await page.locator(popupSelector).isVisible({ timeout });
        if (isPopupVisible) {
            logger.info('Popup d\'entraînement intensif détecté. Lancement de solvePopup...');
            await solvePopup(page);
            logger.info('solvePopup terminé.');
            return true;
        }
    } catch (error) {
        logger.debug(`Popup non détecté ou timeout (${popupSelector}): ${error.message}`);
    }
    return false;
}

/**
 * Sélectionne et clique sur le prochain exercice à traiter.
 * @param {import('playwright').Page} page 
 * @returns {Promise<boolean>} true si un exercice a été sélectionné, false sinon
 */
async function selectNextExercise(page) {
    const nextExerciseSelector = '.unit.orange';
    const inProgressSelector = 'div.activity-selector-cell.inProgress, div.validation-activity-cell.inProgress';

    // Chercher l'exercice "orange"
    let locator = page.locator(nextExerciseSelector).first();
    try {
        if (await locator.isVisible({ timeout: 5000 })) {
            logger.info('Exercice suivant (orange) trouvé.');
            await locator.click();
            return true;
        }
    } catch { /* Ignoré, on tente l'autre sélecteur */ }

    // Chercher l'exercice "en cours"
    locator = page.locator(inProgressSelector).first();
    try {
        if (await locator.isVisible({ timeout: 5000 })) {
            logger.info('Exercice en cours trouvé.');
            await locator.click();
            return true;
        }
    } catch { /* Ignoré, aucun exercice trouvé */ }

    logger.info('Aucun exercice orange ou en cours trouvé. Fin de la boucle principale.');
    return false;
}

// 2. Fonction Principale Asynchrone
async function runBot() {
    let browserInstance = null;
    logger.info('Démarrage du bot Projet Voltaire...');

    try {
        logger.info('Initialisation du navigateur...');
        const { browser, page } = await initializeBrowser({ headless: false });
        browserInstance = browser;
        logger.info('Navigateur initialisé avec succès.');

        logger.info('Tentative de connexion...');
        const loginResult = await login(page);

        if (!loginResult.success) {
            logger.error(`Échec de la connexion: ${loginResult.message || 'Raison inconnue'}`);
            throw new Error('Échec de la connexion');
        }
        logger.info('Connexion réussie.');

        const popupSelector = '.popupContent .intensiveTraining';
        const popupCheckTimeout = 3000;

        mainLoop: while (true) {
            logger.info('Début de la boucle principale: Recherche du prochain exercice...');

            // Sélection et clic sur l'exercice à traiter
            try {
                const found = await selectNextExercise(page);
                if (!found) break mainLoop;
            } catch (error) {
                logger.error(`Erreur lors de la sélection de l'exercice: ${error.message}`);
                break mainLoop;
            }

            // Attente après le clic
            await page.waitForTimeout(config.MIN_ACTION_DELAY + Math.random() * (config.MAX_ACTION_DELAY - config.MIN_ACTION_DELAY));

            // Vérification du popup (avant l'exercice)
            await checkAndSolvePopup(page, popupSelector, popupCheckTimeout);

            // Boucle interne pour résoudre les étapes de l'exercice
            logger.info('Démarrage de la boucle interne pour résoudre les étapes de l\'exercice...');
            innerLoop: while (true) {
                // Vérification du popup (pendant l'exercice)
                await checkAndSolvePopup(page, popupSelector, popupCheckTimeout);

                // Résolution de l'étape
                logger.info('Lancement de solveSingleExercise...');
                const solveResult = await solveSingleExercise(page);

                if (!solveResult.success) {
                    logger.error(`Échec de la résolution d'une étape: ${solveResult.error || 'Erreur inconnue'}. Arrêt du bot.`);
                    break mainLoop;
                }

                if (solveResult.exerciseComplete) {
                    logger.info('L\'exercice est marqué comme terminé par solveSingleExercise.');
                    break innerLoop;
                }

                logger.info('Étape résolue avec succès. Passage à l\'étape suivante de l\'exercice...');
                await page.waitForTimeout(500 + Math.random() * 500);
            }

            logger.info('Fin de la boucle interne (exercice terminé). Recherche du prochain exercice...');
            await page.waitForTimeout(1000 + Math.random() * 1000);
        }

        logger.info('Toutes les opérations sont terminées (boucle principale achevée).');
    } catch (error) {
        logger.error('Une erreur critique est survenue dans le flux principal:', error);
    } finally {
        if (browserInstance) {
            logger.info('Fermeture du navigateur...');
            await closeBrowser(browserInstance);
            logger.info('Navigateur fermé.');
        }
        logger.info('Arrêt du bot.');
    }
}

// 3. Exécution
runBot();