// Module centralisant les sélecteurs DOM/CSS utilisés dans l’application Voltaire JS
// Toute modification de sélecteur doit être faite ici pour garantir la cohérence et la maintenabilité.

const selectors = {
  // Popups et boutons principaux
  popup: '.popupContent .intensiveTraining',
  understoodButton: 'button.understoodButton',
  exitButton: '.exitButton',
  retryButton: '.retryButton',
  tick: '.tick',

  // Questions et phrases
  questionContainer: '.intensiveQuestion',
  sentence: '.sentence',
  wordToClick: '.word-clickable',
  pointAndClickSpan: 'div.sentence span.pointAndClickSpan',

  // Boutons d’action
  correctButton: '.buttonOk',
  incorrectButton: '.buttonKo',
  nextButton: '#btn_question_suivante.nextButton',
  noMistakeButton: 'button#btn_question_suivante.noMistakeButton',
  finishButton: 'button:has-text("Terminer")',

  // QCM et options
  exerciseTypeIndicator: '.exercise-type-indicator',
  choiceOptions: '.choice-option input[type="radio"]',
  choiceLabels: '.choice-option label',
  ruleIdentifier: '.rule-id',

  // Sélecteurs pour l'état des exercices dans une liste/grille
  activityInProgress: '.activity-selector-cell.inProgress', // Pour les exercices standards en cours
  validationActivityInProgress: '.validation-activity-cell.inProgress' // Pour les exercices de validation en cours
};

export default selectors;