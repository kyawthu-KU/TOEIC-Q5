// Source: E:/KyawThu/Website/TOEIC-Q5/js/quiz.ts.
// The build generates E:/KyawThu/Website/TOEIC-Q5/js/quiz.js. Edit the TypeScript source.

type Difficulty = 'basic' | 'intermediate' | 'advanced';
type AnswerStatus = 'correct' | 'wrong' | 'unanswered';
type LearningField = 'vocabulary' | 'grammar' | 'usage' | 'example';
type LearningNotes = Record<LearningField, string>;
type Question = {
  question: string;
  choices: [string, string, string, string];
  answer: string;
  difficulty: Difficulty;
  category?: unknown;
  explanation?: unknown;
} & ({ review: 'eligible' } | { review: 'excluded'; exclusionReason: string });
type AnswerResult = { key: string; status: AnswerStatus };
type Shuffle = <T>(array: T[]) => T[];

function required<T>(value: T | null | undefined): NonNullable<T> {
  if (value === null || value === undefined) {
    throw new Error('A required quiz value could not be found.');
  }
  return value;
}

function pageElement<T extends HTMLElement = HTMLElement>(selector: string, root: Document | Element = document): T {
  return required(root.querySelector<T>(selector));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isChoiceList(value: unknown): value is Question['choices'] {
  if (!Array.isArray(value) || value.length !== 4) return false;
  const choices: unknown[] = value;
  return choices.every((choice): choice is string => typeof choice === 'string' && choice.trim().length > 0) &&
    new Set(choices.map(choice => choice.trim().toLowerCase())).size === 4;
}

function isQuestion(value: unknown): value is Question {
  return isRecord(value) && typeof value.question === 'string' &&
    (value.question.match(/_+/g) || []).length === 1 && isChoiceList(value.choices) &&
    typeof value.answer === 'string' && value.choices.includes(value.answer) &&
    (value.difficulty === 'basic' || value.difficulty === 'intermediate' || value.difficulty === 'advanced') &&
    (value.review === 'eligible' || (value.review === 'excluded' &&
      typeof value.exclusionReason === 'string' && value.exclusionReason.trim().length > 0));
}

function readQuestionBank(value: unknown): Question[] {
  if (!Array.isArray(value)) {
    throw new Error('The question bank could not be read. Please contact your instructor.');
  }
  const questions: unknown[] = value;
  if (!questions.every(isQuestion)) {
    throw new Error('The question bank needs review before this quiz can start. Please contact your instructor.');
  }
  return questions;
}

function hasLearningNotes(value: unknown): value is LearningNotes {
  return isRecord(value) && ['vocabulary', 'grammar', 'usage', 'example']
    .every(field => typeof value[field] === 'string' && value[field].trim().length > 0);
}

const QUESTION_MIX = Object.freeze([
  { difficulty: 'advanced', count: 20 },
  { difficulty: 'intermediate', count: 10 }
] as const);

function normalizeQuestion(text: string): string {
  return text.normalize('NFKC').trim().replace(/_+/g, '_____').replace(/\s+/g, ' ').toLowerCase();
}

function selectQuestions(value: unknown, shuffle: Shuffle): Question[] {
  const bank = readQuestionBank(value);

  const eligible = bank.filter(question => question.review === 'eligible');
  if (new Set(eligible.map(question => normalizeQuestion(question.question))).size !== eligible.length) {
    throw new Error('The question bank contains repeated questions. Please contact your instructor.');
  }

  const selected = QUESTION_MIX.flatMap(({ difficulty, count }) => {
    const pool = eligible.filter(question => question.difficulty === difficulty);
    if (pool.length < count) {
      throw new Error(`This quiz needs ${count} ${difficulty} questions, but only ${pool.length} are available. Please contact your instructor.`);
    }
    return shuffle([...pool]).slice(0, count);
  });

  return shuffle(selected);
}

function formatCompletionTime(date: Date): { dateTime: string; label: string; timeZone: string } {
  const options: Intl.DateTimeFormatOptions = {
    year: 'numeric', month: 'long', day: 'numeric',
    hour: 'numeric', minute: '2-digit', second: '2-digit'
  };
  const zone = required(new Intl.DateTimeFormat('en-US', { timeZoneName: 'long' })
    .formatToParts(date).find(part => part.type === 'timeZoneName')).value;
  const offset = -date.getTimezoneOffset();
  const hours = String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0');
  const minutes = String(Math.abs(offset) % 60).padStart(2, '0');
  return {
    dateTime: date.toISOString(),
    label: new Intl.DateTimeFormat('en-US', options).format(date),
    timeZone: `${zone} (UTC${offset < 0 ? '-' : '+'}${hours}:${minutes})`
  };
}

class TOEICQuiz {
  questions: Question[];
  answers: Map<string, string>;
  correctAnswers: Map<string, string>;
  score: number;
  numQuestions: number;
  submitClicked: boolean;
  timeLimit: number;
  timerInterval: ReturnType<typeof setInterval> | null;
  quizSubmitted: boolean;
  quizStarted: boolean;
  completedAt: Date | null;
  answerCorrectness: AnswerResult[];
  timerFloat: HTMLElement;
  startButton: HTMLButtonElement | null;

  constructor() {
    this.questions = [];
    this.answers = new Map();
    this.correctAnswers = new Map();
    this.score = 0;
    this.numQuestions = QUESTION_MIX.reduce((total, group) => total + group.count, 0);

    this.submitClicked = false; // Flag to track if submit button is clicked
    this.timeLimit = 1800; // Default time limit for the quiz (30 minutes in seconds)
    this.timerInterval = null; // Interval for the timer
    this.quizSubmitted = false; // Flag to track whether the quiz has been automatically submitted
    this.quizStarted = false; // Flag to track if the quiz has started
    this.completedAt = null;

    // this.wrongAnswerIndices = []; // Array to store indices of wrong answers
    this.answerCorrectness = [];

    // Get references to the elements
    this.timerFloat = pageElement('.timer-float');
    this.startButton = document.querySelector<HTMLButtonElement>('.start-button');

    // Bind event listeners
    this.startQuiz = this.startQuiz.bind(this);
  }

  // Method to shuffle an array
  shuffleArray<T>(array: T[]): T[] {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [required(array[j]), required(array[i])];
    }
    return array;
  }

  // Method to handle selection of answer choices
  selectAnswer(event: { target: HTMLButtonElement }): void {
    if (this.submitClicked || this.quizSubmitted) {
      return; // Prevent selection after submit button is clicked
    }

    const button = event.target;
    // console.log("selectedButton ", selectedButton);
    const questionIndex = this.getQuestionIndex(button);

    // Deselect any previously selected answer choice
    const choicesList = required(button.parentElement);
    choicesList.querySelectorAll('button').forEach(button => {
      button.classList.remove('selected');
      button.setAttribute('aria-pressed', 'false');
      button.style.backgroundColor = ''; // Reset background color
    });

    // Toggle 'selected' class for clicked answer choice
    button.classList.add('selected');
    button.setAttribute('aria-pressed', 'true');

    // Highlight the clicked answer choice
    button.style.backgroundColor = 'lightblue';

    // Store the user's selection for later scoring
    const selectedChoice = required(button.dataset.choice);

    // console.log("questionIndex in selectAnswer = ", questionIndex, selectedChoice);
    const answerKey = `${questionIndex}`;
    this.answers.set(answerKey, selectedChoice);
    // console.log("this.answers in selectAnswer : ", this.answers);
  }

  // Method to get the question index from a button element
  getQuestionIndex(button: HTMLButtonElement): number {
    return parseInt(required(button.dataset.questionIndex));
  }

  // Method to add event listeners to answer choice buttons
  addChoiceListeners() {
    document.querySelectorAll<HTMLButtonElement>('.choices button').forEach(button => {
      button.addEventListener('click', () => this.selectAnswer({ target: button }));
    });
  }

  async displayQuiz() {
    try {
      await this.loadQuestions();
      this.displayTimeDropdown();
      this.displayStartButton();

      // Add margin between "Choose time" label and dropdown
      const dropdownLabel = pageElement('label[for="timeDropdown"]');
      dropdownLabel.style.marginBottom = '20px'; // Adjust as needed

      // Add margin between dropdown and "Start Quiz" button
      const dropdown = pageElement<HTMLSelectElement>('#timeDropdown');
      dropdown.style.marginBottom = '20px'; // Adjust as needed

    } catch (error) {
      console.error('Error loading quiz:', error);
      const message = document.createElement('p');
      message.setAttribute('role', 'alert');
      message.textContent = error instanceof Error ? error.message : String(error);
      message.style.color = 'red';
      this.timerFloat.replaceChildren(message);
    }
  }

  async loadQuestions(this: Pick<TOEICQuiz, 'questions' | 'correctAnswers' | 'shuffleArray' | 'loadCorrectAnswers'>) {
    const response = await fetch('./questions/questionsPart5Sample.json');
    if (!response.ok) {
      throw new Error('Questions could not be loaded. Please reload the page or contact your instructor.');
    }
    let bank: unknown;
    try {
      bank = await response.json();
    } catch {
      throw new Error('The question bank could not be read. Please contact your instructor.');
    }
    this.questions = selectQuestions(bank, questions => this.shuffleArray(questions));
    this.loadCorrectAnswers();
  }


  // Method to display questions
  displayQuestions() {
    const quizElement = pageElement('#quiz'); // Get quiz element

    const heading = document.createElement('h2');
    heading.classList.add('panel-heading');
    heading.textContent = 'Your questions';
    quizElement.replaceChildren(heading);

    // Loop through the displayed questions
    this.questions.forEach((question, index) => {
      const questionDiv = document.createElement('article');
      questionDiv.classList.add('question', 'question-card');
      questionDiv.dataset.questionIndex = String(index);

      // Display question number and text
      const cardHeading = document.createElement('div');
      cardHeading.classList.add('card-heading');
      const title = document.createElement('h3');
      title.textContent = `Question ${index + 1}`;
      cardHeading.appendChild(title);
      const questionText = document.createElement('p');
      questionText.classList.add('question-text');
      questionText.textContent = question.question;
      questionDiv.appendChild(cardHeading);
      questionDiv.appendChild(questionText);

      // Display answer choices as buttons
      const choicesList = document.createElement('div');
      choicesList.classList.add('choices');

      this.displayChoices(choicesList, question.choices, index);
      questionDiv.appendChild(choicesList);
      quizElement.appendChild(questionDiv);

    });
    // Add event listeners to answer choice buttons
    this.addChoiceListeners();
  }

  // Method to display choices for a question
  displayChoices(choicesList: HTMLElement, choices: readonly string[], questionIndex: number): void {
    const shuffledChoices = this.shuffleArray([...choices]);
    shuffledChoices.forEach((choice, choiceIndex) => {
      const choiceButton = document.createElement('button');
      choiceButton.type = 'button';
      choiceButton.textContent = `(${String.fromCharCode(65 + choiceIndex)}) ${choice}`;
      choiceButton.dataset.choice = choice;
      choiceButton.setAttribute('aria-pressed', 'false');

      // Add event listener to handle selection
      // choiceButton.addEventListener('click', this.selectAnswer.bind(this)); // Bind 'this' context to the class instance
      // choiceButton.addEventListener('click', (event) => this.selectAnswer(event, questionIndex)); // Pass questionIndex to selectAnswer

      // Store the questionIndex as a data attribute of the button
      choiceButton.dataset.questionIndex = String(questionIndex);

      // Add margin or padding to create spacing between choice buttons
      choiceButton.style.marginBottom = '5px'; // Adjust the value as needed
      choiceButton.style.cursor = 'pointer'; // Change cursor to pointer
      choicesList.appendChild(choiceButton);
      choicesList.appendChild(document.createElement('br')); // Add line break
    });
  }

  // Method to display Submit button
  displaySubmitButton() {
    const submitButton = document.createElement('button');
    submitButton.textContent = 'Submit';
    // submitButton.id = 'submit';
    submitButton.classList.add('submit-button'); // Apply the CSS class to the Submit button

    submitButton.style.backgroundColor = 'red'; // Set background color
    submitButton.style.padding = '10px 20px'; // Set padding
    submitButton.style.fontSize = '20px'; // Set font size
    submitButton.style.border = 'none'; // Remove border
    submitButton.style.color = 'white'; // Set text color to white

    submitButton.addEventListener('click', () => {
      if (this.quizSubmitted || this.submitClicked) {
        return;
      }
      if (confirm('Are you sure you want to submit your answers?')) {
        // console.log('Submit button clicked');
        this.submitQuiz();

        // Move to the top of the page
        window.scrollTo({
          top: 0,
          behavior: 'smooth' // Smooth scrolling
        });

      }
    });
    // Add pointer cursor on hover
    submitButton.style.cursor = 'pointer';
    // const hrElement = document.createElement('hr'); // Create horizontal line element
    // pageElement('#quiz').appendChild(hrElement); // Append horizontal line before the Submit button
    // pageElement('#quiz').appendChild(submitButton); // Append Submit button

    // Append the submit button inside the .submit-button div
    const submitButtonContainer = pageElement('#submit');
    submitButtonContainer.appendChild(submitButton);

  }


  // Method to calculate score
  calculateScore(this: Pick<TOEICQuiz, 'score' | 'answers' | 'correctAnswers' | 'answerCorrectness' | 'displayScore' | 'displayCorrectAnswers'>) {
    this.score = 0;
    this.answerCorrectness = []; // Reset wrong answer indices

    // this.answers.forEach((userAnswer, questionIndex) => {

    //   // Retrieve correct answer for this question
    //   const correctAnswer = this.correctAnswers.get(questionIndex);

    //   // console.log("userAnser in calculateScore = ", userAnswer);
    //   // console.log("questionIndex in calculateScore = ", questionIndex);

    //   // Check if user's answer matches the correct answer
    //   if (userAnswer === correctAnswer) {
    //     // console.log("User's answer is correct for question", questionIndex);
    //     this.score++;
    //     this.answerCorrectness[questionIndex] = true; // Mark the answer as correct
    //   } else {
    //     // console.log("User's answer is incorrect for question", questionIndex);
    //     // this.wrongAnswerIndices.push(questionIndex); // Record index of wrong answer
    //     this.answerCorrectness[questionIndex] = false; // Mark the answer as incorrect
    //   }
    // });

    // Loop through correct answers to ensure all are checked
    this.correctAnswers.forEach((correctAnswer, answerKey) => {
      const userAnswer = this.answers.get(answerKey);
      // console.log("userAnswer === correctAnswer : ", userAnswer, correctAnswer)
      // Check if user's answer matches the correct answer
      const isCorrect = userAnswer === correctAnswer;

      // Check if the user's answer is correct, wrong, or unanswered
      let answerStatus: AnswerStatus;
      if (isCorrect) {
        answerStatus = 'correct';
      } else if (userAnswer !== undefined) {
        answerStatus = 'wrong';
      } else {
        answerStatus = 'unanswered';
      }

      this.answerCorrectness.push({ key: answerKey, status: answerStatus })

      // console.log("this.answerCorrectness :", this.answerCorrectness);
      if (isCorrect) {
        this.score++;
      }
    });

    this.displayScore();
    this.displayCorrectAnswers();
  }

  // Method to display score
  displayScore() {
    const completion = document.querySelector('.completion') || document.createElement('section');
    completion.classList.add('completion');
    completion.setAttribute('aria-label', 'Exercise results');
    const scoreContainer = document.createElement('div');
    const label = document.createElement('p');
    label.classList.add('score-label');
    label.textContent = 'Your score';
    const score = document.createElement('h2');
    score.classList.add('score');
    score.textContent = `${this.score} `;
    const total = document.createElement('span');
    total.textContent = `out of ${this.numQuestions}`;
    score.appendChild(total);
    scoreContainer.appendChild(label);
    scoreContainer.appendChild(score);
    completion.replaceChildren(scoreContainer);

    if (this.completedAt) {
      const completed = formatCompletionTime(this.completedAt);
      const timeContainer = document.createElement('div');
      timeContainer.classList.add('completion-time');
      const timeLabel = document.createElement('p');
      timeLabel.textContent = 'Completed';
      const time = document.createElement('time');
      time.setAttribute('datetime', completed.dateTime);
      time.textContent = completed.label;
      const zone = document.createElement('span');
      zone.classList.add('time-zone');
      zone.textContent = completed.timeZone;
      timeContainer.appendChild(timeLabel);
      timeContainer.appendChild(time);
      timeContainer.appendChild(zone);
      completion.appendChild(timeContainer);
    }

    pageElement('.container').insertBefore(completion, pageElement('#quiz'));
  }

  // Method to load correct answers
  loadCorrectAnswers(this: Pick<TOEICQuiz, 'questions' | 'correctAnswers'>) {
    this.correctAnswers.clear();
    this.questions.forEach((question, index) => {
      const questionKey = `${index}`;
      this.correctAnswers.set(questionKey, question.answer);
      // console.log("this.correctAnswers : ", this.correctAnswers);
    });

  }

  // Method to display correct answers
  displayCorrectAnswers() {
    document.querySelectorAll('.answer-card').forEach(card => card.remove());
    const correctAnswersContainer = document.createElement('div');
    correctAnswersContainer.classList.add('correct-answers');
    const statusLabels = { correct: 'Correct', wrong: 'Incorrect', unanswered: 'Unanswered' };

    this.answerCorrectness.forEach(({ key, status }) => {
      const correctAnswer = required(this.correctAnswers.get(key));
      const questionIndex = Number(key);
      const question = required(this.questions[questionIndex]);
      const card = document.createElement('article');
      card.classList.add('answer-card', status);
      card.dataset.questionIndex = key;
      const titleId = `answer-${questionIndex + 1}`;
      card.setAttribute('aria-labelledby', titleId);
      const heading = document.createElement('div');
      heading.classList.add('card-heading');
      const title = document.createElement('h3');
      title.id = titleId;
      title.textContent = `Question ${questionIndex + 1}`;
      const badge = document.createElement('span');
      badge.classList.add('status', `status-${status}`);
      badge.textContent = statusLabels[status];
      heading.appendChild(title);
      heading.appendChild(badge);
      card.appendChild(heading);

      const answerLines = document.createElement('dl');
      answerLines.classList.add('answer-lines');
      const answerRows: [string, string, string][] = [
        ['Your answer', this.answers.get(key) ?? 'No answer selected', status === 'wrong' ? 'wrong-answer' : ''],
        ['Correct answer', correctAnswer, 'correct-answer']
      ];
      answerRows.forEach(([label, value, className]) => {
        const row = document.createElement('div');
        const term = document.createElement('dt');
        term.textContent = label;
        const description = document.createElement('dd');
        description.textContent = value;
        if (className) description.classList.add(className);
        row.appendChild(term);
        row.appendChild(description);
        answerLines.appendChild(row);
      });
      card.appendChild(answerLines);

      const fields: LearningField[] = ['vocabulary', 'grammar', 'usage', 'example'];
      const explanation = question.explanation;
      if (hasLearningNotes(explanation)) {
        const details = document.createElement('details');
        details.open = questionIndex === 0;
        const summary = document.createElement('summary');
        summary.textContent = 'Learning notes';
        const summaryContext = document.createElement('span');
        summaryContext.classList.add('sr-only');
        summaryContext.textContent = ` for Question ${questionIndex + 1}`;
        summary.appendChild(summaryContext);
        details.appendChild(summary);
        const notes = document.createElement('dl');
        notes.classList.add('learning-notes');
        fields.forEach(field => {
          const row = document.createElement('div');
          if (field === 'example') row.classList.add('example');
          const term = document.createElement('dt');
          term.textContent = field.charAt(0).toUpperCase() + field.slice(1);
          const description = document.createElement('dd');
          description.textContent = explanation[field];
          row.appendChild(term);
          row.appendChild(description);
          notes.appendChild(row);
        });
        details.appendChild(notes);
        card.appendChild(details);
      } else {
        const message = document.createElement('p');
        message.textContent = 'Learning notes are not available for this question.';
        card.appendChild(message);
      }
      correctAnswersContainer.appendChild(card);
    });

    const answersColumn = pageElement('.answers-column');
    const heading = document.createElement('h2');
    heading.classList.add('panel-heading');
    heading.textContent = 'Answers and learning notes';
    const instruction = document.createElement('p');
    instruction.classList.add('panel-intro');
    instruction.textContent = 'Open Learning notes for vocabulary, grammar, usage and an example.';
    answersColumn.replaceChildren(heading, instruction, correctAnswersContainer);
    this.positionSolutions();
  }

  positionSolutions() {
    if (!this.quizSubmitted) return;

    const questionCards = document.querySelectorAll<HTMLElement>('.question');
    document.querySelectorAll<HTMLElement>('.answer-card').forEach(card => {
      const target = questionCards[Number(card.dataset.questionIndex)];
      if (target && card.parentNode !== target) target.appendChild(card);
    });
    pageElement('.answers-column').style.display = 'none';
  }

  displayTimeDropdown() {
    // Create the dropdown container element
    const dropdownContainer = document.createElement('div');
    // dropdownContainer.classList.add('timer-float'); // Add timer-float class

    // Create the label element
    const label = document.createElement('label');
    label.setAttribute('for', 'timeDropdown');
    label.textContent = 'Choose time: ';
    label.style.color = 'blue'; // Set text color to red
    label.style.fontSize = '30px'
    dropdownContainer.appendChild(label);

    // Create the select element
    const select = document.createElement('select');
    select.setAttribute('id', 'timeDropdown');
    select.style.width = '200px'; // Set width of the select box
    select.style.height = '50px'; // Set height of the select box
    select.style.padding = '5px'; // Add padding to the select box
    select.style.border = '2px solid blue'; // Add border to the select box
    select.style.fontSize = '30px'; // Set font size of the text inside the select box
    select.style.color = 'blue'; // Set color of the text inside the select box

    // Define the options
    const options = [
      { value: '300', text: '5 minutes' },
      { value: '600', text: '10 minutes' },
      { value: '720', text: '12 minutes' },
      { value: '900', text: '15 minutes' },
      { value: '1200', text: '20 minutes' },
      { value: '1800', text: '30 minutes' },
      { value: '2400', text: '40 minutes' },
      { value: '3000', text: '50 minutes' }
    ];

    // Create and append option elements
    options.forEach(option => {
      const optionElement = document.createElement('option');
      optionElement.setAttribute('value', option.value);
      optionElement.textContent = option.text;
      optionElement.style.color = 'blue'; // Set text color of options to blue
      optionElement.style.fontSize = '20px'; // Set font size of options to 20px
      select.appendChild(optionElement);
    });

    // Append the label and select elements to the dropdown container
    dropdownContainer.appendChild(label);
    dropdownContainer.appendChild(select);

    // Append the dropdown container to the quiz element
    pageElement('.timer-float').appendChild(dropdownContainer);

  }


  displayStartButton() {
    const startButton = document.createElement('button');
    this.startButton = startButton;
    startButton.textContent = 'Start Quiz';
    startButton.style.fontSize = '30px'
    startButton.style.width = '200px'; // Set width to 200 pixels
    startButton.style.height = '50px'; // Set height to 50 pixels
    startButton.style.backgroundColor = 'green'; // Change background color to green
    startButton.style.color = 'white'; // Change text color to white
    startButton.style.cursor = 'pointer'; // Set cursor to pointer
    startButton.addEventListener('click', () => {
      const selectedTime = pageElement<HTMLSelectElement>('#timeDropdown').value;
      this.timeLimit = parseInt(selectedTime);
      this.startQuiz();
    });

    // Append the start button to the new-box container
    const newBox = pageElement('.timer-float');
    newBox.appendChild(startButton);
    // pageElement('#quiz').appendChild(startButton);
  }

  startQuiz() {
    if (this.quizStarted) {
      return;
    }
    // Hide time dropdown and start button
    pageElement<HTMLSelectElement>('#timeDropdown').style.display = 'none';
    required(this.startButton).style.display = 'none';

    // Hide the dropdown container
    const dropdownContainer = pageElement('.timer-float');
    pageElement('select', dropdownContainer).style.display = 'none';
    pageElement('label', dropdownContainer).style.display = 'none';

    // Display remaining time
    this.displayTimer();

    // Display the questions and submit button.
    pageElement('.quiz-column').style.display = 'block';
    pageElement('.submit-button-container').style.display = 'block';

    // Enable submit button
    this.displaySubmitButton();

    // Set the flag to indicate that the quiz has started
    this.quizStarted = true;

    // Display the questions selected before the start button was shown.
    this.displayQuestions();

  }

  displayTimer() {
    const timerElement = document.createElement('div');
    timerElement.textContent = `Time left: ${this.formatTime(this.timeLimit)}`;
    timerElement.style.color = "blue";
    timerElement.style.fontSize = '30px'; // Set font size to 20 pixels
    // pageElement('#quiz').appendChild(timerElement);

    // Append the timer element to the timer-float container
    const newBox = pageElement('.timer-float');
    newBox.appendChild(timerElement);

    // Start the timer
    this.timerInterval = setInterval(() => {
      this.timeLimit--;
      timerElement.textContent = `Time left: ${this.formatTime(this.timeLimit)}`;

      if (this.timeLimit <= 0) {
        if (this.timerInterval !== null) clearInterval(this.timerInterval);
        this.submitQuiz();
        // console.log("submitQuiz was called.");
      }
    }, 1000); // Update the timer every second
  }

  formatTime(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds < 10 ? '0' : ''}${remainingSeconds}`;
  }

  // Method to submit the quiz automatically when time is up
  submitQuiz() {
    if (this.quizSubmitted || this.submitClicked) {
      return;
    }

    this.completedAt = new Date();
    this.quizSubmitted = true;
    this.submitClicked = true;
    if (this.timerInterval !== null) clearInterval(this.timerInterval);

    document.querySelectorAll<HTMLButtonElement>('.choices button').forEach(button => {
      button.disabled = true;
      button.style.backgroundColor = '';
      button.style.cursor = 'default';
      const key = String(this.getQuestionIndex(button));
      const isCorrect = button.dataset.choice === this.correctAnswers.get(key);
      const isSelected = button.dataset.choice === this.answers.get(key);
      if (isCorrect) button.classList.add('choice-correct');
      if (isSelected && !isCorrect) button.classList.add('choice-wrong');
      if (isCorrect || isSelected) {
        const label = document.createElement('small');
        label.textContent = isSelected ? 'Your answer' : 'Correct answer';
        button.appendChild(label);
      }
    });
    pageElement<HTMLButtonElement>('.submit-button').disabled = true;
    this.calculateScore();

    const statusLabels = { correct: 'Correct', wrong: 'Incorrect', unanswered: 'Unanswered' };
    document.querySelectorAll<HTMLElement>('.question').forEach(card => {
      const status = required(this.answerCorrectness[Number(card.dataset.questionIndex)]).status;
      const badge = document.createElement('span');
      badge.classList.add('status', `status-${status}`);
      badge.textContent = statusLabels[status];
      pageElement('.card-heading', card).appendChild(badge);
    });
    pageElement('.timer-float').style.display = 'none';
  }
}

// Run with --verify to check the real selection, loading and scoring functions.
async function verifyQuiz() {
  const { readFile } = await import('node:fs/promises');
  const { createHash } = await import('node:crypto');
  const { pathToFileURL } = await import('node:url');
  const assert: typeof import('node:assert/strict') = (await import('node:assert/strict')).default;
  const rawBank: unknown = JSON.parse(await readFile(new URL('../questions/questionsPart5Sample.json', pathToFileURL(__filename)), 'utf8'));
  const bank = readQuestionBank(rawBank);
  const revisedPositions = new Set([
    2, 3, 19, 38, 88, 125, 167, 172, 196, 313, 351, 367, 394, 427, 446,
    509, 519, 532, 558, 609, 630, 643, 679, 698, 709, 721, 729,
    754, 771, 773, 794, 834, 840, 844, 895, 902, 1037, 1093
  ]);
  const unchangedBankDigest = createHash('sha256')
    .update(JSON.stringify(bank.filter((question, index) => !revisedPositions.has(index + 1))))
    .digest('hex');
  console.log(`Unchanged questions SHA256: ${unchangedBankDigest}`);
  if (process.argv.includes('--baseline')) {
    return;
  }

  if (process.argv.includes('--review-new')) {
    const ignored = new Set('a an and are as at be been being but by can could did do does for from had has have he her his if in into is it its may must not of on or our should so than that the their them there these they this those to until us was we were when where which while who will with would'.split(' '));
    const words = bank.map(question => new Set((normalizeQuestion(question.question).match(/[a-z]+/g) || [])
      .filter(word => !ignored.has(word))));
    let matches = 0;
    bank.slice(903).forEach((question, offset) => {
      const index = offset + 903;
      const closest = words.slice(0, index).map((other, otherIndex) => {
        const current = required(words[index]);
        const common = [...current].filter(word => other.has(word)).length;
        return { index: otherIndex, overlap: common / (current.size + other.size - common) };
      }).reduce((best, candidate) => candidate.overlap > best.overlap ? candidate : best, { index: 0, overlap: 0 });
      if (closest.overlap >= 0.4) {
        matches += 1;
        console.log(`Review ${index + 1} against ${closest.index + 1}:\n${question.question}\n${required(bank[closest.index]).question}`);
      }
    });
    console.log(`Word overlap scan for ${bank.length - 903} recent additions. Pairs to inspect: ${matches}.`);
    console.log('This scan does not assess meaning, answer correctness or repeated grammar patterns.');
    return;
  }

  assert.equal(revisedPositions.size, 38);
  assert.equal(unchangedBankDigest, 'b53f1b93f79d544d410271389e5947c4abce3cbb35e01ba953616fe58a8c2f10');
  assert.equal(bank.length, 1103);
  assert.equal(new Set(bank.map(question => normalizeQuestion(question.question))).size, bank.length);
  assert.equal(bank.filter(question => question.review === 'excluded').length, 0);
  const additions = bank.slice(753);
  const expectedCategories = { grammar: 111, logic: 80, vocabulary: 100, distinction: 59 };
  Object.entries(expectedCategories).forEach(([category, count]) => {
    assert.equal(additions.filter(question => question.category === category).length, count, category);
  });
  assert.ok(additions.every((question, index) => question.review === 'eligible' &&
    question.difficulty === (index + 754 === 1093 ? 'basic' : 'advanced')));
  const newQuestions = bank.slice(903);
  assert.equal(newQuestions.length, 200);
  Object.entries({ grammar: 61, vocabulary: 60, logic: 40, distinction: 39 }).forEach(([category, count]) => {
    assert.equal(newQuestions.filter(question => question.category === category).length, count, category);
  });
  const newVocabulary = newQuestions.filter(question => question.category === 'vocabulary' || question.category === 'distinction');
  assert.equal(newVocabulary.length, 99);
  assert.equal(new Set(newVocabulary.map(question => question.answer.toLowerCase())).size, newVocabulary.length);
  const activeQuestions = bank.filter(question => question.review === 'eligible' &&
    QUESTION_MIX.some(group => group.difficulty === question.difficulty));
  assert.equal(activeQuestions.length, 882);
  const questionsWithNotes = bank.filter((question, index) => activeQuestions.includes(question) || revisedPositions.has(index + 1));
  assert.ok(questionsWithNotes.every(question => hasLearningNotes(question.explanation)));

  const savedTimeZone = process.env.TZ;
  try {
    const timeCases = [
      ['UTC', '2026-10-28T05:32:08.000Z', 'UTC+00:00', 'October 28, 2026', '5:32:08'],
      ['Asia/Tokyo', '2026-10-28T05:32:08.000Z', 'UTC+09:00', 'October 28, 2026', '2:32:08'],
      ['Asia/Kathmandu', '2026-10-28T05:32:08.000Z', 'UTC+05:45', 'October 28, 2026', '11:17:08'],
      ['America/New_York', '2026-01-01T12:00:00.000Z', 'UTC-05:00', 'January 1, 2026', '7:00:00'],
      ['America/New_York', '2026-07-01T12:00:00.000Z', 'UTC-04:00', 'July 1, 2026', '8:00:00'],
      ['Pacific/Kiritimati', '2026-10-28T15:32:08.000Z', 'UTC+14:00', 'October 29, 2026', '5:32:08']
    ] as const;
    timeCases.forEach(([zone, instant, offset, day, clock]) => {
      process.env.TZ = zone;
      const date = new Date(instant);
      const formatted = formatCompletionTime(date);
      assert.equal(formatted.dateTime, instant);
      assert.ok(formatted.timeZone.endsWith('(' + offset + ')'), zone);
      assert.ok(formatted.label.includes(day), zone);
      assert.ok(formatted.label.includes(clock), zone);
      assert.equal(date.toISOString(), instant);
    });
  } finally {
    if (savedTimeZone === undefined) delete process.env.TZ;
    else process.env.TZ = savedTimeZone;
  }
  const snapshot = JSON.stringify(bank);
  const shuffle = TOEICQuiz.prototype.shuffleArray;
  const selections = Array.from({ length: 100 }, () => selectQuestions(bank, shuffle));
  selections.forEach(questions => {
    assert.equal(questions.length, 30);
    assert.equal(new Set(questions).size, 30);
    assert.equal(questions.filter(question => question.difficulty === 'advanced').length, 20);
    assert.equal(questions.filter(question => question.difficulty === 'intermediate').length, 10);
    assert.ok(questions.every(question => question.review === 'eligible'));
    const scoreState: Pick<TOEICQuiz, 'questions' | 'correctAnswers' | 'answers' | 'score' | 'answerCorrectness' | 'displayScore' | 'displayCorrectAnswers'> = {
      questions, correctAnswers: new Map<string, string>(), score: 0, answerCorrectness: [],
      answers: new Map(questions.map((question, index) => [String(index), question.answer])),
      displayScore() {}, displayCorrectAnswers() {}
    };
    TOEICQuiz.prototype.loadCorrectAnswers.call(scoreState);
    TOEICQuiz.prototype.calculateScore.call(scoreState);
    assert.equal(scoreState.score, 30);
    scoreState.answers = new Map(questions.slice(0, 20).map((question, index) => [String(index),
      index < 10 ? question.answer : required(question.choices.find(choice => choice !== question.answer))]));
    TOEICQuiz.prototype.calculateScore.call(scoreState);
    assert.equal(scoreState.score, 10);
    ['correct', 'wrong', 'unanswered'].forEach(status => {
      assert.equal(scoreState.answerCorrectness.filter(answer => answer.status === status).length, 10);
    });
    scoreState.answers = new Map();
    TOEICQuiz.prototype.calculateScore.call(scoreState);
    assert.equal(scoreState.score, 0);
    assert.ok(scoreState.answerCorrectness.every(answer => answer.status === 'unanswered'));
    questions.forEach(question => {
      const choices = shuffle([...question.choices]);
      assert.equal(choices.length, 4);
      assert.ok(choices.includes(question.answer));
    });
  });
  assert.ok(new Set(selections.map(questions => questions.map(question => question.question).join('|'))).size > 1);
  assert.equal(JSON.stringify(bank), snapshot);
  QUESTION_MIX.forEach(({ difficulty, count }) => {
    const other = bank.filter(question => question.difficulty !== difficulty);
    const pool = bank.filter(question => question.review === 'eligible' && question.difficulty === difficulty);
    assert.throws(() => selectQuestions([...other, ...pool.slice(0, count - 1)], shuffle), /only .* are available/);
    const exact = selectQuestions([...other, ...pool.slice(0, count)], shuffle);
    assert.equal(exact.filter(question => question.difficulty === difficulty).length, count);
  });
  const invalid = { ...bank[0], difficulty: undefined };
  assert.throws(() => selectQuestions([invalid, ...bank.slice(1)], shuffle), /needs review/);
  assert.throws(() => selectQuestions([...bank, { ...additions[0] }], shuffle), /repeated questions/);
  const excluded: Question = { ...required(additions[0]), review: 'excluded', exclusionReason: 'This entry is excluded for the selection check.' };
  const bankWithExclusion = [excluded, ...bank.filter(question => question !== additions[0])];
  assert.ok(!selectQuestions(bankWithExclusion, questions => questions).includes(excluded));

  const savedFetch = globalThis.fetch;
  let fetches = 0;
  const state: Pick<TOEICQuiz, 'questions' | 'correctAnswers' | 'shuffleArray' | 'loadCorrectAnswers'> = {
    questions: [], correctAnswers: new Map([['old', 'old']]), shuffleArray: shuffle,
    loadCorrectAnswers: TOEICQuiz.prototype.loadCorrectAnswers
  };
  try {
    globalThis.fetch = async () => {
      fetches += 1;
      return Object.assign(new Response(), { json: async () => bank });
    };
    await TOEICQuiz.prototype.loadQuestions.call(state);
    assert.equal(fetches, 1);
    assert.equal(state.correctAnswers.size, 30);
    assert.ok(!state.correctAnswers.has('old'));
    state.questions.forEach((question, index) => assert.equal(state.correctAnswers.get(String(index)), question.answer));

    const savedGlobals = ['document', 'window', 'confirm', 'setInterval', 'clearInterval']
      .map(name => ({ name, descriptor: Object.getOwnPropertyDescriptor(globalThis, name) }));
    const originalSelection = state.questions;
    type TestElement = {
      tag: string;
      id?: string;
      value: string;
      disabled: boolean;
      open: boolean;
      offsetWidth: number;
      style: Record<string, string | undefined>;
      dataset: Record<string, string | undefined>;
      textContent: string;
      children: TestElement[];
      parentNode: TestElement | null;
      readonly parentElement: TestElement | null;
      classList: { add(...names: string[]): void; remove(...names: string[]): void; contains(name: string): boolean };
      setAttribute(name: string, value: string): void;
      getAttribute(name: string): string | null;
      addEventListener(type: string, listener: (event: { target: TestElement }) => void): void;
      click(): void;
      appendChild(child: TestElement): TestElement;
      replaceChildren(...children: TestElement[]): void;
      remove(): void;
      insertBefore(child: TestElement, reference: TestElement): void;
      querySelectorAll(selector: string): TestElement[];
      querySelector(selector: string): TestElement | null;
      requireSelector(selector: string): TestElement;
      getBoundingClientRect(): { bottom: number };
    };
    const element = (tag: string): TestElement => {
      const classes = new Set<string>();
      const attributes = new Map<string, string>();
      const listeners = new Map<string, (event: { target: TestElement }) => void>();
      return {
        tag, style: {}, dataset: {}, textContent: '', children: [], parentNode: null,
        value: '', disabled: false, open: false, offsetWidth: 0,
        get parentElement() { return this.parentNode; },
        classList: {
          add(...names) { names.forEach(name => classes.add(name)); },
          remove(...names) { names.forEach(name => classes.delete(name)); },
          contains(name) { return classes.has(name); }
        },
        setAttribute(name, value) { attributes.set(name, String(value)); },
        getAttribute(name) { return attributes.get(name) ?? null; },
        addEventListener(type, listener) { listeners.set(type, listener); },
        click() { if (!this.disabled) listeners.get('click')?.({ target: this }); },
        appendChild(child) {
          if (child.parentNode) {
            child.parentNode.children = child.parentNode.children.filter(node => node !== child);
          }
          this.children.push(child);
          child.parentNode = this;
          return child;
        },
        replaceChildren(...children) {
          this.children.forEach(child => { child.parentNode = null; });
          this.children = [];
          children.forEach(child => this.appendChild(child));
        },
        remove() {
          if (this.parentNode) {
            this.parentNode.children = this.parentNode.children.filter(child => child !== this);
            this.parentNode = null;
          }
        },
        insertBefore(child, reference) {
          if (child.parentNode) {
            child.parentNode.children = child.parentNode.children.filter(node => node !== child);
          }
          const index = this.children.indexOf(reference);
          assert.ok(index >= 0, 'The reference element must exist.');
          this.children.splice(index, 0, child);
          child.parentNode = this;
        },
        querySelectorAll(selector) {
          if (selector === '.choices button') {
            return this.querySelectorAll('.choices').flatMap(choices => choices.querySelectorAll('button'));
          }
          return this.children.flatMap(child => [
            ...(selector.startsWith('.') ? child.classList.contains(selector.slice(1)) :
              selector.startsWith('#') ? child.id === selector.slice(1) || child.getAttribute('id') === selector.slice(1) :
              child.tag === selector) ? [child] : [],
            ...child.querySelectorAll(selector)
          ]);
        },
        querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; },
        requireSelector(selector) { return required(this.querySelector(selector)); },
        getBoundingClientRect() { return { bottom: 1000 - testWindow.pageYOffset }; }
      };
    };
    type TestDocument = {
      getElementById(id: string): TestElement;
      requireSelector(selector: string): TestElement;
      querySelectorAll(selector: string): TestElement[];
    };
    const createPage = (): TestDocument => {
      const root = element('div');
      root.classList.add('container');
      const header = element('div');
      header.classList.add('column-1-top');
      root.appendChild(header);
      ['timer-float', 'quiz-column', 'answers-column', 'submit-button-container'].forEach((className, index) => {
        const panel = element('div');
        panel.classList.add(className);
        panel.id = required(['timer', 'quiz', 'answers', 'submit'][index]);
        root.appendChild(panel);
      });
      const page = {
        documentElement: { scrollTop: 0 },
        createElement: element,
        getElementById: (id: string) => [root, ...root.querySelectorAll('div')].find(node => node.id === id) ??
          root.querySelectorAll('select').find(node => node.getAttribute('id') === id) ?? null,
        querySelector: (selector: string) => selector === '.container' ? root : root.querySelector(selector),
        querySelectorAll: (selector: string) => selector === '.choices button'
          ? root.querySelectorAll('.choices').flatMap(choices => choices.querySelectorAll('button'))
          : root.querySelectorAll(selector)
      };
      // The test page implements the browser features used by this quiz.
      Object.defineProperty(globalThis, 'document', { configurable: true, writable: true, value: page });
      return {
        getElementById: id => required(page.getElementById(id)),
        requireSelector: selector => required(page.querySelector(selector)),
        querySelectorAll: page.querySelectorAll
      };
    };
    const createQuizState = (): TOEICQuiz => {
      const quiz = new TOEICQuiz();
      quiz.questions = state.questions;
      quiz.correctAnswers = new Map(state.correctAnswers);
      quiz.timeLimit = 300;
      return quiz;
    };
    let intervalCallback: (() => void) | undefined;
    let intervalCount = 0;
    const clearedIntervals = new Set<unknown>();
    const windowListeners = new Map<string, (() => void)[]>();
    let scrollCalls = 0;
    const testWindow = {
      pageYOffset: 0,
      scrollTo() { scrollCalls += 1; },
      addEventListener(type: string, listener: () => void) {
        const listeners = windowListeners.get(type) ?? [];
        listeners.push(listener);
        windowListeners.set(type, listeners);
      }
    };
    try {
      Object.defineProperty(globalThis, 'window', { configurable: true, writable: true,
        value: testWindow });
      Object.defineProperty(globalThis, 'setInterval', { configurable: true, writable: true, value: (callback: () => void) => {
        intervalCallback = callback;
        intervalCount += 1;
        return intervalCount;
      } });
      Object.defineProperty(globalThis, 'clearInterval', { configurable: true, writable: true,
        value: (interval: unknown) => { clearedIntervals.add(interval); } });
      let testDocument = createPage();
      const startState = createQuizState();
      startState.displayTimeDropdown();
      startState.displayStartButton();
      const timeControls = testDocument.requireSelector('.timer-float');
      const timeDropdown = testDocument.getElementById('timeDropdown');
      const startButton = required(startState.startButton);
      timeDropdown.value = '600';
      [0, 450, 700, 1400, 350, 1600, 0].forEach(offset => {
        testWindow.pageYOffset = offset;
        ['scroll', 'resize'].forEach(type => {
          windowListeners.get(type)?.forEach(listener => listener());
          assert.notEqual(timeControls.style.position, 'fixed', 'Scrolling must keep the time controls in the page layout.');
          assert.notEqual(timeControls.style.position, 'absolute', 'The time controls must keep their space in the page.');
          assert.equal(timeDropdown.parentNode?.parentNode, timeControls);
          assert.equal(testDocument.getElementById('timeDropdown'), timeDropdown);
          assert.equal(timeDropdown.value, '600');
          assert.equal(startButton.parentNode, timeControls);
          assert.notEqual(timeControls.style.display, 'none');
          assert.notEqual(startButton.style.display, 'none');
          assert.equal(startButton.disabled, false);
          assert.equal(startState.quizStarted, false);
          assert.equal(intervalCount, 0);
          assert.equal(scrollCalls, 0);
        });
      });
      testDocument.getElementById('timeDropdown').value = '300';
      required(startState.startButton).click();
      assert.equal(startState.timeLimit, 300);
      assert.equal(startState.quizStarted, true);
      const questionCards = testDocument.querySelectorAll('.question');
      assert.equal(questionCards.length, 30);
      assert.equal(intervalCount, 1);
      startState.startQuiz();
      assert.equal(testDocument.querySelectorAll('.question').length, 30);
      assert.equal(intervalCount, 1);
      assert.equal(fetches, 1);
      assert.equal(startState.questions, originalSelection);
      assert.equal(testDocument.querySelectorAll('details').length, 0);
      assert.equal(testDocument.querySelectorAll('time').length, 0);
      assert.equal(testDocument.querySelectorAll('.completion').length, 0);
      assert.equal(testDocument.requireSelector('.answers-column').children.length, 0);
      startState.positionSolutions();
      assert.equal(testDocument.querySelectorAll('.answer-card').length, 0);

      questionCards.forEach((card, index) => {
        const question = required(startState.questions[index]);
        assert.equal(card.requireSelector('.question-text').textContent, question.question);
        const buttons = card.querySelectorAll('button');
        assert.equal(buttons.length, 4);
        assert.ok(buttons.every(button => button.dataset.questionIndex === String(index)));
        assert.deepEqual(new Set(buttons.map(button => button.dataset.choice)), new Set(question.choices));
        if (index < 20) {
          const choice = required(buttons.find(button => index < 10
            ? button.dataset.choice === question.answer
            : button.dataset.choice !== question.answer));
          choice.click();
          assert.equal(startState.answers.get(String(index)), choice.dataset.choice);
          assert.equal(choice.getAttribute('aria-pressed'), 'true');
        }
      });

      const firstButtons = required(questionCards[0]).querySelectorAll('button');
      const firstQuestion = required(startState.questions[0]);
      const correctButton = required(firstButtons.find(button => button.dataset.choice === firstQuestion.answer));
      const wrongButton = required(firstButtons.find(button => button !== correctButton));
      wrongButton.click();
      correctButton.click();
      assert.equal(wrongButton.getAttribute('aria-pressed'), 'false');
      assert.equal(correctButton.getAttribute('aria-pressed'), 'true');

      const submitButton = testDocument.requireSelector('.submit-button');
      globalThis.confirm = () => false;
      submitButton.click();
      assert.equal(startState.completedAt, null);
      assert.equal(startState.quizSubmitted, false);
      assert.equal(startState.answerCorrectness.length, 0);
      assert.equal(testDocument.querySelectorAll('details').length, 0);
      assert.ok(!clearedIntervals.has(startState.timerInterval));

      globalThis.confirm = () => true;
      const beforeSubmission = Date.now();
      submitButton.click();
      assert.equal(startState.score, 10);
      assert.equal(startState.quizSubmitted, true);
      assert.equal(startState.submitClicked, true);
      const submittedAt = required<Date>(startState.completedAt);
      assert.ok(submittedAt.getTime() >= beforeSubmission);
      assert.ok(submittedAt.getTime() <= Date.now());
      assert.ok(clearedIntervals.has(startState.timerInterval));
      assert.ok(testDocument.querySelectorAll('.choices button').every(button => button.disabled));
      assert.equal(submitButton.disabled, true);
      assert.equal(testDocument.requireSelector('.timer-float').style.display, 'none');
      assert.equal(testDocument.requireSelector('.score').textContent.trim(), '10');
      assert.equal(testDocument.requireSelector('.score').requireSelector('span').textContent, 'out of 30');
      assert.equal(testDocument.requireSelector('time').getAttribute('datetime'), submittedAt.toISOString());
      assert.equal(testDocument.requireSelector('time').textContent, formatCompletionTime(submittedAt).label);
      assert.equal(testDocument.requireSelector('.time-zone').textContent, formatCompletionTime(submittedAt).timeZone);

      const resultCards = testDocument.querySelectorAll('.answer-card');
      assert.equal(resultCards.length, 30);
      ['correct', 'wrong', 'unanswered'].forEach(status => {
        assert.equal(resultCards.filter(card => card.classList.contains(status)).length, 10);
      });
      resultCards.forEach((card, index) => {
        const question = required(startState.questions[index]);
        const questionCard = required(questionCards[index]);
        assert.equal(card.dataset.questionIndex, String(index));
        assert.equal(card.parentNode, questionCard);
        assert.equal(questionCard.children.at(-1), card);
        const status = index < 10 ? 'correct' : index < 20 ? 'wrong' : 'unanswered';
        const badge = card.requireSelector('.status');
        assert.ok(badge.classList.contains('status-' + status));
        assert.ok(questionCard.requireSelector('.status').classList.contains('status-' + status));
        assert.equal(card.requireSelector('h3').textContent, 'Question ' + (index + 1));
        const values = card.requireSelector('.answer-lines').querySelectorAll('dd');
        assert.equal(required(values[0]).textContent, startState.answers.get(String(index)) ?? 'No answer selected');
        assert.equal(required(values[1]).textContent, question.answer);
        const details = card.requireSelector('details');
        assert.equal(details.open, index === 0);
        const explanation = question.explanation;
        assert.ok(hasLearningNotes(explanation));
        const fields: LearningField[] = ['vocabulary', 'grammar', 'usage', 'example'];
        assert.deepEqual(details.querySelectorAll('dd').map(description => description.textContent),
          fields.map(field => explanation[field]));
        assert.equal(details.querySelectorAll('dt').map(term => term.textContent).join(','),
          'Vocabulary,Grammar,Usage,Example');
        const buttons = questionCard.querySelectorAll('button');
        assert.ok(required(buttons.find(button => button.dataset.choice === question.answer)).classList.contains('choice-correct'));
        if (status === 'wrong') {
          assert.ok(required(buttons.find(button => button.dataset.choice === startState.answers.get(String(index)))).classList.contains('choice-wrong'));
        }
      });

      required(resultCards[1]).requireSelector('details').open = true;
      startState.positionSolutions();
      assert.equal(testDocument.querySelectorAll('.answer-card').length, 30);
      assert.equal(testDocument.requireSelector('.answers-column').style.display, 'none');
      resultCards.forEach((card, index) => {
        assert.equal(card.parentNode, questionCards[index]);
        assert.equal(required(questionCards[index]).children.at(-1), card);
        assert.equal(card.requireSelector('details').open, index < 2);
        assert.equal(required(card.requireSelector('.answer-lines').querySelectorAll('dd')[1]).textContent,
          required(startState.questions[index]).answer);
      });

      const grades = startState.answerCorrectness;
      const completedAt = startState.completedAt;
      const timestamp = testDocument.requireSelector('time').getAttribute('datetime');
      startState.submitQuiz();
      submitButton.click();
      startState.selectAnswer({ target: pageElement<HTMLButtonElement>('.choices button') });
      assert.equal(startState.answers.get('0'), firstQuestion.answer);
      assert.equal(startState.answerCorrectness, grades);
      assert.equal(startState.completedAt, completedAt);
      assert.equal(testDocument.requireSelector('time').getAttribute('datetime'), timestamp);
      assert.equal(testDocument.querySelectorAll('.answer-card').length, 30);
      startState.displayScore();
      assert.equal(testDocument.querySelectorAll('.completion').length, 1);
      assert.equal(testDocument.querySelectorAll('time').length, 1);
      assert.equal(testDocument.requireSelector('time').getAttribute('datetime'), timestamp);

      testDocument = createPage();
      const automaticState = createQuizState();
      automaticState.timeLimit = 1;
      automaticState.displayTimeDropdown();
      automaticState.displayStartButton();
      automaticState.startQuiz();
      assert.equal(testDocument.querySelectorAll('.answer-card').length, 0);
      assert.equal(testDocument.querySelectorAll('details').length, 0);
      const automaticButtons = testDocument.querySelectorAll('.choices button');
      required(automaticButtons.find(button => button.dataset.questionIndex === '0' &&
        button.dataset.choice === required(automaticState.questions[0]).answer)).click();
      globalThis.confirm = () => { throw new Error('Automatic submission must not ask for confirmation.'); };
      assert.equal(automaticState.completedAt, null);
      const beforeTimeout = Date.now();
      required(intervalCallback)();
      assert.equal(automaticState.score, 1);
      assert.equal(automaticState.answerCorrectness.filter(answer => answer.status === 'unanswered').length, 29);
      assert.equal(automaticState.quizSubmitted, true);
      const timedOutAt = required<Date>(automaticState.completedAt);
      assert.ok(timedOutAt.getTime() >= beforeTimeout);
      assert.ok(clearedIntervals.has(automaticState.timerInterval));
      assert.ok(automaticButtons.every(button => button.disabled));
      assert.equal(testDocument.querySelectorAll('details').length, 30);
      assert.equal(testDocument.requireSelector('.answers-column').style.display, 'none');
      testDocument.querySelectorAll('.answer-card').forEach((card, index) => {
        assert.equal(card.parentNode, testDocument.querySelectorAll('.question')[index]);
      });
      assert.equal(testDocument.requireSelector('time').getAttribute('datetime'), timedOutAt.toISOString());
      const automaticTimestamp = automaticState.completedAt;
      required(intervalCallback)();
      assert.equal(automaticState.completedAt, automaticTimestamp);
      assert.equal(testDocument.querySelectorAll('.answer-card').length, 30);

      automaticState.questions = [{ ...required(automaticState.questions[0]), explanation: undefined }, ...automaticState.questions.slice(1)];
      automaticState.displayCorrectAnswers();
      assert.equal(testDocument.querySelectorAll('.answer-card').length, 30);
      assert.equal(testDocument.querySelectorAll('details').length, 29);
      testDocument.querySelectorAll('.question').forEach(card => {
        assert.equal(card.querySelectorAll('.answer-card').length, 1);
      });
      assert.equal(required(testDocument.querySelectorAll('.answer-card')[0]).requireSelector('p').textContent,
        'Learning notes are not available for this question.');
      assert.equal(JSON.stringify(bank), snapshot);
    } finally {
      savedGlobals.forEach(({ name, descriptor }) => {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
      });
    }

    globalThis.fetch = async () => new Response(null, { status: 500 });
    await assert.rejects(() => TOEICQuiz.prototype.loadQuestions.call(state), /could not be loaded/);
    globalThis.fetch = async () => new Response('{');
    await assert.rejects(() => TOEICQuiz.prototype.loadQuestions.call(state), /could not be read/);
  } finally {
    globalThis.fetch = savedFetch;
  }

  const counts = ['basic', 'intermediate', 'advanced'].map(difficulty =>
    `${difficulty}: ${bank.filter(question => question.review === 'eligible' && question.difficulty === difficulty).length}`);
  console.log(`Questions: ${bank.length}. Eligible ${counts.join(', ')}. Excluded: ${bank.filter(question => question.review === 'excluded').length}.`);
  console.log(`Passed: ${revisedPositions.size} revised entries, ${bank.length - revisedPositions.size} preserved entries, category counts, unique stems, ${newVocabulary.length} distinct vocabulary targets, 100 selections, exact pool limits, exclusions, choice shuffling, scoring, answer key matching, start, answer selection and load errors.`);
  console.log(`Passed: ${activeQuestions.length} active learning notes, notes for every revised entry, question and answer cards, note matching, no early results, manual submission, canceled submission, timeout submission, answer locking, fixed completion times, six time zone cases and missing notes.`);
  console.log('Passed: solutions below matching questions without a screen width check, open notes preserved and no duplicate solutions.');
  console.log('Passed: scrolling and resizing keep the time controls in the page layout before the quiz starts.');
}

if (typeof document !== 'undefined') {
  const quiz = new TOEICQuiz();
  quiz.displayQuiz();
} else if (typeof process !== 'undefined' && process.argv.includes('--verify')) {
  verifyQuiz().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
