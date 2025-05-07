# Bot Projet Voltaire 🤖📚✍️

Un script Node.js pour automatiser certaines tâches sur la plateforme Projet Voltaire, en utilisant Playwright pour le contrôle du navigateur et l'API OpenAI pour l'assistance à la résolution.

**⚠️ Attention :** Ce projet est développé à des fins éducatives et expérimentales uniquement. L'automatisation de plateformes tierces peut enfreindre leurs conditions d'utilisation. Utilisez ce script de manière responsable et éthique.

---

## 🏗️ Architecture du projet

```
Projet Voltaire JS 2.0/
│
├── 🚀 main.js                # Point d'entrée principal & Orchestrateur
├── 📁 src/                   # Code source des modules
│   ├── ⚙️ config_loader.js   # Chargement et validation de la configuration
│   ├── 🌐 browser_manager.js # Gestion des sessions navigateur (Playwright) & profils
│   ├── 🔑 auth_handler.js    # Authentification sur la plateforme Voltaire
│   ├── 📄 exercise_parser.js # Extraction et analyse des exercices
│   ├── 🧠 solver_engine.js   # Orchestration de la résolution (OpenAI, logique)
│   ├── 🤖 openai_client.js   # Client pour l'API OpenAI
│   ├── 🚶 human_simulator.js # Simulation de comportements humains (délais, clics)
│   ├── ✨ popup_solver.js    # Gestion des popups spécifiques (exercices spéciaux)
│   ├── 📝 logger.js          # Logging centralisé (Winston) avec anonymisation
│   ├── ❗ error_utils.js     # Gestion centralisée des erreurs (classes personnalisées)
│   ├── ✅ validation_utils.js# Fonctions de validation stricte (email, env vars)
│   ├── 🚦 async_utils.js     # Outils de concurrence (Mutex, Semaphore)
│   ├── 🎯 selectors.js       # Centralisation des sélecteurs DOM
│   └── 🖥️ server.js          # Serveur Express (API interne, interface web potentielle)
│
├── 📁 config/
│   └── 🔒 accounts_config.json # Comptes Voltaire (NON VERSIONNÉ)
│   └── 🕒 session_times.json   # Stockage des temps de session (généré)
│   └── ✅ active_accounts.json # Sélection des comptes actifs (généré par UI)
│
├── 📁 public/                # Fichiers statiques pour l'interface web
│   ├── index.html
│   ├── script.js
│   └── style.css
│
├── 🧪 tests/                 # Tests unitaires (potentiellement Jest)
├── .env.example           # Exemple de configuration environnementale
├── .env                   # Configuration environnementale (NON VERSIONNÉ)
├── .gitignore             # Fichiers ignorés par Git
├── package.json           # Dépendances et scripts NPM
└── README.md              # Documentation technique (ce fichier)
```

---

## 🧩 Modules principaux

-   **main.js** : Point d'entrée, orchestre le lancement des sessions de bot pour chaque compte configuré. Gère le cycle de vie global.
-   **config_loader.js** : Charge et valide la configuration depuis `.env`, `accounts_config.json`, et gère la configuration dynamique via l'API.
-   **browser_manager.js** : Gère les instances Playwright (lancement, fermeture), les profils utilisateurs persistants, et la concurrence entre sessions.
-   **auth_handler.js** : Effectue l'authentification sur Projet Voltaire, gérant la page de connexion.
-   **exercise_parser.js** : Extrait les informations pertinentes des exercices affichés dans le navigateur (texte, type, options).
-   **solver_engine.js** : Coordonne la résolution d'un exercice : appelle `exercise_parser`, interroge `openai_client`, et simule les actions via `human_simulator`.
-   **openai_client.js** : Gère les requêtes à l'API OpenAI (construction du prompt, appel API, parsing de la réponse).
-   **human_simulator.js** : Simule des actions humaines (délais aléatoires, frappes de touches, mouvements de souris réalistes) pour éviter la détection.
-   **popup_solver.js** : Détecte et gère les popups spécifiques rencontrées (ex: exercices "Correct/Incorrect", "Peut-être/Peut être").
-   **logger.js** : Configure Winston pour un logging centralisé (console et fichier `app.log`), anonymise les emails, et permet un niveau de log configurable via `LOG_LEVEL`.
-   **server.js**: Met en place un serveur Express pour :
    *   Servir une interface web simple (`public/`).
    *   Fournir une API pour gérer la configuration (`/config`).
    *   Synchroniser l'état des sessions (`/api/session-sync`, `/api/time`).
    *   Gérer la sélection des comptes actifs (`/api/active-accounts`).

---

## 🛠️ Utilitaires

### error_utils.js
-   Définit des classes d’erreur personnalisées (`ValidationError`, `AuthError`, `AppError`, `SessionExpiredError`).
-   Fournit la fonction `handleError` pour logger ou propager proprement les erreurs, en distinguant les erreurs attendues des exceptions critiques.
-   Exemple d’utilisation :
    ```javascript
    import { ValidationError, handleError } from './error_utils.js';
    // ...
    handleError(err, logger, `[${sessionId}] Erreur lors de la validation`);
    ```

### validation_utils.js
-   Fonctions de validation strictes pour les emails, variables d’environnement, chaînes non vides, etc.
-   Lance des `ValidationError` spécifiques en cas d’invalidité pour une gestion d'erreur claire.
-   Exemple :
    ```javascript
    import { validateEmail, validateEnvVar } from './validation_utils.js';
    validateEmail(account.email, `Email invalide pour le compte ${account.id}`);
    validateEnvVar('OPENAI_API_KEY', process.env.OPENAI_API_KEY);
    ```

### async_utils.js
-   Fournit un `Mutex` (verrou exclusif) et un `Semaphore` (limitation du parallélisme) asynchrones.
-   Utile pour protéger l'accès concurrent aux profils de navigateur ou limiter le nombre de requêtes API simultanées.
-   Exemple :
    ```javascript
    import { Mutex } from './async_utils.js';
    const profileMutex = new Mutex();
    await profileMutex.runExclusive(async () => {
      // Accès exclusif au dossier du profil
    });
    ```

### selectors.js
-   Centralise **tous** les sélecteurs CSS/DOM utilisés par Playwright.
-   **Principe :** Toute modification de sélecteur doit impérativement passer par ce fichier pour garantir la cohérence et faciliter la maintenance en cas de changement de l'interface Voltaire.
-   Exemple :
    ```javascript
    import selectors from './selectors.js';
    await page.click(selectors.login.submitButton);
    const questionText = await page.textContent(selectors.exercise.questionText);
    ```

---

## 👤 Gestion des comptes Voltaire

Les identifiants sont stockés dans `config/accounts_config.json` (fichier à créer manuellement et **à ne pas versionner** - ajoutez-le à `.gitignore`).

```json
[
  {
    "id": "compte_unique_1", // Doit être unique
    "email": "utilisateur1@example.com",
    "password": "motdepasse_secret_1",
    "sessionDuration": "2h" // Optionnel: ex: "1h", "30m", "1.5h"
  },
  {
    "id": "compte_unique_2",
    "email": "utilisateur2@example.com",
    "password": "motdepasse_secret_2"
    // Pas de sessionDuration = session illimitée (ou jusqu'à fermeture manuelle)
  }
]
```
-   `id`: Identifiant unique pour le bot (utilisé pour les logs et la gestion des profils).
-   `email` / `password`: Identifiants de connexion Voltaire.
-   `sessionDuration` (optionnel) : Durée maximale de la session pour ce compte. Le format supporte `h` (heures) et `m` (minutes). S'il est omis, la session n'a pas de limite de temps interne.

---

## ⚙️ Configuration

La configuration principale se fait via le fichier `.env` (copier `.env.example` et adapter les valeurs).

**Variables clés :**
-   `OPENAI_API_KEY`: **Obligatoire**. Votre clé API OpenAI.
-   `OPENAI_MODEL`: Modèle OpenAI à utiliser (ex: `gpt-4o`, `gpt-3.5-turbo`). Peut être une liste séparée par des virgules pour une sélection aléatoire.
-   `LOG_LEVEL`: Niveau de log (`debug`, `info`, `warn`, `error`). `debug` est très verbeux.
-   `MAX_CONCURRENT_SESSIONS`: Nombre maximum de sessions navigateur lancées en parallèle.
-   `HUMAN_DELAY_MIN_MS` / `HUMAN_DELAY_MAX_MS`: Délais minimum/maximum (en ms) pour simuler les actions humaines.
-   `HEADLESS_MODE`: `true` pour lancer les navigateurs sans interface graphique, `false` pour les voir. (`true` recommandé pour serveur).
-   `SERVER_PORT`: Port pour le serveur Express (interface web et API).

Consultez `.env.example` pour la liste complète et les descriptions détaillées des options avancées (timeouts, sélecteurs si nécessaire, etc.).

---

## 🚀 Installation et lancement

1.  **Cloner le dépôt :**
    ```bash
    git clone https://github.com/ElProfessorFRidg/projet-voltaire-bot # Remplacez par l'URL réelle si différente
    cd projet-voltaire-bot
    ```
2.  **Installer les dépendances :**
    ```bash
    npm install
    ```
3.  **Installer les navigateurs Playwright :** (Chromium est généralement suffisant)
    ```bash
    npx playwright install --with-deps chromium
    ```
4.  **Configurer l’environnement :**
    *   Copier `.env.example` en `.env` et **remplir les valeurs obligatoires** (notamment `OPENAI_API_KEY`). Ajustez les autres selon vos besoins.
    *   Créer le dossier `config/`.
    *   Créer le fichier `config/accounts_config.json` et y ajouter vos comptes Voltaire (voir section "Gestion des comptes").
    *   **Important :** Ajouter `.env` et `config/accounts_config.json` à votre fichier `.gitignore` si ce n'est pas déjà fait !

5.  **Lancer le bot :**
    ```bash
    node main.js
    ```
    Le serveur démarrera et les sessions de bot pour les comptes configurés (et sélectionnés via l'UI si utilisée) seront lancées.

6.  **(Optionnel) Accéder à l'interface web :**
    Ouvrez votre navigateur et allez à `http://localhost:PORT` (où `PORT` est la valeur de `SERVER_PORT` dans votre `.env`, par défaut 3000). Vous pourrez y voir l'état des sessions, modifier la configuration et sélectionner les comptes actifs.

---

## ✨ Exemples d’utilisation

### Lancement standard
```bash
node main.js
```
(Utilise la configuration de `.env` et `config/accounts_config.json`)

### Lancer avec un niveau de log détaillé (override .env)
```bash
LOG_LEVEL=debug node main.js
```

### Lancer en mode Headless (override .env)
```bash
HEADLESS_MODE=true node main.js
```

### Lancer uniquement certains comptes (via l'interface web)
1.  Lancez `node main.js`.
2.  Accédez à `http://localhost:PORT`.
3.  Dans la section "Comptes Actifs", sélectionnez les comptes souhaités et cliquez sur "Sauvegarder la sélection".
4.  Le bot prendra en compte cette sélection au prochain démarrage ou lors du rechargement dynamique (si implémenté).

---

## 🧪 Tests

-   Les tests unitaires (si présents) sont dans le dossier `tests/`.
-   Utilisez la commande définie dans `package.json` (souvent `npm test`) pour les lancer.
    ```bash
    npm test
    ```
-   Si Jest est utilisé, vous pouvez lancer des tests spécifiques :
    ```bash
    npx jest tests/async_utils.test.js # Exemple
    ```

---

## ☁️ Déploiement

-   Ce projet est principalement conçu pour un usage local ou sur un serveur personnel.
-   **Sécurité :** Assurez-vous que les fichiers `.env` et `config/accounts_config.json` ne sont **jamais** exposés publiquement. Gérez les permissions de fichiers de manière stricte.
-   **Ressources :** Lancer plusieurs navigateurs (surtout non-headless) consomme beaucoup de RAM et de CPU. Adaptez `MAX_CONCURRENT_SESSIONS` aux capacités de votre machine.
-   **Stabilité :** Utilisez un gestionnaire de processus comme `pm2` pour maintenir le script en cours d'exécution et gérer les redémarrages et les logs.
    ```bash
    npm install pm2 -g
    pm2 start main.js --name projet-voltaire-bot
    pm2 logs projet-voltaire-bot
    pm2 stop projet-voltaire-bot
    pm2 delete projet-voltaire-bot
    ```
-   **Logs :** Les logs sont générés dans `app.log` (configurable via `logger.js` si besoin). Mettez en place une rotation des logs pour éviter que le fichier ne devienne trop volumineux.

---

## 📦 Dépendances principales

-   [Playwright](https://playwright.dev/) : Automatisation et contrôle de navigateurs modernes.
-   [OpenAI Node.js Library](https://github.com/openai/openai-node) : Client officiel pour l'API OpenAI.
-   [dotenv](https://github.com/motdotla/dotenv) : Chargement des variables d’environnement depuis `.env`.
-   [Winston](https://github.com/winstonjs/winston) : Système de logging flexible et configurable.
-   [Express](https://expressjs.com/) : Framework web minimaliste pour l'API et l'interface.
-   [Ajv](https://ajv.js.org/) : Validation de schémas JSON (utilisé pour `accounts_config.json`).

---

## 🗺️ Schéma d’architecture simplifié

```
+-------------------------+      +-------------------------+      +-------------------------+
|      💻 Interface Web     | <--> |      🚀 main.js         |      |      📝 logger.js       |
| (public/, Express Route)|      |   (Orchestrateur)       |      |     (Winston)         |
+-------------^-----------+      +------------|------------+      +------------^------------+
              |                             |                             |
              | API (Express)               v                             |
+-------------v-----------+      +-------------------------+      +-------|-----------------+
|      ⚙️ server.js        | ---> |   ⚙️ config_loader.js   | ---->| (Utilise le logger)     |
| (API REST, Static Files)|      | (.env, accounts.json)   |      +-------------------------+
+-------------^-----------+      +------------|------------+
              |                             v
              | (Start/Stop/Status)         | (Pour chaque compte actif)
+-------------|-----------------------------v------------------------------------------------+
|             |        +-------------------------+      +-------------------------+          |
|             |------->|  🌐 browser_manager.js  | ---> |     🔑 auth_handler.js  |          |
|             |        | (Playwright Sessions)   |      |       (Login Logic)     |          |
| Session     |        +------------|------------+      +------------|------------+          |
| Management  |                     v                             v                        |
|             |        +-------------------------+      +-------------------------+          |
|             |        |  📄 exercise_parser.js | <--> |    🧠 solver_engine.js  |          |
|             |        |   (DOM Extraction)      |      | (Coordination, State)   |          |
|             |        +-------------------------+      +----|-------|-------|----+          |
|             |                                              |       |       |               |
|             |        +-------------------------+ <---------+       |       +-------------> +-------------------------+
|             |        |   🤖 openai_client.js   |                 |                         |   🚶 human_simulator.js |
|             |        |      (API Calls)        |                 |                         |     (Delays, Clicks)    |
|             |        +-------------------------+                 v                         +-------------------------+
|             |                                       +-------------------------+
|             |                                       |   ✨ popup_solver.js    |
|             |                                       | (Specific Popups Logic) |
|             |                                       +-------------------------+
+------------------------------------------------------------------------------------------+

```

---

## 🚧 TODO / Améliorations Futures

*   **Interface Web :**
    *   [`server.js:549`] Servir correctement les fichiers statiques (`index.html`, `script.js`, `style.css`) depuis le dossier `public/`.
    *   [`script.js:599`] Utiliser l'URL réelle de l'API de synchronisation du serveur dans le script frontend.
    *   Améliorer l'UI pour afficher plus de détails sur les sessions (exercice en cours, erreurs, etc.).
    *   Ajouter la possibilité de démarrer/arrêter des sessions individuelles depuis l'UI.
*   **Configuration :**
    *   [`main.js:243`] Rendre le mode `headless` configurable dynamiquement via l'API/UI ou par compte.
    *   [`config_loader.js:246`] Implémenter un mécanisme (ex: EventEmitter) pour notifier les modules concernés (ex: `main.js`) lorsqu'une configuration est modifiée via l'API, pour une prise en compte sans redémarrage.
*   **Moteur de résolution :**
    *   [`solver_engine.js:568`] Implémenter une logique de sélection plus robuste pour les exercices (pas seulement le premier visible). Gérer les cas d'erreur (ex: exercice non reconnu) et potentiellement intégrer une assistance utilisateur si OpenAI échoue.
    *   [`exercise_parser.js:41`] Ajouter la logique pour déterminer précisément le *type* d'exercice (QCM, faute à cliquer, etc.) pour adapter la stratégie de résolution.
    *   Améliorer la gestion des timeouts et des attentes d'éléments pour plus de résilience face aux variations de chargement de page.
    *   Explorer des stratégies alternatives si OpenAI est indisponible ou renvoie des erreurs.
*   **Logging & Debugging :**
    *   [`solver_engine.js:461`, `solver_engine.js:485`] Passer systématiquement le `sessionId` aux fonctions utilitaires (`parseExercise`, `getCorrection`) pour un logging contextuel plus précis.
    *   Réactiver/améliorer les logs `debug` commentés dans `solver_engine.js` et `popup_solver.js` pour faciliter le diagnostic.
*   **Robustesse :**
    *   Améliorer la gestion des erreurs réseau (connexion à Voltaire, API OpenAI).
    *   Gérer les changements inattendus dans la structure DOM de Projet Voltaire (maintenance des sélecteurs).
*   **Tests :**
    *   Augmenter la couverture des tests unitaires.
    *   Ajouter des tests d'intégration pour simuler des scénarios complets.

---

## 🐛 Bugs Connus / Points d'Attention

*   **Détection :** L'automatisation intensive peut potentiellement être détectée par Projet Voltaire, même avec des simulations humaines. L'utilisation de délais trop courts ou d'actions trop répétitives augmente ce risque.
*   **Changements d'UI Voltaire :** Le bot dépend fortement des sélecteurs DOM. Toute mise à jour de l'interface de Projet Voltaire peut casser le bot et nécessitera une mise à jour des sélecteurs dans `src/selectors.js`.
*   **Fiabilité OpenAI :** La qualité des réponses dépend de la performance et de la disponibilité de l'API OpenAI, ainsi que de la clarté du prompt généré. Des réponses incorrectes ou des erreurs API sont possibles.
*   **Gestion des Popups :** La logique dans `popup_solver.js` est spécifique aux types de popups rencontrés lors du développement. De nouveaux types de popups pourraient ne pas être gérés.
*   **Gestion d'état complexe :** Dans certains scénarios (ex: perte de connexion temporaire, exercice non standard), l'état du bot pourrait devenir incohérent, nécessitant potentiellement un redémarrage manuel de la session concernée.
*   **Performance :** Lancer de nombreuses sessions en parallèle, surtout en mode non-headless, peut consommer beaucoup de ressources système (RAM, CPU).

---

## ⚠️ Avertissement Légal et Éthique

L'utilisation de ce script est **à vos propres risques**. L'automatisation de plateformes tierces comme Projet Voltaire peut enfreindre leurs Conditions Générales d'Utilisation (CGU) et potentiellement entraîner des sanctions, y compris la **suspension ou la fermeture de votre compte**.

Les développeurs de ce projet déclinent toute responsabilité quant aux conséquences découlant de son utilisation. Ce projet est fourni "tel quel", sans garantie d'aucune sorte, à des fins **strictement éducatives et expérimentales**.

**Utilisez ce script de manière responsable, éthique et en pleine connaissance des risques.** Ne l'utilisez pas à des fins de triche ou de manière à nuire à la plateforme ou à d'autres utilisateurs.

---

## 📄 Licence

Ce projet est sous licence ISC. Voir les informations du `package.json` pour plus de détails.
(Si un fichier `LICENSE` existe, référez-vous y également).