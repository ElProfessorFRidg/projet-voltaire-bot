// src/exercise_parser.js

import logger from './logger.js';

/**
 * Analyse la page d'un exercice pour en extraire les informations pertinentes.
 * @param {import('playwright').Page} page - L'objet Page de Playwright représentant la page de l'exercice.
 * @returns {Promise<object>} Un objet contenant les données extraites ou une erreur.
 */
async function parseExercise(page) {
    logger.info('Début de l\'analyse de l\'exercice...');

    // --- Placeholders - À remplacer par les vrais sélecteurs ---
    const exerciseTypeSelector = '.exercise-type-indicator'; // Indicateur du type d'exercice (ex: QCM, faute à trouver)
    const questionTextSelector = '.sentence'; // Le texte principal de la question ou la phrase à corriger
    const wordToClickSelector = '.word-clickable'; // Sélecteur pour les mots cliquables (si applicable)
    const choiceOptionsSelector = '.choice-option input[type="radio"]'; // Sélecteur pour les options de QCM (si applicable)
    const choiceLabelsSelector = '.choice-option label'; // Sélecteur pour les labels des options QCM
    const ruleIdentifierSelector = '.rule-id'; // Sélecteur pour l'identifiant d'une règle (si applicable)
    // --- Fin Placeholders ---

    try {
        logger.debug('Tentative d\'extraction du texte de la question...');
        // Note: page.locator(selector).textContent() peut échouer si l'élément n'existe pas immédiatement.
        // Il est souvent préférable d'attendre l'élément d'abord.
        // Augmentation du timeout pour plus de robustesse potentielle sur des chargements lents
        await page.waitForSelector(questionTextSelector, { timeout: 10000 }); 
        const questionText = await page.locator(questionTextSelector).textContent();
        logger.info(`Texte de la question extrait: ${questionText}`);

        // À ce stade, on ajouterait la logique pour déterminer le type d'exercice
        // et extraire les éléments spécifiques (mots cliquables, options, etc.)
        // en utilisant les autres sélecteurs placeholders.

        // Pour l'instant, on retourne juste le texte.
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
        logger.error(`Erreur lors de l'analyse de l'exercice: Impossible de trouver ou lire ${questionTextSelector}`, error);
        // Utilisation de error.message pour un message plus concis
        return { success: false, error: `Failed to parse exercise: ${error.message}` };
    } finally {
         logger.info('Fin de l\'analyse de l\'exercice.');
    }
}

export { parseExercise };