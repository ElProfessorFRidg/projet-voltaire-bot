// src/human_simulator.js

/**
 * Met en pause l'exécution pendant la durée spécifiée.
 * @param {number} ms Durée de la pause en millisecondes.
 * @returns {Promise<void>} Une promesse qui se résout après le délai.
 */
function delay(ms) {
  if (typeof ms !== 'number' || isNaN(ms) || ms < 0) {
    throw new TypeError('delay: ms doit être un nombre positif');
  }
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Génère un entier aléatoire entre min (inclus) et max (inclus).
 * @param {number} min La borne minimale.
 * @param {number} max La borne maximale.
 * @returns {number} Un entier aléatoire dans l'intervalle spécifié.
 */
function getRandomInt(min, max) {
  if (typeof min !== 'number' || typeof max !== 'number' || isNaN(min) || isNaN(max)) {
    throw new TypeError('getRandomInt: min et max doivent être des nombres');
  }
  if (min > max) {
    throw new RangeError('getRandomInt: min ne peut pas être supérieur à max');
  }
  min = Math.ceil(min);
  max = Math.floor(max);
  // Si min == max, retourne min (unique valeur possible)
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Introduit une pause d'une durée aléatoire comprise entre minMs et maxMs.
 * @param {number} minMs Durée minimale de la pause en millisecondes.
 * @param {number} maxMs Durée maximale de la pause en millisecondes.
 * @returns {Promise<void>} Une promesse qui se résout après le délai aléatoire.
 */
async function randomDelay(minMs, maxMs) {
  if (typeof minMs !== 'number' || typeof maxMs !== 'number' || isNaN(minMs) || isNaN(maxMs)) {
    throw new TypeError('randomDelay: minMs et maxMs doivent être des nombres');
  }
  if (minMs > maxMs) {
    throw new RangeError('randomDelay: minMs ne peut pas être supérieur à maxMs');
  }
  const duration = getRandomInt(minMs, maxMs);
  await delay(duration);
}

module.exports = {
  delay,
  getRandomInt,
  randomDelay,
};