// src/async_utils.js
// Utilitaires asynchrones pour la gestion de la concurrence (Mutex, Semaphore)

/**
 * Mutex asynchrone (verrou exclusif)
 */
export class Mutex {
  constructor() {
    this._locked = false;
    this._waiting = [];
  }

  async lock() {
    if (this._locked) {
      await new Promise(resolve => this._waiting.push(resolve));
    }
    this._locked = true;
  }

  unlock() {
    if (this._waiting.length > 0) {
      const next = this._waiting.shift();
      next();
    } else {
      this._locked = false;
    }
  }

  /**
   * Exécute une fonction protégée par le mutex
   */
  async runExclusive(fn) {
    await this.lock();
    try {
      return await fn();
    } finally {
      this.unlock();
    }
  }
}

/**
 * Sémaphore asynchrone (limitation du parallélisme)
 */
export class Semaphore {
  constructor(maxConcurrency) {
    this._maxConcurrency = maxConcurrency;
    this._current = 0;
    this._queue = [];
  }

  async acquire() {
    if (this._current < this._maxConcurrency) {
      this._current++;
      return;
    }
    await new Promise(resolve => this._queue.push(resolve));
    this._current++;
  }

  release() {
    this._current--;
    if (this._queue.length > 0) {
      const next = this._queue.shift();
      next();
    }
  }

  /**
   * Exécute une fonction protégée par le sémaphore
   */
  async runExclusive(fn) {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}