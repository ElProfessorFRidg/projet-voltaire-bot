/**
 * Toutes les dates et heures manipulées dans ce module sont en UTC (timestamps JS).
 * Pour l’affichage localisé, utiliser la fonction formatDateLocalized ci-dessous.
 */

/**
 * Formate une date UTC en chaîne localisée selon la langue et le fuseau utilisateur.
 * @param {Date|number|string} date - Date JS, timestamp (ms), ou chaîne ISO.
 * @param {string} [locale] - Locale BCP 47 (ex: 'fr-FR', 'en-US').
 * @param {string} [timeZone] - Fuseau horaire IANA (ex: 'Europe/Paris').
 * @param {Object} [options] - Options Intl.DateTimeFormat.
 * @returns {string} - Date/heure formatée localement.
 */
export function formatDateLocalized(date, locale = undefined, timeZone = undefined, options = {}) {
  // Validation stricte des paramètres
  if (date === null || date === undefined) {
    throw new Error('Le paramètre "date" ne peut être null ou undefined');
  }
  if (
    !(date instanceof Date) &&
    typeof date !== 'number' &&
    typeof date !== 'string'
  ) {
    throw new Error('Le paramètre "date" doit être un objet Date, un nombre (timestamp) ou une chaîne ISO');
  }
  let d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) {
    throw new Error('Le paramètre "date" est invalide ou non convertible en date');
  }
  // Vérification des bornes pour les timestamps numériques
  if (typeof date === 'number') {
    if (date < 0 || date > Number.MAX_SAFE_INTEGER) {
      throw new Error('Le timestamp "date" doit être compris entre 0 et Number.MAX_SAFE_INTEGER');
    }
  }
  // Assertion interne
  if (!(d instanceof Date) || isNaN(d.getTime())) {
    throw new Error('Assertion interne: la date n\'est pas valide après conversion');
  }
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    ...options
  }).format(d);
}
// Utilitaires pour la gestion du temps de session

/**
 * Calcule le timestamp de fin de session à partir d'un début et d'une durée (en ms)
 * @param {number} startTime - Timestamp de début (ms)
 * @param {number} durationMs - Durée de la session (ms)
 * @returns {number} - Timestamp de fin de session (ms)
 */
export function calculateSessionEnd(startTime, durationMs) {
  // Validation stricte des paramètres
  // Validation stricte des paramètres
  if (
    typeof startTime !== 'number' ||
    typeof durationMs !== 'number' ||
    isNaN(startTime) || // isNaN gère déjà NaN
    isNaN(durationMs) ||
    startTime === null || // Ces vérifications sont redondantes si typeof est number
    durationMs === null ||
    startTime === undefined || // Idem
    durationMs === undefined
  ) {
    // Simplification possible, mais gardons la robustesse pour l'instant
    throw new Error('Paramètres invalides pour calculateSessionEnd: startTime et durationMs doivent être des nombres.');
  }

  // Vérification de la finitude des entrées
  if (!Number.isFinite(startTime)) {
    throw new RangeError('startTime doit être un nombre fini.');
  }
  if (!Number.isFinite(durationMs)) {
    throw new RangeError('durationMs doit être un nombre fini.');
  }

  // Vérification des bornes inférieures (déjà présentes, mais on peut les garder)
  if (startTime < 0 || durationMs < 0) {
    throw new RangeError('startTime et durationMs doivent être ≥ 0.');
  }

  // Vérification des bornes supérieures (MAX_SAFE_INTEGER)
  // Note: isFinite gère déjà Infinity, mais MAX_SAFE_INTEGER est une contrainte métier/pratique
  if (
    startTime > Number.MAX_SAFE_INTEGER ||
    durationMs > Number.MAX_SAFE_INTEGER
  ) {
    // On pourrait lever une RangeError ici aussi pour la cohérence
    throw new RangeError(`startTime (${startTime}) et durationMs (${durationMs}) ne doivent pas dépasser Number.MAX_SAFE_INTEGER (${Number.MAX_SAFE_INTEGER}).`);
  }

  // Calcul et gestion overflow/finitude du résultat
  const end = startTime + durationMs;

  // Vérifier si le résultat est fini ET dans les limites sûres
  if (!Number.isFinite(end)) {
      throw new RangeError(`Le calcul du timestamp de fin (${startTime} + ${durationMs}) résulte en une valeur non finie (${end}).`);
  }
  if (end > Number.MAX_SAFE_INTEGER) {
    // Cette vérification est techniquement redondante si les entrées sont <= MAX_SAFE_INTEGER
    // et que leur somme ne dépasse pas Number.MAX_VALUE (géré par isFinite),
    // mais elle assure la contrainte explicite de rester dans les entiers sûrs.
    throw new RangeError(`Le calcul du timestamp de fin (${end}) dépasse Number.MAX_SAFE_INTEGER (${Number.MAX_SAFE_INTEGER}).`);
  }

  // Assertion interne (peut être redondante avec les vérifications précédentes)
  // Si startTime et durationMs sont >= 0, end devrait toujours être >= startTime.
  // Cette vérification pourrait attraper des cas très étranges de comportement numérique.
  if (end < startTime) {
    // Utiliser console.error pour tracer ce cas rare sans bloquer si possible
    console.error(`Assertion interne: overflow/underflow inattendu détecté dans calculateSessionEnd (${startTime} + ${durationMs} = ${end})`);
    // On pourrait choisir de lever une erreur ou de retourner une valeur par défaut/erreur selon la politique de gestion d'erreurs.
    // Levons une erreur pour la sécurité.
    throw new Error('Assertion interne: résultat de fin de session incohérent détecté.');
  }

  return end;
}

/**
 * Erreur spécifique pour les formats de durée invalides.
 */
export class DurationFormatError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DurationFormatError';
  }
}

/**
 * Erreur spécifique pour les durées hors limites (trop grandes, nulles, négatives).
 */
export class DurationRangeError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DurationRangeError';
  }
}

/**
 * Convertit une chaîne de durée (ex: "2h", "30m", "1h 30m") en millisecondes.
 * Gère les heures (h) et les minutes (m), insensibles à la casse et aux espaces.
 * @param {string} durationStr - La chaîne de durée à analyser.
 * @returns {number} - La durée totale en millisecondes.
 * @throws {DurationFormatError} Si la chaîne est vide, nulle, ou a un format invalide (unité inconnue, caractères non numériques, etc.).
 * @throws {DurationRangeError} Si la durée calculée est nulle, négative, ou dépasse Number.MAX_SAFE_INTEGER.
 */
export function parseDurationString(durationStr) {
  // 1. Validation initiale stricte
  if (typeof durationStr !== 'string' || !durationStr || durationStr.trim() === '') {
    throw new DurationFormatError('La chaîne de durée ne peut être vide ou nulle.');
  }

  const trimmedStr = durationStr.trim();
  // Regex stricte: uniquement chiffres+h et/ou chiffres+m, avec espaces optionnels.
  // Doit correspondre à toute la chaîne.
  const durationRegex = /^(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?$/i;
  const match = trimmedStr.match(durationRegex);

  // 2. Vérifier la correspondance exacte du format et la présence d'au moins une unité
  if (!match || trimmedStr !== match[0] || (!match[1] && !match[2])) {
    // Gère "1h 30m extra", "2x", "Infinityh", "123", "" (déjà géré), "h", "m"
    throw new DurationFormatError(`Format de durée invalide: "${durationStr}". Utilisez un format comme "2h", "30m" ou "1h 30m".`);
  }

  const hoursStr = match[1];
  const minutesStr = match[2];
  let hours = 0;
  let minutes = 0;

  // 3. Parser les valeurs numériques (la regex garantit que ce sont des chiffres)
  try {
    hours = hoursStr ? parseInt(hoursStr, 10) : 0;
    minutes = minutesStr ? parseInt(minutesStr, 10) : 0;

    // Sécurité supplémentaire: vérifier NaN (ne devrait pas arriver) ou valeurs négatives (idem)
    if (isNaN(hours) || isNaN(minutes)) {
       throw new DurationFormatError('Valeur numérique invalide détectée dans la durée.');
    }
     if (hours < 0 || minutes < 0) { // Théoriquement impossible avec \d+
       throw new DurationFormatError('Les valeurs de durée ne peuvent pas être négatives.');
     }

  } catch (e) {
    // Relancer l'erreur de format si elle a été levée, sinon erreur générique
    if (e instanceof DurationFormatError) throw e;
    // Une erreur ici serait très inattendue (ex: parseInt échoue sur des chiffres?)
    throw new Error(`Erreur interne lors de l'analyse des nombres de durée: ${e.message}`);
  }

  // 4. Vérifier si la durée totale est positive
  if (hours === 0 && minutes === 0) {
    // Gère "0h", "0m", "0h 0m"
    throw new DurationRangeError('La durée totale spécifiée doit être positive.');
  }

  // 5. Calculer les millisecondes totales avec BigInt pour la sécurité
  let totalMilliseconds = 0;
  try {
    const hoursBigInt = BigInt(hours);
    const minutesBigInt = BigInt(minutes);
    const msInHour = BigInt(3600000);
    const msInMinute = BigInt(60000);

    const hoursMs = hoursBigInt * msInHour;
    const minutesMs = minutesBigInt * msInMinute;
    const totalMsBigInt = hoursMs + minutesMs;

    // 6. Vérifier le dépassement de MAX_SAFE_INTEGER
    const maxSafeIntBigInt = BigInt(Number.MAX_SAFE_INTEGER);
    if (totalMsBigInt > maxSafeIntBigInt) {
      throw new DurationRangeError(`La durée calculée (${totalMsBigInt} ms) dépasse la limite maximale autorisée (${Number.MAX_SAFE_INTEGER} ms).`);
    }

    // Reconvertir en Number (maintenant sûr)
    totalMilliseconds = Number(totalMsBigInt);

  } catch (e) {
    // Relancer l'erreur spécifique si levée, sinon erreur générique
    if (e instanceof DurationRangeError) throw e;
    // Gérer les erreurs de BigInt (ex: si hours/minutes étaient Infinity, ce qui est filtré avant)
    throw new Error(`Erreur interne lors du calcul des millisecondes: ${e.message}`);
  }

  // 7. Assertion finale (sécurité supplémentaire)
  if (totalMilliseconds <= 0 || !Number.isSafeInteger(totalMilliseconds)) {
     console.error(`Assertion interne échouée: durée en ms invalide (${totalMilliseconds}) pour l'entrée "${durationStr}".`);
     throw new Error(`Assertion interne: durée en ms invalide après calcul (${totalMilliseconds}).`);
  }

  return totalMilliseconds;
}