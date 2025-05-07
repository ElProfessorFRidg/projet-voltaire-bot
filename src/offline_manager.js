// src/offline_manager.js
// Gestion centralisée du mode offline, de la file d’attente des actions et de la synchronisation à la reconnexion.
// Ce module est compatible navigateur : il n’importe que des dépendances web-compatibles.
// Le logger importé est automatiquement adapté à l’environnement (Node.js ou navigateur) : voir src/logger.js.
// Ce module est modulaire, documenté et facilement testable.

import logger from './logger.js';
import Notifications from './notifications.js';

/**
 * Statut de la connexion.
 * @type {boolean}
 */
let offline = false;

/**
 * File d’attente des actions utilisateur à synchroniser.
 * @type {Array<Function>}
 */
let actionQueue = [];

/**
 * Liste des callbacks à appeler lors d’un changement de statut online/offline.
 * @type {Array<Function>}
 */
let statusChangeCallbacks = [];

/**
 * Définit le mode offline, affiche une notification et log l’événement.
 */
export function setOffline() {
  if (!offline) {
    offline = true;
    logger.warn('[OFFLINE] Perte de connexion détectée. Passage en mode offline.');
    Notifications.show('Connexion perdue. Mode hors-ligne activé.', { type: 'error', persistent: true });
    statusChangeCallbacks.forEach(cb => cb(false));
  }
}

/**
 * Définit le mode online, synchronise les actions en attente, affiche une notification et log l’événement.
 */
export async function setOnline() {
  if (offline) {
    offline = false;
    logger.info('[ONLINE] Connexion rétablie. Synchronisation des actions en attente.');
    Notifications.show('Connexion rétablie. Synchronisation en cours...', { type: 'info' });
    statusChangeCallbacks.forEach(cb => cb(true));
    await synchronizeQueuedActions();
    Notifications.show('Synchronisation terminée. Mode en ligne réactivé.', { type: 'success' });
    logger.info('[SYNC] Synchronisation terminée. Actions en attente traitées.');
  }
}

/**
 * Retourne true si le mode offline est actif.
 * @returns {boolean}
 */
export function isOffline() {
  return offline;
}

/**
 * Met en file d’attente une action à synchroniser lors du retour en ligne.
 * @param {Function} action - Fonction asynchrone à exécuter lors de la reconnexion.
 */
export function queueAction(action) {
  if (typeof action === 'function') {
    actionQueue.push(action);
    logger.info('[QUEUE] Action mise en attente pour synchronisation ultérieure.');
  }
}

/**
 * Synchronise toutes les actions en attente avec le serveur.
 * Vide la file d’attente après exécution.
 */
export async function synchronizeQueuedActions() {
  logger.info(`[SYNC] Début de synchronisation de ${actionQueue.length} action(s) en attente.`);
  while (actionQueue.length > 0) {
    const action = actionQueue.shift();
    try {
      await action();
      logger.info('[SYNC] Action synchronisée avec succès.');
    } catch (err) {
      logger.error('[SYNC] Échec de la synchronisation d’une action : ' + err.message);
      // Optionnel : remettre l’action en file d’attente ou gérer l’erreur différemment
    }
  }
}

/**
 * Permet d’enregistrer un callback appelé à chaque changement de statut online/offline.
 * @param {Function} callback - (isOnline: boolean) => void
 */
export function onStatusChange(callback) {
  if (typeof callback === 'function') {
    statusChangeCallbacks.push(callback);
  }
}

// Pour les tests unitaires
export function _resetForTests() {
  offline = false;
  actionQueue = [];
  statusChangeCallbacks = [];
}