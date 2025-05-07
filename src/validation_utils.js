// Module utilitaire de validation stricte des entrées et variables d’environnement

/**
 * Valide qu’une chaîne est un email au format standard.
 * Lance une ValidationError si invalide.
 */
import { ValidationError } from './error_utils.js';

export function validateEmail(email) {
  if (
    typeof email !== 'string' ||
    !/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email)
  ) {
    throw new ValidationError('Format d’email invalide.', { champ: 'email', valeur: email });
  }
}

/**
 * Valide qu’une variable d’environnement est présente et non vide.
 * Lance une ValidationError si invalide.
 */
export function validateEnvVar(name, value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ValidationError(`La variable d’environnement ${name} est requise et ne peut être vide.`, { champ: name });
  }
}

/**
 * Valide qu’une chaîne n’est pas vide.
 * Lance une ValidationError si invalide.
 */
export function validateNotEmptyString(value, champ = 'valeur') {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ValidationError(`${champ} ne peut être vide.`, { champ });
  }
}
/**
 * Valide tous les champs d’un utilisateur (création ou modification).
 * Lance une ValidationError en cas d’erreur.
 * @param {object} data
 */
export function validateUserFields(data) {
  if (!data || typeof data !== 'object') {
    throw new ValidationError('Les données utilisateur sont invalides.', { champ: 'data' });
  }
  // Email obligatoire et non vide
  if (!data.email || typeof data.email !== 'string') {
    throw new ValidationError('Nom d’utilisateur requis et doit être une chaîne non vide.', { champ: 'email' });
  }
  // Mot de passe obligatoire et non vide (si présent)
  if ('password' in data && (typeof data.password !== 'string' || data.password === '')) {
    throw new ValidationError('Mot de passe requis et doit être une chaîne non vide.', { champ: 'password' });
  }
  // sessionDuration (optionnel, mais si présent doit être du type "2h" ou "1.5h")
  if ('sessionDuration' in data && data.sessionDuration) {
    const match = /^(\d+(\.\d+)?)h$/.test(data.sessionDuration);
    if (!match) {
      throw new ValidationError('sessionDuration doit être un nombre positif suivi de "h".', { champ: 'sessionDuration' });
    }
  }
  // isEnabled (optionnel, mais si présent doit être booléen)
  if ('isEnabled' in data && typeof data.isEnabled !== 'boolean') {
    throw new ValidationError('isEnabled doit être un booléen.', { champ: 'isEnabled' });
  }
}
/**
 * Valide les options passées à initializeBrowserSession.
 * Lance une ValidationError si une option est invalide.
 * @param {object} options
 */
export function validateBrowserSessionOptions(options) {
  if (options == null || typeof options !== 'object' || Array.isArray(options)) {
    throw new ValidationError('Les options de session doivent être un objet non nul.', { champ: 'options', valeur: options });
  }
  // headless (optionnel, booléen)
  if ('headless' in options && typeof options.headless !== 'boolean') {
    throw new ValidationError('L’option headless doit être un booléen.', { champ: 'headless', valeur: options.headless });
  }
  // timeout (optionnel, number >=0 <=MAX_SAFE_INTEGER, non NaN)
  if ('timeout' in options) {
    const t = options.timeout;
    if (typeof t !== 'number' || !Number.isFinite(t) || Number.isNaN(t) || t < 0 || t > Number.MAX_SAFE_INTEGER) {
      throw new ValidationError('L’option timeout doit être un nombre >= 0 et <= Number.MAX_SAFE_INTEGER.', { champ: 'timeout', valeur: t });
    }
  }
  // sessionDurationMs (optionnel, number >=0 <=MAX_SAFE_INTEGER, non NaN)
  if ('sessionDurationMs' in options) {
    const d = options.sessionDurationMs;
    if (typeof d !== 'number' || !Number.isFinite(d) || Number.isNaN(d) || d < 0 || d > Number.MAX_SAFE_INTEGER) {
      throw new ValidationError('L’option sessionDurationMs doit être un nombre >= 0 et <= Number.MAX_SAFE_INTEGER.', { champ: 'sessionDurationMs', valeur: d });
    }
  }
  // Autres options numériques (timeouts, etc.)
  for (const key of Object.keys(options)) {
    if (/timeout/i.test(key) && typeof options[key] !== 'undefined') {
      const v = options[key];
      if (typeof v !== 'number' || !Number.isFinite(v) || Number.isNaN(v) || v < 0 || v > Number.MAX_SAFE_INTEGER) {
        throw new ValidationError(`L’option ${key} doit être un nombre >= 0 et <= Number.MAX_SAFE_INTEGER.`, { champ: key, valeur: v });
      }
    }
  }
}