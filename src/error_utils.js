/**
 * Ce module est compatible avec l’API asynchrone du logger.
 * Si vous souhaitez logger une erreur via handleError, passez une instance obtenue par :
 *   const logger = await getLogger();
 * Voir ./logger.js pour l’implémentation.
 */
// Module utilitaire pour la gestion centralisée des erreurs
// Fournit des classes d’erreur personnalisées et des fonctions d’aide

/**
 * Erreur de validation des entrées utilisateur ou variables d’environnement.
 */
class ValidationError extends Error {
  constructor(message, details = null) {
    super(message);
    this.name = 'ValidationError';
    this.details = details;
  }
}

/**
 * Erreur d’authentification.
 */
class AuthError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AuthError';
  }
}

/**
 * Erreur générique d’application.
 */
class AppError extends Error {
  constructor(message, code = null) {
    super(message);
    this.name = 'AppError';
    this.code = code;
  }
}
/**
 * Erreur spécifique indiquant qu'un élément DOM attendu n'a pas été trouvé.
 */
class ElementNotFoundError extends Error {
  constructor(selector, url = null, details = null) {
    let message = `Element not found for selector: ${selector}`;
    if (url) {
      message += ` on page: ${url}`;
    }
    super(message);
    this.name = 'ElementNotFoundError';
    this.selector = selector;
    this.url = url;
    this.details = details; // Peut contenir l'erreur Playwright originale
  }
}

/**
 * Fonction utilitaire pour propager ou logger proprement une erreur.
 * @param {Error} err
 * @param {Function} logger
 */
/**
 * Fonction utilitaire pour propager ou logger proprement une erreur.
 * @param {Error} err
 * @param {Object} logger - Instance asynchrone obtenue via await getLogger(), ou null.
 */
function handleError(err, logger = null) {
  if (logger) {
    logger.error(`[${err.name}] ${err.message}`, err.details || '');
  }
  throw err;
}

/**
 * Lance une erreur aléatoire selon un pourcentage de probabilité de faute.
 * @param {number} faultProbability Pourcentage (0–100) de chance de générer une erreur.
 * @param {Error} errorInstance Instance d’erreur à lancer si la probabilité est atteinte.
 */
function maybeThrowError(faultProbability, errorInstance) {
  const rand = Math.random() * 100;
  if (rand < faultProbability) {
    throw errorInstance;
  }
}

export { ValidationError, AuthError, AppError, ElementNotFoundError, handleError, maybeThrowError };

/**
 * Conversion ES Modules : exports nommés pour compatibilité avec import { ... } from './error_utils.js'
 */