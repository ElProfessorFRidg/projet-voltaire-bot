// Module Notifications : gestion des notifications en temps réel via Socket.IO

// Ce module suppose que socket.io-client est déjà chargé dans la page (via <script> ou import).
// Il expose une classe Notifications pour gérer l’état et les interactions.

/**
 * Classe Notifications compatible <script> classique (pas d'export/import)
 * Expose Notifications sur window.Notifications
 */
class Notifications {
  constructor(socket) {
    this.socket = socket;
    this.notifications = []; // { id, message, date, lu }
    this.listeners = [];
    this._setupSocket();
  }

  _setupSocket() {
    this.socket.on('notification', (data) => {
      const notif = {
        id: data.id || Date.now() + Math.random(),
        message: data.message,
        date: data.date ? new Date(data.date) : new Date(),
        lu: false
      };
      this.notifications.unshift(notif);
      this._notifyListeners();
    });
  }

  // Permet à l’UI de s’abonner aux changements de notifications
  onUpdate(listener) {
    this.listeners.push(listener);
  }

  _notifyListeners() {
    this.listeners.forEach((cb) => cb(this.notifications));
  }

  // Retourne la liste des notifications (copie)
  getNotifications() {
    return this.notifications.slice();
  }

  // Marque une notification comme lue
  markAsRead(id) {
    const notif = this.notifications.find(n => n.id === id);
    if (notif && !notif.lu) {
      notif.lu = true;
      this._notifyListeners();
      // Optionnel : informer le serveur qu’elle a été lue
      this.socket.emit('notification_read', { id });
    }
  }
  // Méthode statique pour compatibilité ES module : Notifications.show(...)
  static show(message) {
    // Utilisation de l’API Notification si disponible, sinon fallback alert
    if (typeof window !== 'undefined' && "Notification" in window) {
      if (Notification.permission === "granted") {
        new Notification(message);
      } else if (Notification.permission !== "denied") {
        Notification.requestPermission().then(permission => {
          if (permission === "granted") {
            new Notification(message);
          } else {
            alert(message);
          }
        });
      } else {
        alert(message);
      }
    } else {
      alert(message);
    }
  }
}
 
// Expose la classe Notifications globalement
if (typeof window !== 'undefined') {
  window.Notifications = Notifications;
}

// Export ES module par défaut pour import Notifications from './notifications.js'
export default Notifications;