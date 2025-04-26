# Bot Projet Voltaire 🤖📚✍️

Un script Node.js pour automatiser certaines tâches sur la plateforme Projet Voltaire, en utilisant Playwright pour le contrôle du navigateur et l'API OpenAI pour l'assistance à la résolution.

**Attention :** Ce projet est développé à des fins éducatives et expérimentales uniquement. L'automatisation de plateformes tierces peut enfreindre leurs conditions d'utilisation. Utilisez ce script de manière responsable et éthique.

---

## Architecture du projet 🏗️

```
Projet Voltaire JS 2.0
│
├── main.js                # Point d'entrée principal
├── src/
│   ├── config_loader.js   # Chargement et validation de la configuration
│   ├── browser_manager.js # Gestion des sessions navigateur (Playwright)
│   ├── auth_handler.js    # Authentification sur la plateforme Voltaire
│   ├── exercise_parser.js # Extraction et analyse des exercices
│   ├── solver_engine.js   # Orchestration de la résolution (OpenAI, logique)
│   ├── openai_client.js   # Client pour l'API OpenAI
│   ├── human_simulator.js # Simulation de comportements humains
│   ├── popup_solver.js    # Gestion des popups spécifiques
│   ├── logger.js          # Logging centralisé (Winston)
│   ├── error_utils.js     # Gestion centralisée des erreurs
│   ├── validation_utils.js# Fonctions de validation stricte
│   ├── async_utils.js     # Outils de concurrence (Mutex, Semaphore)
│   └── selectors.js       # Centralisation des sélecteurs DOM
│
├── config/
│   └── accounts_config.json # Comptes Voltaire à utiliser (voir section dédiée)
│
├── tests/                 # Tests unitaires des modules principaux
├── .env.example           # Exemple de configuration environnementale
├── package.json           # Dépendances et scripts NPM
└── README.md              # Documentation technique (ce fichier)
```

---

## Modules principaux

- **main.js** : Point d'entrée, orchestre le lancement du bot.
- **config_loader.js** : Charge et valide la configuration depuis `.env` et `accounts_config.json`.
- **browser_manager.js** : Gère les sessions Playwright, profils utilisateurs, concurrence.
- **auth_handler.js** : Effectue l'authentification sur Projet Voltaire.
- **exercise_parser.js** : Extrait et analyse les exercices à résoudre.
- **solver_engine.js** : Coordonne la résolution (API OpenAI, logique métier).
- **openai_client.js** : Gère les requêtes à l'API OpenAI.
- **human_simulator.js** : Simule des actions humaines (délais, frappes, mouvements).
- **popup_solver.js** : Détecte et gère les popups spécifiques à la plateforme.
- **logger.js** : Logging centralisé, anonymisation des emails, niveau configurable.

---

## Utilitaires

### error_utils.js
- Définit des classes d’erreur personnalisées (`ValidationError`, `AuthError`, `AppError`).
- Fournit la fonction `handleError` pour logger ou propager proprement les erreurs.
- Exemple d’utilisation :
  ```js
  import { ValidationError, handleError } from './error_utils.js';
  try {
    // ... code ...
  } catch (err) {
    handleError(err, logger);
  }
  ```

### validation_utils.js
- Fonctions de validation stricte : email, variables d’environnement, chaînes non vides.
- Lance des `ValidationError` en cas d’invalidité.
- Exemple :
  ```js
  import { validateEmail, validateEnvVar } from './validation_utils.js';
  validateEmail('test@example.com');
  validateEnvVar('OPENAI_API_KEY', process.env.OPENAI_API_KEY);
  ```

### async_utils.js
- Fournit un `Mutex` (verrou exclusif) et un `Semaphore` (limitation du parallélisme) asynchrones.
- Permet de protéger des sections critiques ou de limiter le nombre de sessions navigateur.
- Exemple :
  ```js
  import { Mutex, Semaphore } from './async_utils.js';
  const mutex = new Mutex();
  await mutex.runExclusive(async () => {
    // section critique
  });
  ```

### selectors.js
- Centralise tous les sélecteurs CSS/DOM utilisés dans l’application.
- Toute modification de sélecteur doit passer par ce module pour garantir la cohérence.
- Exemple :
  ```js
  import selectors from './selectors.js';
  await page.click(selectors.understoodButton);
  ```

---

## Gestion des comptes Voltaire

Les identifiants ne sont plus stockés dans `.env` mais dans `config/accounts_config.json` :
```json
[
  {
    "id": "account1",
    "email": "utilisateur1@example.com",
    "password": "motdepasse1",
    "sessionDuration": "2h"
  },
  {
    "id": "account2",
    "email": "utilisateur2@example.com",
    "password": "motdepasse2"
  }
]
```
- `sessionDuration` (optionnel) : durée de session en heures.
- Ce fichier doit être créé manuellement et n’est pas versionné (ajoutez-le à `.gitignore`).

---

## Configuration

Toutes les variables de configuration sont centralisées dans `.env` (voir `.env.example` pour la liste exhaustive et des explications détaillées).
- Clé API OpenAI obligatoire.
- Délais de simulation humaine personnalisables.
- Niveau de log configurable (`LOG_LEVEL`).
- Pour des besoins avancés, adaptez les variables optionnelles (voir `.env.example`).

---

## Installation et lancement 🚀

1. **Cloner le dépôt :**
   ```bash
   git clone https://github.com/ElProfessorFRidg/projet-voltaire-bot
   cd projet-voltaire-bot
   ```
2. **Installer les dépendances :**
   ```bash
   npm install
   ```
3. **Installer les navigateurs Playwright :**
   ```bash
   npx playwright install
   ```
4. **Configurer l’environnement :**
   - Copier `.env.example` en `.env` et adapter les valeurs.
   - Créer `config/accounts_config.json` avec vos comptes Voltaire.

5. **Lancer le bot :**
   ```bash
   node main.js
   ```

---

## Exemples d’utilisation

### Lancement standard
```bash
node main.js
```

### Lancer avec un niveau de log détaillé
```bash
LOG_LEVEL=debug node main.js
```

### Exemple d’appel API OpenAI (dans le code)
```js
import { askOpenAI } from './openai_client.js';
const reponse = await askOpenAI('Corrige cette phrase : ...');
```

### Lancer les tests unitaires
```bash
npm test
```
ou
```bash
npx jest
```
(selon la configuration du projet)

---

## Tests

- Les tests unitaires sont dans le dossier `tests/`.
- Pour lancer tous les tests :
  ```bash
  npm test
  ```
- Pour tester un module spécifique :
  ```bash
  npx jest tests/async_utils.test.js
  ```

---

## Déploiement

- Ce projet est conçu pour un usage local (expérimentation, développement).
- Pour un déploiement sur serveur, veillez à sécuriser les fichiers de configuration et à utiliser des comptes dédiés.
- Les logs sont générés dans `app.log` (niveau configurable).

---

## Dépendances principales 📦

- [Playwright](https://playwright.dev/) : Automatisation du navigateur.
- [OpenAI Node.js Library](https://github.com/openai/openai-node) : Intégration API OpenAI.
- [dotenv](https://github.com/motdotla/dotenv) : Chargement des variables d’environnement.
- [Winston](https://github.com/winstonjs/winston) : Logging flexible.

---

## Schéma d’architecture (textuel)

```
+-------------------+        +-------------------+        +-------------------+
|  main.js          | -----> |  config_loader.js | -----> |  logger.js        |
|                   |        |                   |        |                   |
|  Orchestration    |        | Chargement config |        | Logging central   |
+-------------------+        +-------------------+        +-------------------+
        |                            |                              |
        v                            v                              v
+-------------------+        +-------------------+        +-------------------+
| browser_manager   | -----> | auth_handler      | -----> | exercise_parser   |
| (Playwright)      |        | (login)           |        | (analyse exos)    |
+-------------------+        +-------------------+        +-------------------+
        |                            |                              |
        v                            v                              v
+-------------------+        +-------------------+        +-------------------+
| solver_engine     | <----> | openai_client     |        | human_simulator   |
| (logique, OpenAI) |        | (API OpenAI)      |        | (actions humaines)|
+-------------------+        +-------------------+        +-------------------+
        |
        v
+-------------------+
| popup_solver      |
| (popups Voltaire) |
+-------------------+
```

---

## TODO 🚧

Voir la section dédiée dans le code pour les axes d’amélioration et d’extension.

---

## Avertissement ⚠️

L'utilisation de ce script est à vos propres risques. L'automatisation de plateformes peut entraîner des suspensions de compte si elle est détectée et jugée contraire aux conditions d'utilisation. Soyez conscient des implications éthiques et légales. Ce projet est fourni "tel quel", sans garantie d'aucune sorte.

---

## Licence 📄

Ce projet est sous licence ISC. Voir le fichier `LICENSE` ou les informations du `package.json` pour plus de détails.