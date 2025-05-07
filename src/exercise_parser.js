/**
 * Ce module utilise l’API asynchrone du logger.
 * Pour chaque fonction asynchrone ou callback, obtenir l’instance du logger via :
 *   const logger = await getLogger();
 * avant chaque utilisation (info, error, warn, debug, etc.).
 * Voir ./logger.js pour l’implémentation.
 */
// src/exercise_parser.js
import getLogger from './logger.js';
import selectors from './selectors.js';
import { ElementNotFoundError } from './error_utils.js'; // Import the custom error
import { isOverlayBlocking, waitForOverlayToDisappear } from './utils/overlay_utils.js'; // Ajout pour la gestion des overlays
 
 /**
 * Correction : les sélecteurs CSS sont désormais centralisés dans src/selectors.js
 * pour éviter les duplications et faciliter la maintenance.
 */

/**
 * Analyse la page d'un exercice pour en extraire les informations pertinentes.
 * @param {import('playwright').Page} page - L'objet Page de Playwright représentant la page de l'exercice.
 * @returns {Promise<object>} Un objet contenant les données extraites ou une erreur.
 */
async function parseExercise(page) {
    const logger = await getLogger();
    // logger.info('Début de l\'analyse de l\'exercice...');

    try {
        // logger.debug('Tentative d\'extraction du texte de la question...');
 
        // Gérer les overlays avant de parser
        if (await isOverlayBlocking(page)) {
            logger.warn(`[parseExercise] Overlay bloquant détecté avant le parsing de l'exercice. Attente de disparition...`);
            const overlayGone = await waitForOverlayToDisappear(page, 10000); // Timeout de 10s pour l'overlay
            if (!overlayGone) {
                logger.error(`[parseExercise] Parsing bloqué par overlay persistant. Échec du parsing.`);
                return { success: false, error: 'Parsing blocked by persistent overlay.' };
            }
            logger.info(`[parseExercise] Overlay disparu, reprise du parsing.`);
        }
 
        // Attendre que l'élément de la question soit présent
        await page.waitForSelector(selectors.sentence, { timeout: 10000 });
 
        // Extraire le texte de la question
        const questionText = await page.locator(selectors.sentence).textContent();
        if (!questionText || !questionText.trim()) {
            // Cas limite : texte vide ou non trouvé
            logger.error(`Le texte de la question est vide ou non trouvé pour le sélecteur ${selectors.sentence}`);
            return { success: false, error: 'Question text is empty or missing.' };
        }
        // logger.info(`Texte de la question extrait: ${questionText}`);

        let exerciseType = 'unknown';
        const exerciseData = {
            question: questionText,
            options: [],
            clickable_words: []
        };

        // Détection du type d'exercice et extraction des données spécifiques
        logger.debug('[parseExercise] Détection du type d\'exercice...');

        // 1. Tentative de détection QCM (Choix Multiples)
        const choiceOptionElements = await page.locator(selectors.choiceOptions).count();
        if (choiceOptionElements > 0) {
            logger.info(`[parseExercise] Type d'exercice détecté: QCM (basé sur ${choiceOptionElements} options trouvées avec le sélecteur ${selectors.choiceOptions})`);
            exerciseType = 'qcm';
            const labels = await page.locator(selectors.choiceLabels).allTextContents();
            if (labels && labels.length > 0) {
                exerciseData.options = labels.map(label => label.trim()).filter(label => label.length > 0);
                logger.debug(`[parseExercise] Options QCM extraites: ${JSON.stringify(exerciseData.options)}`);
            } else {
                logger.warn(`[parseExercise] QCM détecté mais aucun label d'option trouvé avec le sélecteur ${selectors.choiceLabels}.`);
            }
        }

        // 2. Tentative de détection "Pointer-Cliquer" (si pas déjà QCM)
        //    Un exercice peut avoir des mots cliquables même s'il n'est pas *que* de ce type.
        //    On extrait les mots cliquables dans tous les cas où ils sont présents.
        const clickableWordElements = await page.locator(selectors.pointAndClickSpan).count();
        if (clickableWordElements > 0) {
            logger.info(`[parseExercise] Des mots cliquables ont été détectés (basé sur ${clickableWordElements} éléments trouvés avec ${selectors.pointAndClickSpan})`);
            const words = await page.locator(selectors.pointAndClickSpan).allTextContents();
            if (words && words.length > 0) {
                exerciseData.clickable_words = words.map(word => word.trim()).filter(word => word.length > 0);
                logger.debug(`[parseExercise] Mots cliquables extraits: ${JSON.stringify(exerciseData.clickable_words)}`);
                // Si aucun type n'a été défini et qu'on a des mots cliquables, on peut supposer que c'est le type principal.
                if (exerciseType === 'unknown') {
                    exerciseType = 'point_and_click';
                    logger.info(`[parseExercise] Type d'exercice défini comme 'point_and_click' basé sur la présence de mots cliquables.`);
                }
            } else {
                 logger.warn(`[parseExercise] Mots cliquables détectés mais aucun texte extrait avec ${selectors.pointAndClickSpan}.`);
            }
        }

        // Si aucun type spécifique n'a été trouvé mais qu'il y a une question,
        // on pourrait le laisser 'unknown' ou tenter une inférence plus poussée si nécessaire.
        if (exerciseType === 'unknown') {
            logger.warn(`[parseExercise] Type d'exercice non déterminé. Données extraites: ${JSON.stringify(exerciseData)}`);
        }

        return {
            success: true,
            type: exerciseType,
            data: exerciseData
        };

    } catch (error) {
        // Check if the error is specifically about the element not being found (TimeoutError is common)
        if (error.name === 'TimeoutError' || (error.message && error.message.includes('selector') && error.message.includes('waiting for'))) {
             const currentUrl = page.url();
             logger.error(
                `ElementNotFoundError: Failed to find selector '${selectors.sentence}' on page ${currentUrl}. Triggering restart mechanism.`,
                error
             );
             // Throw the specific error for the caller to handle
             throw new ElementNotFoundError(selectors.sentence, currentUrl, error);
        } else {
            // Handle other potential errors during parsing
            logger.error(
                `Erreur générique lors de l'analyse de l'exercice (page: ${page.url()})`,
                error
            );
            // Return a generic failure for other errors
            return { success: false, error: `Failed to parse exercise: ${error.message}` };
        }
    } finally {
        // logger.info('Fin de l\'analyse de l\'exercice.');
    }
}
 
/**
 * Correction : suppression d'un export en double de parseExercise (évite les erreurs de compilation).
 */
export { parseExercise };