// 1. Importations
import logger from './src/logger.js';
import { initializeBrowser, closeBrowser } from './src/browser_manager.js';
import { login } from './src/auth_handler.js';
import { solveSingleExercise } from './src/solver_engine.js';
import { randomDelay } from './src/human_simulator.js';
import { solvePopup } from './src/popup_solver.js';
import config from './src/config_loader.js'; // Importer la config

// 2. Fonction Principale Asynchrone
async function runBot() {
    let browserInstance = null; // Déclarer en dehors pour accessibilité dans finally
    logger.info('Démarrage du bot Projet Voltaire...');

    try {
        // Initialisation
        logger.info('Initialisation du navigateur...');
        // Utiliser la configuration pour headless (exemple: config.BROWSER_HEADLESS peut être true/false)
        // S'assurer que config_loader exporte une valeur utilisable, par ex. config.BROWSER_HEADLESS
        // Pour l'instant, on met false comme demandé explicitement.
        const { browser, page } = await initializeBrowser({ headless: false });
        browserInstance = browser; // Stocker l'instance pour le finally
        logger.info('Navigateur initialisé avec succès.');

        // Connexion
        logger.info('Tentative de connexion...');
        const loginResult = await login(page);

        if (!loginResult.success) {
            logger.error(`Échec de la connexion: ${loginResult.message || 'Raison inconnue'}`);
            // On pourrait lancer une erreur ou simplement logger et continuer vers finally
            throw new Error('Échec de la connexion');
        }
        logger.info('Connexion réussie.');

        // Selector for the intensive training popup
        const popupSelector = '.popupContent .intensiveTraining';
        const popupCheckTimeout = 3000; // Timeout court pour vérifier la présence du popup (en ms)

        // Boucle principale: Gère les exercices un par un
        mainLoop: while (true) {
            logger.info('Début de la boucle principale: Recherche du prochain exercice...');

            let currentExerciseLocator = null;
            // Sélecteur pour l'exercice suivant/en attente (orange). Ajuster si nécessaire.
            const nextExerciseSelector = '.unit.orange'; // Basé sur la suggestion précédente
            const inProgressSelector = 'div.activity-selector-cell.inProgress, div.validation-activity-cell.inProgress';

            try {
                // 1. Chercher l'exercice "orange" (priorité)
                logger.debug(`Recherche de l'exercice suivant avec le sélecteur: ${nextExerciseSelector}`);
                currentExerciseLocator = page.locator(nextExerciseSelector).first(); // Prendre le premier s'il y en a plusieurs
                const isNextVisible = await currentExerciseLocator.isVisible({ timeout: 5000 }); // Attente courte

                if (isNextVisible) {
                    logger.info('Exercice suivant (orange) trouvé.');
                } else {
                    // 2. Si pas d'orange, chercher l'exercice "en cours" (pour le premier lancement ou reprise)
                    logger.info(`Aucun exercice orange trouvé. Recherche de l'exercice en cours avec le sélecteur: ${inProgressSelector}`);
                    currentExerciseLocator = page.locator(inProgressSelector).first();
                    const isInProgressVisible = await currentExerciseLocator.isVisible({ timeout: 5000 });
                    if (isInProgressVisible) {
                        logger.info('Exercice en cours trouvé.');
                    } else {
                        // 3. Si aucun exercice orange ou en cours n'est trouvé, on suppose qu'il n'y a plus rien à faire.
                        logger.info('Aucun exercice orange ou en cours trouvé. Fin de la boucle principale.');
                        break mainLoop; // Sortir de la boucle principale
                    }
                }

                // Cliquer sur l'exercice trouvé
                logger.info('Clic sur l\'exercice trouvé...');
                await currentExerciseLocator.click();
                logger.info('Clic effectué. Attente du chargement...');
                // Attendre un peu que la page se charge après le clic
                await page.waitForTimeout(config.MIN_ACTION_DELAY + Math.random() * (config.MAX_ACTION_DELAY - config.MIN_ACTION_DELAY));

                // --- Vérification Popup (Appel 1) ---
                logger.debug(`Vérification de la présence du popup (${popupSelector}) avec timeout de ${popupCheckTimeout}ms...`);
                try {
                    const isPopupVisible = await page.locator(popupSelector).isVisible({ timeout: popupCheckTimeout });
                    if (isPopupVisible) {
                        logger.info('Popup d\'entraînement intensif détecté. Lancement de solvePopup...');
                        await solvePopup(page);
                        logger.info('solvePopup terminé (appel 1).');
                    } else {
                        logger.info('Aucun popup d\'entraînement intensif détecté (appel 1). Passage à la suite.');
                    }
                } catch (error) {
                    // Gère le cas où le locator n'est pas trouvé dans le timeout (considéré comme non visible)
                    logger.info(`Aucun popup d'entraînement intensif détecté (timeout ou erreur lors de la vérification - appel 1): ${error.message}`);
                }
                // --- Fin Vérification Popup (Appel 1) ---

            } catch (error) {
                logger.error(`Impossible de trouver ou de cliquer sur le prochain exercice (${nextExerciseSelector} ou ${inProgressSelector}): ${error.message}`);
                logger.info('Arrêt du bot car aucun exercice actif/suivant n\'a pu être sélectionné.');
                break mainLoop; // Sortir de la boucle principale en cas d'erreur de sélection
            }

            // Boucle interne: Gère les étapes d'un même exercice
            logger.info('Démarrage de la boucle interne pour résoudre les étapes de l\'exercice...');
            innerLoop: while(true) {

                // --- Vérification Popup (Appel 2) ---
                logger.debug(`Vérification de la présence du popup (${popupSelector}) avec timeout de ${popupCheckTimeout}ms...`);
                 try {
                    const isPopupVisible = await page.locator(popupSelector).isVisible({ timeout: popupCheckTimeout });
                    if (isPopupVisible) {
                        logger.info('Popup d\'entraînement intensif détecté. Lancement de solvePopup...');
                        await solvePopup(page);
                        logger.info('solvePopup terminé (appel 2).');
                    } else {
                        logger.info('Aucun popup d\'entraînement intensif détecté (appel 2). Passage à solveSingleExercise.');
                    }
                } catch (error) {
                    // Gère le cas où le locator n'est pas trouvé dans le timeout (considéré comme non visible)
                    logger.info(`Aucun popup d'entraînement intensif détecté (timeout ou erreur lors de la vérification - appel 2): ${error.message}`);
                }
                // --- Fin Vérification Popup (Appel 2) ---

                // Résoudre l'étape actuelle de l'exercice
                logger.info('Lancement de solveSingleExercise...');
                const solveResult = await solveSingleExercise(page);

                if (!solveResult.success) {
                    logger.error(`Échec de la résolution d'une étape: ${solveResult.error || 'Erreur inconnue'}. Arrêt du bot.`);
                    break mainLoop; // Sortir de la boucle principale en cas d'échec de résolution
                }

                if (solveResult.exerciseComplete) {
                    logger.info('L\'exercice est marqué comme terminé par solveSingleExercise.');
                    break innerLoop; // Sortir de la boucle interne pour passer à l'exercice suivant
                }

                // Si success: true et exerciseComplete: false, on continue la boucle interne
                logger.info('Étape résolue avec succès. Passage à l\'étape suivante de l\'exercice...');
                // Ajout d'un petit délai avant de reboucler pour la prochaine étape
                await page.waitForTimeout(500 + Math.random() * 500);

            } // Fin boucle interne

            logger.info('Fin de la boucle interne (exercice terminé). Recherche du prochain exercice...');
            // Ajout d'un délai avant de chercher le prochain exercice
             await page.waitForTimeout(1000 + Math.random() * 1000);

        } // Fin boucle principale

        logger.info('Toutes les opérations sont terminées (boucle principale achevée).');

    } catch (error) {
        logger.error('Une erreur critique est survenue dans le flux principal:', error);
        // L'erreur sera logguée, et le finally s'exécutera quand même.
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