// src/exercise_parser.js

import logger from './logger.js';

/**
 * Analyse la page d'un exercice pour en extraire les informations pertinentes.
 * @param {import('playwright').Page} page - L'objet Page de Playwright représentant la page de l'exercice.
 * @returns {Promise<object>} Un objet contenant les données extraites ou une erreur.
 */
async function parseExercise(page) {
    logger.info('Début de l\'analyse de l\'exercice...');

    // Sélecteurs pour extraire les informations de l'exercice
    const exerciseTypeSelector = '.exercise-type-indicator'; // Indicateur du type d'exercice (ex: QCM, faute à trouver)
    const questionTextSelector = '.sentence'; // Le texte principal de la question ou la phrase à corriger
    const wordToClickSelector = '.word-clickable'; // Sélecteur pour les mots cliquables (si applicable)
    const choiceOptionsSelector = '.choice-option input[type="radio"]'; // Sélecteur pour les options de QCM (si applicable)
    const choiceLabelsSelector = '.choice-option label'; // Sélecteur pour les labels des options QCM
    const ruleIdentifierSelector = '.rule-id'; // Sélecteur pour l'identifiant d'une règle (si applicable)

    try {
        logger.debug('Tentative d\'extraction du texte de la question...');

        // Attendre que l'élément de la question soit présent
        await page.waitForSelector(questionTextSelector, { timeout: 10000 });

        // Extraire le texte de la question
        const questionText = await page.locator(questionTextSelector).textContent();
        if (!questionText || !questionText.trim()) {
            // Cas limite : texte vide ou non trouvé
            logger.warn(`Le texte de la question est vide ou non trouvé pour le sélecteur ${questionTextSelector}`);
            return { success: false, error: 'Question text is empty or missing.' };
        }
        logger.info(`Texte de la question extrait: ${questionText}`);

        // TODO: Ajouter ici la logique pour déterminer le type d'exercice
        // et extraire les éléments spécifiques (mots cliquables, options, etc.)
        // en utilisant les autres sélecteurs définis ci-dessus.

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
            `Erreur lors de l'analyse de l'exercice: Impossible de trouver ou lire ${questionTextSelector}`,
            error
        );
        // Utilisation de error.message pour un message plus concis
        return { success: false, error: `Failed to parse exercise: ${error.message}` };
    } finally {
        logger.info('Fin de l\'analyse de l\'exercice.');
    }
}

export { parseExercise };