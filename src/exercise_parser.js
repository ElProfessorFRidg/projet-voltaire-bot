// src/exercise_parser.js
import logger from './logger.js';
import selectors from './selectors.js'; // Correction : centralisation des sélecteurs
 
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
    // logger.info('Début de l\'analyse de l\'exercice...');
 
    try {
        // logger.debug('Tentative d\'extraction du texte de la question...');
 
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
 
        // TODO: Ajouter ici la logique pour déterminer le type d'exercice
        // et extraire les éléments spécifiques (mots cliquables, options, etc.)
        // en utilisant les sélecteurs du module selectors.js
 
        // Retourne pour l'instant uniquement le texte de la question
        return {
            success: true,
            type: 'unknown', // Le type sera déterminé dans les futures implémentations
            data: {
                question: questionText,
                // options: [], // Sera rempli plus tard
                // clickable_words: [], // Sera rempli plus tard
            }
        };
 
    } catch (error) {
        // Gestion robuste des erreurs lors de l'extraction
        logger.error(
            `Erreur lors de l'analyse de l'exercice: Impossible de trouver ou lire ${selectors.sentence}`,
            error
        );
        // Utilisation de error.message pour un message plus concis
        return { success: false, error: `Failed to parse exercise: ${error.message}` };
    } finally {
        // logger.info('Fin de l\'analyse de l\'exercice.');
    }
}
 
/**
 * Correction : suppression d'un export en double de parseExercise (évite les erreurs de compilation).
 */
export { parseExercise };