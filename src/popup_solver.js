import logger from './logger.js';
import { getCorrection } from './openai_client.js';
import { randomDelay } from './human_simulator.js';
import { config } from './config_loader.js';

const MIN_ACTION_DELAY = config.MIN_ACTION_DELAY;
const MAX_ACTION_DELAY = config.MAX_ACTION_DELAY;

/**
 * Analyse une phrase pour déterminer si elle est grammaticalement correcte.
 * @param {string} sentence La phrase à analyser.
 * @returns {boolean} true si la phrase est jugée correcte, false sinon.
 */
/**
 * Résout le popup intensif phrase par phrase.
 * @param {import('playwright').Page} page L'objet Page de Playwright.
 */

/**
 * Gère la résolution d'un popup Correct/Incorrect.
 * @param {import('playwright').Page} page L'objet Page de Playwright.
 * @param {import('playwright').Locator} popupElement Le Locator Playwright pointant vers l'élément racine du popup.
 * @returns {Promise<string|null>} La décision prise ("Correct" ou "Incorrect") ou null en cas d'échec.
 */

export async function solvePopup(page) {
    logger.info('[solvePopup V3] Début du traitement phrase par phrase...');
    const MAX_ITERATIONS = 50;
    const POPUP_TIMEOUT_MS = 120000;
    const startTime = Date.now();
    let iteration = 0;
    let questionsProcessedCount = 0;

    // Sélecteurs centralisés
    const selectors = {
        popup: '.popupContent .intensiveTraining',
        understoodButton: 'button.understoodButton',
        questionContainer: '.intensiveQuestion',
        sentence: '.sentence',
        correctButton: '.buttonOk',
        incorrectButton: '.buttonKo',
        exitButton: '.exitButton',
        retryButton: '.retryButton',
        tick: '.tick'
    };

    try {
        // Attente du popup
        logger.info('[solvePopup V3] Attente de l\'apparition du pop-up...');
        await page.waitForSelector(selectors.popup, { state: 'visible', timeout: 15000 });
        logger.info('[solvePopup V3] Pop-up détecté.');

        // Gestion du bouton "J'ai compris"
        try {
            await page.waitForTimeout(5000);
            const understoodButton = page.locator(selectors.understoodButton);
            if (await understoodButton.isVisible({ timeout: 7000 })) {
                logger.info('[solvePopup V3] Bouton "J\'ai compris" détecté. Attente fixe (3s) + délai aléatoire...');
                await page.waitForTimeout(3000);
                if (await understoodButton.isVisible({ timeout: 500 })) {
                    await understoodButton.click({ timeout: 3000 });
                    logger.info('[solvePopup V3] Clic sur "J\'ai compris". Attente post-clic...');
                    await page.waitForTimeout(2500);
                } else {
                    logger.warn('[solvePopup V3] Bouton "J\'ai compris" devenu invisible pendant l\'attente supplémentaire.');
                }
            } else {
                logger.info('[solvePopup V3] Bouton "J\'ai compris" non visible dans le délai initial.');
            }
        } catch (error) {
            logger.warn(`[solvePopup V3] Erreur gestion bouton "J'ai compris": ${error.message}`);
        }

        // Boucle principale de traitement
        while (iteration < MAX_ITERATIONS) {
            if (Date.now() - startTime > POPUP_TIMEOUT_MS) {
                logger.error(`[solvePopup V3] Timeout global (${POPUP_TIMEOUT_MS}ms) atteint. Sortie.`);
                break;
            }
            iteration++;
            logger.debug(`[solvePopup V3 Iter ${iteration}/${MAX_ITERATIONS}] Début itération.`);

            // Vérifier la présence du popup
            if (!await page.locator(selectors.popup).isVisible({ timeout: 1000 })) {
                logger.info('[solvePopup V3] Popup principal disparu. Fin du traitement.');
                break;
            }

            // Gestion des boutons de sortie/continuer
            const exitButton = page.locator(selectors.exitButton);
            if (await exitButton.isVisible({ timeout: 500 })) {
                logger.info('[solvePopup V3] Bouton "Sortir" détecté. Clic et fin.');
                try {
                    await exitButton.click({ timeout: 3000 });
                    await page.waitForTimeout(500);
                } catch (e) {
                    logger.error(`Clic Sortir échoué: ${e.message}`);
                }
                break;
            }
            const retryButton = page.locator(selectors.retryButton);
            if (await retryButton.isVisible({ timeout: 500 })) {
                logger.info('[solvePopup V3] Bouton "Je m\'accroche" détecté. Clic et continue.');
                try {
                    await retryButton.click({ timeout: 3000 });
                    await page.waitForTimeout(1000);
                } catch (e) {
                    logger.error(`Clic Je m'accroche échoué: ${e.message}`);
                }
                continue;
            }

            // Recherche de la prochaine question à traiter
            let targetQuestion = null;
            const allQuestions = await page.locator(selectors.questionContainer).all();
            logger.debug(`[solvePopup V3 Iter ${iteration}] Recherche de la prochaine question parmi ${allQuestions.length} conteneurs.`);

            for (const question of allQuestions) {
                let isVisible = false, hasTick = false, hasButtons = false;
                try {
                    isVisible = await question.isVisible({ timeout: 500 });
                } catch {}
                try {
                    hasTick = await question.locator(selectors.tick).isVisible({ timeout: 100 });
                } catch {}
                try {
                    hasButtons = await question.locator(`${selectors.correctButton}, ${selectors.incorrectButton}`).count() > 0;
                } catch {}

                if (isVisible && !hasTick && hasButtons) {
                    let okVisible = false, koVisible = false;
                    try {
                        okVisible = await question.locator(selectors.correctButton).isVisible({ timeout: 100 });
                    } catch {}
                    try {
                        koVisible = await question.locator(selectors.incorrectButton).isVisible({ timeout: 100 });
                    } catch {}
                    if (okVisible || koVisible) {
                        logger.debug(`[solvePopup V3 Iter ${iteration}] Question candidate trouvée (visible, sans tick, avec boutons visibles).`);
                        targetQuestion = question;
                        break;
                    } else {
                        logger.debug(`[solvePopup V3 Iter ${iteration}] Question candidate ignorée (boutons OK/KO non visibles).`);
                    }
                } else {
                    logger.debug(`[solvePopup V3 Iter ${iteration}] Question candidate ignorée (Visible: ${isVisible}, Tick: ${hasTick}, Boutons DOM: ${hasButtons}).`);
                    continue; // Continue to the next question if this one is not a candidate
                }
            }

            // Traitement de la question trouvée
            if (targetQuestion) {
                questionsProcessedCount++;
                const questionLogId = `Q${questionsProcessedCount} (Iter ${iteration})`;
                logger.info(`[solvePopup V3 ${questionLogId}] Traitement de la question trouvée.`);

                try {
                    const sentenceElement = targetQuestion.locator(selectors.sentence).first();
                    const sentenceTextRaw = await sentenceElement.textContent({ timeout: 2000 });
                    if (typeof sentenceTextRaw !== 'string') throw new Error("Texte de la phrase est null.");
                    const sentenceText = sentenceTextRaw.trim().replace(/\s+/g, ' ');
                    if (!sentenceText) throw new Error("Texte de la phrase vide après nettoyage.");

                    logger.info(`[solvePopup V3 ${questionLogId}] Phrase: "${sentenceText}"`);

                    const isCorrect = analyzeSentence(sentenceText);
                    logger.info(`[solvePopup V3 ${questionLogId}] Analyse: ${isCorrect ? 'Correcte' : 'Incorrecte'}`);

                    const buttonToClickLocator = isCorrect ? selectors.correctButton : selectors.incorrectButton;
                    const buttonToClick = targetQuestion.locator(buttonToClickLocator);
                    const buttonLabel = isCorrect ? 'Correct' : 'Incorrect';

                    logger.info(`[solvePopup V3 ${questionLogId}] Clic sur "${buttonLabel}"...`);
                    if (
                        await buttonToClick.isVisible({ timeout: 1000 }).catch(() => false) &&
                        await buttonToClick.isEnabled({ timeout: 1000 }).catch(() => false)
                    ) {
                        await buttonToClick.click({ timeout: 3000 });

                        // Attente disparition des boutons
                        logger.debug(`[solvePopup V3 ${questionLogId}] Attente disparition boutons...`);
                        try {
                            await page.waitForFunction(
                                async ({ qElement, btnOkSel, btnKoSel }) => {
                                    if (!qElement || !document.body.contains(qElement)) return true;
                                    const okBtn = qElement.querySelector(btnOkSel);
                                    const koBtn = qElement.querySelector(btnKoSel);
                                    return (!okBtn || okBtn.offsetParent === null) && (!koBtn || koBtn.offsetParent === null);
                                },
                                {
                                    qElement: await targetQuestion.elementHandle(),
                                    btnOkSel: selectors.correctButton,
                                    btnKoSel: selectors.incorrectButton
                                },
                                { timeout: 5000 }
                            );
                            logger.debug(`[solvePopup V3 ${questionLogId}] Boutons disparus ou cachés.`);
                        } catch (waitError) {
                            logger.error(`[solvePopup V3 ${questionLogId}] Timeout attente disparition boutons: ${waitError.message}. L'état pourrait être incohérent.`);
                        }
                    } else {
                        logger.warn(`[solvePopup V3 ${questionLogId}] Bouton "${buttonLabel}" non cliquable au moment prévu.`);
                    }
                } catch (error) {
                    logger.error(`[solvePopup V3 ${questionLogId}] Erreur traitement question: ${error.message}`);
                }
            } else {
                logger.debug(`[solvePopup V3 Iter ${iteration}] Aucune question active trouvée. Attente...`);
                await page.waitForTimeout(1500 + Math.random() * 1000);
            }
            await page.waitForTimeout(200 + Math.random() * 300);
        }

        if (iteration >= MAX_ITERATIONS) {
            logger.error(`[solvePopup V3] Nombre maximum d'itérations (${MAX_ITERATIONS}) atteint.`);
        }
        logger.info(`[solvePopup V3] Fin boucle principale. ${questionsProcessedCount} questions traitées sur ${iteration} itérations.`);
    } catch (error) {
        if (error && error.name === 'TimeoutError') {
            logger.error(`[solvePopup V3] Timeout attente élément clé (popup?): ${error.message}`);
        } else {
            logger.error(`[solvePopup V3] Erreur inattendue: ${error?.message}`, { stack: error?.stack });
        }
    } finally {
        logger.info('[solvePopup V3] Fin de l\'exécution.');
    }
}

/**
 * Gère la résolution d'un popup Correct/Incorrect.
 * @param {import('playwright').Page} page L'objet Page de Playwright.
 * @param {import('playwright').Locator} popupElement Le Locator Playwright pointant vers l'élément racine du popup.
 * @returns {Promise<string|null>} La décision prise ("Correct" ou "Incorrect") ou null en cas d'échec.
 */
export async function solveCorrectIncorrectPopup(page, popupElement) {
    logger.info('[solveCorrectIncorrectPopup] Début...');
    try {
        const correctButtonSelector = '.buttonOk';
        const incorrectButtonSelector = '.buttonKo';
        let popupText = null;
        try {
            popupText = await popupElement.textContent({ timeout: 5000 });
        } catch {
            logger.warn('[solveCorrectIncorrectPopup] Impossible d\'extraire le texte du popup.');
            return null;
        }
        if (!popupText) {
            logger.warn('[solveCorrectIncorrectPopup] Texte du popup non extrait.');
            return null;
        }
        const cleanedText = popupText.trim().replace(/\s+/g, ' ');
        logger.debug(`[solveCorrectIncorrectPopup] Texte: "${cleanedText}"`);

        const prompt = `Analyse: "${cleanedText}". Indique si c'est CORRECT ou INCORRECT. Réponse JSON: { "decision": "Correct" } ou { "decision": "Incorrect" }`;
        await randomDelay(MIN_ACTION_DELAY, MAX_ACTION_DELAY);
        const decisionResult = await getCorrection(prompt);

        if (
            !decisionResult?.success ||
            !decisionResult.data?.decision ||
            !['Correct', 'Incorrect'].includes(decisionResult.data.decision)
        ) {
            logger.error(`[solveCorrectIncorrectPopup] Décision OpenAI invalide.`, { decisionResult });
            try {
                const fallbackButton = popupElement.locator('button:visible').first();
                if (await fallbackButton.count() > 0) {
                    logger.warn("[solveCorrectIncorrectPopup] Tentative de clic fallback.");
                    await fallbackButton.click();
                    return "FallbackClick";
                }
            } catch (fallbackError) {
                logger.error(`[solveCorrectIncorrectPopup] Erreur fallback: ${fallbackError.message}`);
            }
            return null;
        }

        const decision = decisionResult.data.decision;
        logger.info(`[solveCorrectIncorrectPopup] Décision OpenAI: ${decision}`);
        const targetButtonSelector = decision === 'Correct' ? correctButtonSelector : incorrectButtonSelector;
        const buttonToClick = popupElement.locator(targetButtonSelector);

        if (
            await buttonToClick.count() > 0 &&
            await buttonToClick.isVisible().catch(() => false) &&
            await buttonToClick.isEnabled().catch(() => false)
        ) {
            logger.info(`[solveCorrectIncorrectPopup] Clic sur "${decision}"...`);
            await randomDelay(MIN_ACTION_DELAY, MAX_ACTION_DELAY);
            await buttonToClick.click({ timeout: 5000 });
            await page.waitForTimeout(500);
            return decision;
        } else {
            logger.error(`[solveCorrectIncorrectPopup] Bouton "${decision}" non cliquable.`);
            try {
                const fallbackButton = popupElement.locator('button:visible').first();
                if (await fallbackButton.count() > 0) {
                    logger.warn(`[solveCorrectIncorrectPopup] Tentative clic fallback (bouton cible non trouvé).`);
                    await fallbackButton.click();
                    return "FallbackClick";
                } else {
                    logger.error("[solveCorrectIncorrectPopup] Aucun bouton visible pour fallback.");
                }
            } catch (fallbackError) {
                logger.error(`[solveCorrectIncorrectPopup] Erreur fallback 2: ${fallbackError.message}`);
            }
            return null;
        }
    } catch (error) {
        logger.error(`[solveCorrectIncorrectPopup] Erreur: ${error?.message}`, { stack: error?.stack });
        try {
            const fallbackButton = popupElement.locator('button:visible').first();
            if (await fallbackButton.count() > 0) {
                logger.warn(`[solveCorrectIncorrectPopup] Erreur inattendue, tentative clic fallback.`);
                await fallbackButton.click();
                return "FallbackClickOnError";
            }
        } catch (fallbackError) {
            logger.error(`[solveCorrectIncorrectPopup] Erreur fallback 3: ${fallbackError.message}`);
        }
        return null;
    } finally {
        logger.info('[solveCorrectIncorrectPopup] Fin.');
    }
}

/**
 * Analyse une phrase pour déterminer si elle est grammaticalement correcte.
 * @param {string} sentence La phrase à analyser.
 * @returns {boolean} true si la phrase est jugée correcte, false sinon.
 */
export function analyzeSentence(sentence) {
    if (typeof sentence !== 'string' || !sentence.trim()) {
        logger.warn('analyzeSentence: phrase vide ou invalide.');
        return true;
    }
    const peutEtreRegex = /\bpeut être\b/i;
    const peutetreRegex = /\bpeut-être\b/i;

    if (peutEtreRegex.test(sentence)) {
        logger.debug(`Analyse: "peut être" trouvé. Supposé correct.`);
        return true;
    } else if (peutetreRegex.test(sentence)) {
        const verbPatterns = [
            /\bpeut-être\s+(un|une|le|la|les|des|ce|cette|ces|mon|ma|mes|ton|ta|tes|son|sa|ses)\b/i,
            /\bpeut-être\s+\w+(é|ée|és|ées)\b/i,
            /\bpeut-être\s+(être|avoir|faire|aller)\b/i,
            /\bpeut-être\s+obligé[es]?\b/i,
            /\bpeut-être\s+prouvé[es]?\b/i,
            /\bpeut-être\s+reproduit[es]?\b/i,
            /\bpeut-être\s+amené[es]?\b/i,
        ];
        for (const pattern of verbPatterns) {
            if (pattern.test(sentence)) {
                logger.debug(`Analyse: "peut-être" suivi d'un motif verbal ("${pattern}"). Supposé incorrect.`);
                return false;
            }
        }
        logger.debug(`Analyse: "peut-être" trouvé et supposé utilisé correctement comme adverbe.`);
        return true;
    }
    logger.warn(`Analyse: Règle "peut être/peut-être" non applicable ou logique incomplète pour: "${sentence}"`);
    return true;
}