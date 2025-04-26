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