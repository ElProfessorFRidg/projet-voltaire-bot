// Logger universel : compatible Node.js (Winston) ET navigateur (console)
// Ce module isole toute dépendance Node.js pour éviter les erreurs d’import côté client.
// Utilisez ce logger dans les modules partagés. Il sélectionne automatiquement l’implémentation adaptée.

/**
 * Logger web-compatible pour le navigateur (fallback sur console).
 * Fournit les méthodes : info, warn, error, log (API minimale compatible Winston).
 */
function createBrowserLogger() {
  // Anonymisation simple des emails (optionnel)
  function anonymizeEmails(message) {
    return typeof message === 'string'
      ? message.replace(
          /([a-zA-Z0-9._%+-])([a-zA-Z0-9._%+-]*)(@)([a-zA-Z0-9.-])([a-zA-Z0-9.-]*)(\.[a-zA-Z]{2,})/g,
          (match, p1, p2, at, d1, d2, ext) =>
            `${p1}***${at}${d1}***${ext}`
        )
      : message;
  }
  return {
    info: () => {}, // Ne rien faire pour info
    warn: () => {}, // Ne rien faire pour warn
    error: (...args) => {
      let context = {};
      if (args.length > 0 && typeof args[args.length - 1] === 'object' && args[args.length - 1] !== null && !(args[args.length - 1] instanceof Error)) {
        context = args.pop(); // Extraire le contexte s'il est le dernier argument et est un objet (non-Error)
      }
      const messages = args.map(anonymizeEmails);
      if (Object.keys(context).length > 0) {
        console.error('[ERROR]', ...messages, JSON.stringify(context));
      } else {
        console.error('[ERROR]', ...messages);
      }
    }, // Conserver error et ajouter le contexte
    log: () => {}, // Ne rien faire pour log
    debug: () => {}, // Ne rien faire pour debug
  };
}

/**
 * Logger serveur basé sur Winston (Node.js uniquement).
 * Fournit les mêmes méthodes que le logger navigateur.
 * Import dynamique de Winston pour compatibilité ES module.
 */
async function createNodeLogger() {
  // Import dynamique de winston uniquement côté Node.js
  const winston = (await import('winston')).default || (await import('winston'));
  function anonymizeEmails(message) {
    return typeof message === 'string'
      ? message.replace(
          /([a-zA-Z0-9._%+-])([a-zA-Z0-9._%+-]*)(@)([a-zA-Z0-9.-])([a-zA-Z0-9.-]*)(\.[a-zA-Z]{2,})/g,
          (match, p1, p2, at, d1, d2, ext) =>
            `${p1}***${at}${d1}***${ext}`
        )
      : message;
  }
  const allowedLevels = Object.keys(winston.config.npm.levels);
  const logLevel =
    (process.env.LOG_LEVEL && allowedLevels.includes(process.env.LOG_LEVEL)
      ? process.env.LOG_LEVEL
      : null) ||
    (allowedLevels.includes('info') ? 'info' : allowedLevels[0]);
  const logger = winston.createLogger({
    levels: winston.config.npm.levels,
    format: winston.format.combine(
      winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' })
    ),
    transports: [
      new winston.transports.Console({
        level: logLevel,
        format: winston.format.combine(
          winston.format.colorize(),
          winston.format.printf(
            info => {
              const message = anonymizeEmails(info.message);
              // Winston place automatiquement les métadonnées (comme notre contexte) dans l'objet info
              const contextString = info.context ? ` Context: ${JSON.stringify(info.context)}` : '';
              return `${info.timestamp} ${info.level}: ${message}${contextString}`;
            }
          )
        )
      }),
      new winston.transports.File({
        level: allowedLevels.includes('debug') ? 'debug' : allowedLevels[0],
        filename: 'app.log',
        format: winston.format.combine(
          winston.format.json(),
          winston.format((info) => {
            // L'anonymisation est déjà faite dans la fonction error avant l'appel à logger.error
            // info.message = anonymizeEmails(info.message);
            // Le contexte est ajouté comme métadonnées et sera inclus par le format json()
            return info;
          })()
        )
      })
    ],
    exitOnError: false
  });
  // Adapter l’API pour correspondre à celle du navigateur
  return {
    info: (...args) => logger.info(args.map(anonymizeEmails).join(' ')),
    warn: (...args) => logger.warn(args.map(anonymizeEmails).join(' ')),
    error: (...args) => {
      let context = {};
      if (args.length > 0 && typeof args[args.length - 1] === 'object' && args[args.length - 1] !== null && !(args[args.length - 1] instanceof Error)) {
        context = args.pop(); // Extraire le contexte
      }
      const message = args.map(anonymizeEmails).join(' ');
      // Passer le contexte comme métadonnées à Winston. Winston l'ajoutera à l'objet 'info'.
      logger.error(message, { context });
    },
    log: (...args) => logger.info(args.map(anonymizeEmails).join(' ')),
    debug: (...args) => logger.debug(args.map(anonymizeEmails).join(' ')),
  };
}

/**
 * Fonction d’obtention du logger universel.
 * - Côté navigateur : retourne immédiatement le logger console.
 * - Côté Node.js : retourne une promesse résolue avec le logger Winston.
 * 
 * Utilisation recommandée (dans un module ES) :
 *   import getLogger from './logger.js';
 *   const logger = await getLogger();
 * 
 * Pour les tests, vous pouvez forcer une implémentation spécifique en surchargeant getLogger.
 */
async function getLogger() {
  // Détection d’environnement navigateur
  if (typeof window !== 'undefined' && typeof window.document !== 'undefined') {
    return createBrowserLogger();
  }
  // Sinon, environnement Node.js
  return await createNodeLogger();
}

export default getLogger;