// Utilitaires pour la gestion du temps de session

/**
 * Calcule le timestamp de fin de session à partir d'un début et d'une durée (en ms)
 * @param {number} startTime - Timestamp de début (ms)
 * @param {number} durationMs - Durée de la session (ms)
 * @returns {number} - Timestamp de fin de session (ms)
 */
export function calculateSessionEnd(startTime, durationMs) {
  if (typeof startTime !== 'number' || typeof durationMs !== 'number' || isNaN(startTime) || isNaN(durationMs)) {
    throw new Error('Paramètres invalides pour calculateSessionEnd');
  }
  return startTime + durationMs;
}

/**
 * Convertit une chaîne de durée de type "2h" ou "1.5h" en millisecondes
 * @param {string} durationStr
 * @returns {number} - Durée en ms
 */
export function parseDurationString(durationStr) {
  if (typeof durationStr !== 'string') return NaN;
  const match = durationStr.match(/^(\d+(\.\d+)?)h$/i);
  if (!match) return NaN;
  const hours = parseFloat(match[1]);
  return hours > 0 ? hours * 60 * 60 * 1000 : NaN;
}