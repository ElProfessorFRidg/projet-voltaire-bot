const winston = require('winston');

// Configuration du logger
const logger = winston.createLogger({
  levels: winston.config.npm.levels, // Utilise les niveaux standards (error, warn, info, http, verbose, debug, silly)
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' })
    // On pourrait ajouter d'autres formats globaux ici si nécessaire
  ),
  transports: [
    // Transport pour la console
    new winston.transports.Console({
      level: 'info', // Affiche info, warn, error dans la console
      format: winston.format.combine(
        winston.format.colorize(), // Ajoute des couleurs
        winston.format.printf(info => `${info.timestamp} ${info.level}: ${info.message}`) // Format personnalisé
      )
    }),
    // Transport pour le fichier
    new winston.transports.File({
      level: 'debug', // Enregistre tout à partir de debug dans le fichier
      filename: 'app.log', // Nom du fichier log (sera à la racine du projet)
      format: winston.format.combine(
        // Pas de colorize pour le fichier
        winston.format.json() // Enregistre les logs en format JSON
        // Alternative : format texte simple pour le fichier
        // winston.format.printf(info => `${info.timestamp} ${info.level}: ${info.message}`)
      )
    })
  ],
  exitOnError: false // Ne pas quitter l'application en cas d'erreur de logging
});

// Exporte l'instance configurée
module.exports = logger;