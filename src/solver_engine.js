const logger = require('./logger'); // Correction: Chemin relatif correct
const { parseExercise } = require('./exercise_parser'); // Correction: Chemin relatif correct
const { getCorrection } = require('./openai_client'); // Correction: Chemin relatif correct
const { randomDelay } = require('./human_simulator'); // Correction: Chemin relatif correct
const config = require('./config_loader'); // Importe l'objet config directement

// Récupérer les délais depuis la configuration chargée
const MIN_ACTION_DELAY = config.MIN_ACTION_DELAY; // Utilise la clé correcte
const MAX_ACTION_DELAY = config.MAX_ACTION_DELAY; // Utilise la clé correcte

/**
 * Tente de résoudre un seul exercice affiché sur la page Playwright.
 * Orchestre le parsing, l'appel à l'IA et la simulation de l'application de la correction.
 * @param {import('playwright').Page} page - L'objet page Playwright pointant vers l'exercice.
 * @returns {Promise<{success: boolean, error?: string}>} - Résultat de la tentative de résolution.
 */
async function solveSingleExercise(page) {
    logger.info('Tentative de résolution d\'un exercice...');

    try {
        // Étape 1: Parser l'exercice
        logger.debug('Parsing de l\'exercice en cours...');
        const exerciseData = await parseExercise(page);

        if (!exerciseData.success) {
            logger.error(`Échec du parsing de l'exercice: ${exerciseData.error}`);
            return { success: false, error: `Parsing failed: ${exerciseData.error}` };
        }
        logger.debug(`Données extraites de l'exercice: ${JSON.stringify(exerciseData.data)}`);

        // Ajout d'un délai avant d'appeler l'IA pour simuler la réflexion humaine
        logger.debug(`Ajout d'un délai aléatoire avant l'appel OpenAI...`);
        await randomDelay(MIN_ACTION_DELAY, MAX_ACTION_DELAY);

        // Étape 2: Obtenir la correction via OpenAI
        // Construction du Prompt (Placeholder - à affiner)
        // TODO: Améliorer la construction du prompt en fonction du type d'exercice et des données extraites.
        const prompt = `Analyse l'exercice suivant et fournis l'action JSON (type: 'click_word', 'select_option', 'validate_rule', 'no_mistake', etc. et 'value' ou 'rule_id' si applicable). Si aucune faute n'est détectée, utilise l'action 'no_mistake': ${exerciseData.data.question}`;
        logger.debug(`Prompt envoyé à OpenAI: ${prompt}`);

        const correctionResult = await getCorrection(prompt);
        console.log(correctionResult)

        // Vérification du résultat structuré de getCorrection
        if (!correctionResult || !correctionResult.success) {
            // L'appel à getCorrection a échoué ou retourné success: false
            const errorMsg = `Failed to get valid correction from OpenAI: ${correctionResult?.error || 'Unknown error'}`;
            logger.error(errorMsg);
            logger.debug(`Raw OpenAI result object: ${JSON.stringify(correctionResult)}`);
            return { success: false, error: errorMsg };
        }

        // À ce stade, correctionResult.success est true, on vérifie data et data.action
        const correctionData = correctionResult.data;
        if (!correctionData || typeof correctionData !== 'object' || !correctionData.action) {
            const errorMsg = 'OpenAI response data is invalid or missing "action" field.';
            logger.error(errorMsg, { dataReceived: correctionData });
            logger.debug(`Raw OpenAI result object: ${JSON.stringify(correctionResult)}`);
            return { success: false, error: errorMsg };
        }

        // La correction est valide et contient une action
        logger.info(`Correction reçue d'OpenAI: Action=${correctionData.action}, Value=${correctionData.value || 'N/A'}, RuleID=${correctionData.rule_id || 'N/A'}`);
        logger.debug(`Correction complète: ${JSON.stringify(correctionData)}`);

        // Étape 3: Appliquer la correction (Simulation)
        logger.info(`Action suggérée par l'IA: ${correctionData.action} - Valeur/ID: ${correctionData.value || correctionData.rule_id || 'N/A'}`);

        // Simulation de l'action avec délai aléatoire
        const action = correctionData.action.toLowerCase(); // Utiliser toLowerCase pour la robustesse
        switch (action) {
            case 'click_word':
                if (!correctionData.value) {
                    logger.warn(`Action 'click_word' reçue sans 'value'.`);
                    return { success: false, error: 'AI action "click_word" missing value' };
                }
                // Implémentation du clic réel
                const wordToClick = correctionData.value;
                logger.info(`Tentative de clic sur le mot: "${wordToClick}"`);
                try {
                    // Vérifier si le mot contient un trait d'union ou espace et le décomposer
                    const wordParts = wordToClick.split(/[\s\-‑]/);
                    logger.debug(`Mot décomposé en parties: ${JSON.stringify(wordParts)}`);
                    
                    // Essayer d'abord avec le mot complet
                    let wordLocator = page.locator('div.sentence span.pointAndClickSpan', { hasText: wordToClick });
                    let found = await wordLocator.count() > 0;
                    
                    // Si le mot complet n'est pas trouvé et qu'il contient des parties, essayer avec la première partie
                    if (!found && wordParts.length > 1) {
                        const firstPart = wordParts[0];
                        logger.info(`Mot composé non trouvé directement, tentative avec la première partie: "${firstPart}"`);
                        wordLocator = page.locator('div.sentence span.pointAndClickSpan', { hasText: firstPart });
                        found = await wordLocator.count() > 0;
                    }
                    
                    if (found) {
                        await wordLocator.first().click({ timeout: 5000 });
                        logger.info(`Clic réussi sur le mot ou sa première partie`);
                    } else {
                        throw new Error(`Aucune correspondance trouvée pour le mot "${wordToClick}" ni sa première partie`);
                    }
                } catch (clickError) {
                    logger.error(`Échec du clic sur le mot "${wordToClick}": ${clickError.message}`);
                    
                    // Tentative alternative avec une approche plus générique
                    try {
                        logger.info(`Tentative alternative de clic via un sélecteur plus générique`);
                        // Cibler tous les spans cliquables et cliquer sur le premier visible contenant du texte
                        const allSpans = page.locator('div.sentence span.pointAndClickSpan');
                        const count = await allSpans.count();
                        
                        if (count > 0) {
                            await allSpans.first().click({ timeout: 3000 });
                            logger.info(`Clic alternatif réussi sur un élément span`);
                        } else {
                            throw new Error("Aucun élément span cliquable trouvé");
                        }
                    } catch (alternativeError) {
                        logger.error(`Échec de la tentative alternative: ${alternativeError.message}`);
                        return { success: false, error: `Failed to click on word "${wordToClick}": ${clickError.message}` };
                    }
                }
                break;

            case 'select_option':
                 if (!correctionData.value) {
                    logger.warn(`Action 'select_option' reçue sans 'value'.`);
                    return { success: false, error: 'AI action "select_option" missing value' };
                }
                logger.info(`[SIMULATION] Sélection de l'option: ${correctionData.value}`);
                await randomDelay(MIN_ACTION_DELAY, MAX_ACTION_DELAY);
                // TODO: Implémenter la logique de sélection réelle.
                break;

            case 'validate_rule':
                 if (!correctionData.rule_id) {
                    logger.warn(`Action 'validate_rule' reçue sans 'rule_id'.`);
                    return { success: false, error: 'AI action "validate_rule" missing rule_id' };
                }
                logger.info(`Validation de la règle: ${correctionData.rule_id}. Clic sur le bouton "Il n'y a pas de faute".`);
                try {
                    // Utiliser l'ID et la classe spécifiés par l'utilisateur pour ce cas
                    const validateButtonLocator = page.locator('button#btn_question_suivante.noMistakeButton');
                    await validateButtonLocator.click({ timeout: 5000 });
                    logger.info(`Clic réussi sur le bouton pour valider la règle (ou indiquer l'absence de faute).`);
                } catch (validateError) {
                    logger.error(`Échec du clic sur le bouton de validation/absence de faute: ${validateError.message}`);
                    return { success: false, error: `Failed to click validation/no mistake button: ${validateError.message}` };
                }
                break;
            case 'no_mistake':
                logger.info(`[SIMULATION] Clic sur le bouton "Il n'y a pas de faute".`);
                try {
                    // Utiliser l'ID et la classe fournis dans la description de la tâche
                    const noMistakeButtonLocator = page.locator('button#btn_question_suivante.noMistakeButton');
                    await noMistakeButtonLocator.click({ timeout: 5000 });
                    logger.info(`Clic réussi sur le bouton "Il n'y a pas de faute".`);
                } catch (noMistakeError) {
                    logger.error(`Échec du clic sur le bouton "Il n'y a pas de faute": ${noMistakeError.message}`);
                    // Retourner une erreur spécifique si le clic échoue
                    return { success: false, error: `Failed to click on "No Mistake" button: ${noMistakeError.message}` };
                }
                break;


            default:
                logger.warn(`Action IA non reconnue ou non gérée: ${action}`);
                // Décider si c'est une erreur bloquante ou non. Pour l'instant, on retourne une erreur.
                return { success: false, error: `Unhandled AI action: ${action}` };
        }
        logger.info(`[SIMULATION] Fin de l'application de l'action: ${action}`);


        // Étape 4: Cliquer sur "Suivant" après avoir appliqué l'action
        logger.info('Action appliquée. Tentative de clic sur le bouton "Suivant".');
        try {
            const nextButtonLocator = page.locator('#btn_question_suivante.nextButton');
            await nextButtonLocator.click({ timeout: 5000 }); // Timeout court pour cliquer
            logger.info('Clic sur le bouton "Suivant" réussi.');
            // Prévoir une petite attente pour que la page se mette à jour si nécessaire
            await page.waitForTimeout(500); // Petite pause après le clic
        } catch (nextButtonError) {
            // Si le bouton "Suivant" n'est pas trouvé ou cliquable, on suppose que l'exercice est terminé.
            logger.info(`Le bouton "Suivant" n'est pas cliquable (message: ${nextButtonError.message}). On considère l'exercice comme terminé.`);
            // Retourner un statut indiquant la fin de l'exercice pour que la boucle appelante s'arrête.
            return { success: true, exerciseComplete: true };
        }

        // L'ancienne étape de validation/navigation est remplacée/gérée par le clic sur "Suivant"
        // TODO: La logique de boucle pour continuer avec la nouvelle question/étape devrait être gérée
        // par la fonction appelante (ex: dans main.js). solveSingleExercise a terminé son travail pour cette étape.

        logger.info('Fin de la tentative de résolution de l\'exercice.');
        return { success: true };

    } catch (error) {
        logger.error(`Erreur inattendue durant solveSingleExercise: ${error.message}`, { stack: error.stack });
        return { success: false, error: `Unexpected error: ${error.message}` };
    }
}

module.exports = {
    solveSingleExercise
};