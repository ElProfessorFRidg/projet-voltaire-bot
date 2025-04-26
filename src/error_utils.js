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
 * Fonction utilitaire pour propager ou logger proprement une erreur.
 * @param {Error} err
 * @param {Function} logger
 */
function handleError(err, logger = null) {
  if (logger) {
    logger.error(`[${err.name}] ${err.message}`, err.details || '');
  }
  throw err;
}

/**
 * Conversion ES Modules : exports nommés pour compatibilité avec import { ... } from './error_utils.js'
 */
export { ValidationError, AuthError, AppError, handleError };