// src/auth_handler.js
const config = require('../src/config_loader.js');
const { randomDelay, getRandomInt } = require('../src/human_simulator');
const logger = require('./logger');

/**
 * Gère la connexion au Projet Voltaire en simulant un comportement humain.
 * @param {import('playwright').Page} page - L'instance de la page Playwright.
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function login(page) {
  const {
    VOLTAIRE_EMAIL,
    VOLTAIRE_PASSWORD,
    MIN_ACTION_DELAY,
    MAX_ACTION_DELAY,
    MIN_TYPING_DELAY,
    MAX_TYPING_DELAY,
    LOGIN_URL
  } = config;

  // Sélecteurs pour les champs du formulaire de connexion
  const emailSelector = 'input[name="email"], input#user_pseudonym';
  const passwordSelector = 'input[name="password"], input#user_password';
  const submitButtonSelector = 'button[type="submit"]';
  const successSelector = '#btn_home_exit, #btn_home_sortir';
  const errorSelector = '.error';

  logger.info(`Tentative de connexion à ${LOGIN_URL}...`);

  try {
    // Navigation vers la page de connexion
    await page.goto(LOGIN_URL, { waitUntil: 'networkidle' });
    logger.info('Page de connexion chargée.');

    // Saisie de l'email
    await randomDelay(MIN_ACTION_DELAY, MAX_ACTION_DELAY);
    logger.debug('Recherche du champ email...');
    const emailField = page.locator(emailSelector);
    await emailField.waitFor({ state: 'visible', timeout: 10000 });
    logger.debug('Saisie de l\'email...');
    await emailField.type(VOLTAIRE_EMAIL, { delay: getRandomInt(MIN_TYPING_DELAY, MAX_TYPING_DELAY) });
    logger.info('Email saisi.');

    // Saisie du mot de passe
    await randomDelay(MIN_ACTION_DELAY, MAX_ACTION_DELAY);
    logger.debug('Recherche du champ mot de passe...');
    const passwordField = page.locator(passwordSelector);
    await passwordField.waitFor({ state: 'visible', timeout: 10000 });
    logger.debug('Saisie du mot de passe...');
    await passwordField.type(VOLTAIRE_PASSWORD, { delay: getRandomInt(MIN_TYPING_DELAY, MAX_TYPING_DELAY) });
    logger.info('Mot de passe saisi.');

    // Soumission du formulaire
    await randomDelay(MIN_ACTION_DELAY, MAX_ACTION_DELAY);
    logger.debug('Recherche et clic sur le bouton de soumission...');
    const submitButton = page.locator(submitButtonSelector);
    await submitButton.waitFor({ state: 'visible', timeout: 10000 });
    await submitButton.click();
    logger.info('Formulaire soumis.');

    // Attente du résultat de la connexion
    logger.info('Attente du résultat de la connexion (succès ou erreur)...');
    try {
      await Promise.race([
        page.waitForSelector(successSelector, { state: 'visible', timeout: 15000 }),
        page.waitForSelector(errorSelector, { state: 'visible', timeout: 15000 })
      ]);

      // Vérification de la présence d'un message d'erreur
      const errorMessageVisible = await page.locator(errorSelector).isVisible().catch(() => false);
      if (errorMessageVisible) {
        const errorText = await page.locator(errorSelector).textContent().catch(() => null);
        const cleanError = errorText && typeof errorText === 'string' ? errorText.trim() : 'Erreur inconnue';
        logger.error(`Échec de la connexion: Message d'erreur détecté - ${cleanError}`);
        return { success: false, error: `Login failed: ${cleanError}` };
      }

      // Vérification de la présence de l'indicateur de succès
      const successElementVisible = await page.locator(successSelector).isVisible().catch(() => false);
      if (successElementVisible) {
        logger.info('Connexion réussie (indicateur de succès détecté).');
        return { success: true };
      }

      // Aucun indicateur trouvé
      logger.error('Échec de la connexion: Timeout ou état inattendu après soumission (ni succès ni erreur détectés).');
      return { success: false, error: 'Login timeout or unexpected state after submission' };

    } catch (waitError) {
      logger.error('Erreur lors de l\'attente post-connexion:', { name: waitError.name, message: waitError.message });
      if (waitError.name === 'TimeoutError') {
        logger.error('Timeout dépassé en attendant l\'indicateur de succès ou d\'erreur.');
        return { success: false, error: 'Login attempt timed out waiting for success/error indicator.' };
      }
      return { success: false, error: `Post-login wait error: ${waitError.message}` };
    }

  } catch (error) {
    logger.error('Erreur critique durant le processus de connexion:', { name: error.name, message: error.message });
    if (error.message && (
      error.message.includes('selector resolved to hidden element') ||
      error.message.includes('waiting for selector')
    )) {
      return { success: false, error: `Failed to find or interact with element: ${error.message}` };
    }
    return { success: false, error: `Critical login error: ${error.message}` };
  }
}

module.exports = { login };