import winston from 'winston';

// Liste des niveaux de log autorisés (pour robustesse)
const allowedLevels = Object.keys(winston.config.npm.levels);

/**
 * Crée et configure un logger Winston pour l'application.
 * - Console : niveau 'info' et supérieur, format colorisé et lisible.
 * - Fichier : niveau 'debug' et supérieur, format JSON.
 */
const logger = winston.createLogger({
  levels: winston.config.npm.levels,
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' })
  ),
  transports: [
    new winston.transports.Console({
      level: allowedLevels.includes('info') ? 'info' : allowedLevels[0],
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(
          info => `${info.timestamp} ${info.level}: ${info.message}`
        )
      )
    }),
    new winston.transports.File({
      level: allowedLevels.includes('debug') ? 'debug' : allowedLevels[0],
      filename: 'app.log',
      format: winston.format.json()
    })
  ],
  exitOnError: false
});

export default logger;