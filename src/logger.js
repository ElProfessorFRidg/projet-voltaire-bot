// Logger sécurisé et configurable pour l’application
import winston from 'winston';

// Fonction utilitaire pour anonymiser les emails dans les messages de log
function anonymizeEmails(message) {
  // Remplace les emails par une version masquée (ex: t***@d***.com)
  return typeof message === 'string'
    ? message.replace(
        /([a-zA-Z0-9._%+-])([a-zA-Z0-9._%+-]*)(@)([a-zA-Z0-9.-])([a-zA-Z0-9.-]*)(\.[a-zA-Z]{2,})/g,
        (match, p1, p2, at, d1, d2, ext) =>
          `${p1}***${at}${d1}***${ext}`
      )
    : message;
}

// Liste des niveaux de log autorisés
const allowedLevels = Object.keys(winston.config.npm.levels);

// Détermine dynamiquement le niveau de log (env ou fallback)
const logLevel =
  (process.env.LOG_LEVEL && allowedLevels.includes(process.env.LOG_LEVEL)
    ? process.env.LOG_LEVEL
    : null) ||
  (allowedLevels.includes('info') ? 'info' : allowedLevels[0]);

/**
 * Logger Winston sécurisé :
 * - Anonymisation automatique des emails dans tous les messages.
 * - Niveau de log configurable dynamiquement (LOG_LEVEL).
 * - Limitation des logs verbeux selon le niveau.
 */
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
          info =>
            `${info.timestamp} ${info.level}: ${anonymizeEmails(info.message)}`
        )
      )
    }),
    new winston.transports.File({
      level: allowedLevels.includes('debug') ? 'debug' : allowedLevels[0],
      filename: 'app.log',
      format: winston.format.combine(
        winston.format.json(),
        winston.format((info) => {
          info.message = anonymizeEmails(info.message);
          return info;
        })()
      )
    })
  ],
  exitOnError: false
});

export default logger;