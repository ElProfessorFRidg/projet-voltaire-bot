// 1. Importations
import logger from './src/logger.js';
import { initializeBrowser, closeBrowser } from './src/browser_manager.js';
import { login } from './src/auth_handler.js';
import { solveSingleExercise } from './src/solver_engine.js';
import { solvePopup } from './src/popup_solver.js';
import config from './src/config_loader.js';
import { spawn } from 'child_process';

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
 * Sélectionne et clique sur le prochain exercice disponible basé sur les classes
 * 'readyToRun' ou 'unit orange'.
 * @param {import('playwright').Page} page
 * @returns {Promise<boolean>} true si un exercice a été cliqué, false sinon
 */
async function selectNextExercise(page) {
    // Sélecteur simplifié ciblant directement les cellules prêtes ou oranges
    // Priorise 'readyToRun' puis 'unit orange'
    const nextExerciseCellSelector = `
        .validation-activity-cell.readyToRun, 
        .activity-selector-cell.readyToRun, 
        .activity-selector-cell.unit.orange
    `;
    // Sélecteur pour les boutons "Lancer" à l'intérieur de la cellule cible
    const launchButtonSelector = 'button.activity-selector-cell-launch-button, button.validation-activity-cell-launch-button';

    logger.info('Recherche du prochain exercice à lancer (readyToRun ou orange)...');

    try {
        // Localiser la première cellule correspondant aux critères
        const targetCell = page.locator(nextExerciseCellSelector).first();

        // Attendre que la cellule soit visible
        await targetCell.waitFor({ state: 'visible', timeout: 15000 });
        logger.info('Cellule d\'exercice prête ou orange trouvée et visible.');

        // Localiser le bouton "Lancer" à l'intérieur de cette cellule
        const launchButton = targetCell.locator(launchButtonSelector);

        // Vérifier si le bouton "Lancer" est visible et cliquer dessus en priorité
        if (await launchButton.isVisible({ timeout: 1000 })) {
            logger.info('Bouton "Lancer" trouvé dans la cellule. Clic...');
            await launchButton.click();
        } else {
            // Si le bouton n'est pas visible (cas improbable si la cellule est prête),
            // cliquer sur la cellule elle-même comme fallback.
            logger.warn('Bouton "Lancer" non visible dans la cellule prête/orange. Tentative de clic sur la cellule principale.');
            await targetCell.click({ timeout: 5000 });
        }

        logger.info('Clic effectué avec succès sur l\'exercice.');
        return true;

    } catch (error) {
        // Gérer les erreurs (élément non trouvé, non visible, non cliquable après timeout)
        if (error.name === 'TimeoutError') {
            logger.info('Aucune cellule d\'exercice prête ou orange n\'a été trouvée ou n\'est devenue visible dans les délais.');
        } else {
            logger.error(`Erreur lors de la tentative de sélection/clic sur l'exercice: ${error.message}`);
        }
        return false;
    }
}

// 2. Fonction Principale Asynchrone
async function runBot() {
    let browserInstance = null;
    let restartRequested = false;
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
            logger.info('Début de la boucle principale: Recherche ou attente de l\'exercice...');

            // Tentative de sélection et clic sur l'exercice à traiter
            let exerciseSelectedAutomatically = false;
            try {
                exerciseSelectedAutomatically = await selectNextExercise(page);
                if (exerciseSelectedAutomatically) {
                    logger.info("Exercice sélectionné et cliqué automatiquement.");
                    // Attente après le clic automatique
                    await page.waitForTimeout(config.MIN_ACTION_DELAY + Math.random() * (config.MAX_ACTION_DELAY - config.MIN_ACTION_DELAY));
                } else {
                    // Si selectNextExercise retourne false (timeout ou autre erreur interne gérée)
                    logger.info("Aucun exercice n'a pu être sélectionné automatiquement. Poursuite en supposant une action manuelle ou que l'exercice est déjà en cours...");
                    // On ne quitte PAS la boucle ici, on continue comme si l'utilisateur pouvait cliquer.
                    await page.waitForTimeout(1000); // Petite pause
                }
            } catch (error) {
                // Ce catch est une sécurité supplémentaire si selectNextExercise levait une erreur non prévue
                logger.error(`Erreur inattendue lors de la tentative de sélection de l'exercice: ${error.message}`);
                logger.info("Poursuite malgré l'erreur de sélection...");
                // On continue quand même
            }


            // Vérification du popup (avant ou pendant l'exercice)
            await checkAndSolvePopup(page, popupSelector, popupCheckTimeout);

            // Boucle interne pour résoudre les étapes de l'exercice (qu'il ait été sélectionné auto ou manuellement)
            logger.info('Tentative de résolution d\'un exercice...');
            innerLoop: while (true) {
                // Vérification du popup (pendant l'exercice)
                await checkAndSolvePopup(page, popupSelector, popupCheckTimeout);

                // Résolution de l'étape
                logger.info('Lancement de solveSingleExercise...');
                const solveResult = await solveSingleExercise(page);

                if (solveResult.restartBrowser) {
                    logger.error('Redémarrage automatique demandé par solveSingleExercise.');
                    restartRequested = true;
                    break mainLoop; // Quitte la boucle principale pour redémarrer
                }

                // Si la résolution échoue (peut-être pas sur une page d'exercice)
                if (!solveResult.success) {
                    logger.warn(`Échec de la résolution d'une étape (ou pas sur une page d'exercice?): ${solveResult.error || 'Erreur inconnue'}. Retour à la sélection d'exercice.`);
                    // On sort de la boucle interne pour retenter une sélection au prochain tour de la boucle principale
                    break innerLoop;
                }

                // Si l'exercice est terminé
                if (solveResult.exerciseComplete) {
                    logger.info('L\'exercice est marqué comme terminé par solveSingleExercise.');
                    // On sort de la boucle interne pour chercher le prochain exercice
                    break innerLoop;
                }

                // Si une étape a été résolue avec succès mais l'exercice n'est pas fini
                logger.info('Étape résolue avec succès. Passage à l\'étape suivante de l\'exercice...');
                await page.waitForTimeout(500 + Math.random() * 500); // Pause entre les étapes
            } // Fin innerLoop

            // Après la fin de l'innerLoop (exercice terminé ou échec de résolution)
            logger.info('Fin de la tentative de résolution. Retour à la sélection/attente...');
            await page.waitForTimeout(1000 + Math.random() * 1000); // Pause avant la prochaine itération de la boucle principale

        } // Fin mainLoop

        logger.info('Sortie de la boucle principale (normalement via demande de redémarrage).');

    } catch (error) {
        logger.error('Une erreur critique est survenue dans le flux principal:', error);
    } finally {
        if (browserInstance && !restartRequested) {
            logger.info('Fermeture du navigateur...');
            await closeBrowser(browserInstance);
            logger.info('Navigateur fermé.');
        }
        if (restartRequested) {
            logger.info('Relance automatique du bot avec node main.js...');
            spawn(process.argv[0], [process.argv[1]], {
                stdio: 'inherit',
                detached: true
            });
            process.exit(0);
        }
        logger.info('Arrêt du bot.');
    }
}

// 3. Exécution
runBot();