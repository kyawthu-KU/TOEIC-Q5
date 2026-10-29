// quiz.js

const QUESTION_MIX = Object.freeze([
  { difficulty: 'advanced', count: 20 },
  { difficulty: 'intermediate', count: 10 }
]);

function normalizeQuestion(text) {
  return text.normalize('NFKC').trim().replace(/_+/g, '_____').replace(/\s+/g, ' ').toLowerCase();
}

function selectQuestions(bank, shuffle) {
  if (!Array.isArray(bank)) {
    throw new Error('The question bank could not be read. Please contact your instructor.');
  }

  const valid = bank.every(question => question &&
    typeof question.question === 'string' &&
    (question.question.match(/_+/g) || []).length === 1 &&
    Array.isArray(question.choices) && question.choices.length === 4 &&
    question.choices.every(choice => typeof choice === 'string' && choice.trim().length > 0) &&
    new Set(question.choices.map(choice => choice.trim().toLowerCase())).size === 4 &&
    question.choices.includes(question.answer) &&
    ['basic', 'intermediate', 'advanced'].includes(question.difficulty) &&
    ['eligible', 'excluded'].includes(question.review) &&
    (question.review !== 'excluded' ||
      (typeof question.exclusionReason === 'string' && question.exclusionReason.trim().length > 0)));

  if (!valid) {
    throw new Error('The question bank needs review before this quiz can start. Please contact your instructor.');
  }

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

function formatCompletionTime(date) {
  const options = {
    year: 'numeric', month: 'long', day: 'numeric',
    hour: 'numeric', minute: '2-digit', second: '2-digit'
  };
  const zone = new Intl.DateTimeFormat('en-US', { timeZoneName: 'long' })
    .formatToParts(date).find(part => part.type === 'timeZoneName').value;
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
    this.answerCorrectness = new Array(this.numQuestions).fill(false); // Array to store correctness of answers

    // Get references to the elements
    this.timerFloat = document.querySelector('.timer-float');
    this.column1Top = document.querySelector('.column-1-top');
    this.startButton = document.querySelector('.start-button');

    // Store the original width of the .timer-float element
    this.originalTimerFloatWidth = this.timerFloat.offsetWidth;

    // Bind event listeners
    this.adjustTimerFloatPosition = this.adjustTimerFloatPosition.bind(this);
    this.startQuiz = this.startQuiz.bind(this);
    this.adjustTimerFloatPosition();
    // Add event listener for window resize
    window.addEventListener('resize', () => {
      this.adjustTimerFloatPosition();
      this.positionSolutions();
    });
    window.addEventListener('scroll', this.adjustTimerFloatPosition);
  }

  // Method to shuffle an array
  shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }

  // Method to handle selection of answer choices
  selectAnswer(event) {
    if (this.submitClicked || this.quizSubmitted) {
      return; // Prevent selection after submit button is clicked
    }

    const selectedButton = event.target;
    // console.log("selectedButton ", selectedButton);
    const questionIndex = this.getQuestionIndex(selectedButton);

    // Deselect any previously selected answer choice
    const choicesList = selectedButton.parentNode;
    choicesList.querySelectorAll('button').forEach(button => {
      button.classList.remove('selected');
      button.setAttribute('aria-pressed', 'false');
      button.style.backgroundColor = ''; // Reset background color
    });

    // Toggle 'selected' class for clicked answer choice
    selectedButton.classList.add('selected');
    selectedButton.setAttribute('aria-pressed', 'true');

    // Highlight the clicked answer choice
    selectedButton.style.backgroundColor = 'lightblue';

    // Store the user's selection for later scoring
    const selectedChoice = selectedButton.dataset.choice;

    // console.log("questionIndex in selectAnswer = ", questionIndex, selectedChoice);
    const answerKey = `${questionIndex}`;
    this.answers.set(answerKey, selectedChoice);
    // console.log("this.answers in selectAnswer : ", this.answers);
  }

  // Method to get the question index from a button element
  getQuestionIndex(button) {
    return parseInt(button.dataset.questionIndex);
  }

  // Method to add event listeners to answer choice buttons
  addChoiceListeners() {
    document.querySelectorAll('.choices button').forEach(button => {
      button.addEventListener('click', this.selectAnswer.bind(this));
    });
  }

  async displayQuiz() {
    try {
      await this.loadQuestions();
      this.displayTimeDropdown();
      this.displayStartButton();

      // Add margin between "Choose time" label and dropdown
      const dropdownLabel = document.querySelector('label[for="timeDropdown"]');
      dropdownLabel.style.marginBottom = '20px'; // Adjust as needed

      // Add margin between dropdown and "Start Quiz" button
      const dropdown = document.getElementById('timeDropdown');
      dropdown.style.marginBottom = '20px'; // Adjust as needed

    } catch (error) {
      console.error('Error loading quiz:', error);
      const message = document.createElement('p');
      message.setAttribute('role', 'alert');
      message.textContent = error.message;
      message.style.color = 'red';
      this.timerFloat.replaceChildren(message);
    }
  }

  async loadQuestions() {
    const response = await fetch('./questions/questionsPart5Sample.json');
    if (!response.ok) {
      throw new Error('Questions could not be loaded. Please reload the page or contact your instructor.');
    }
    let bank;
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
    const quizElement = document.getElementById('quiz'); // Get quiz element

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
  displayChoices(choicesList, choices, questionIndex) {
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
      choiceButton.dataset.questionIndex = questionIndex;

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
    // document.getElementById('quiz').appendChild(hrElement); // Append horizontal line before the Submit button
    // document.getElementById('quiz').appendChild(submitButton); // Append Submit button

    // Append the submit button inside the .submit-button div
    const submitButtonContainer = document.getElementById('submit');
    submitButtonContainer.appendChild(submitButton);

  }


  // Method to calculate score
  calculateScore() {
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
      let answerStatus;
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

    document.querySelector('.container').insertBefore(completion, document.getElementById('quiz'));
  }

  // Method to load correct answers
  loadCorrectAnswers() {
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
      const correctAnswer = this.correctAnswers.get(key);
      const questionIndex = Number(key);
      const question = this.questions[questionIndex];
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
      [
        ['Your answer', this.answers.get(key) ?? 'No answer selected', status === 'wrong' ? 'wrong-answer' : ''],
        ['Correct answer', correctAnswer, 'correct-answer']
      ].forEach(([label, value, className]) => {
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

      const fields = ['vocabulary', 'grammar', 'usage', 'example'];
      if (fields.every(field => typeof question.explanation?.[field] === 'string' && question.explanation[field].trim())) {
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
          term.textContent = field[0].toUpperCase() + field.slice(1);
          const description = document.createElement('dd');
          description.textContent = question.explanation[field];
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

    const answersColumn = document.querySelector('.answers-column');
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

    const inline = window.matchMedia('(max-width: 768px)').matches;
    const answersContainer = document.querySelector('.correct-answers');
    const questionCards = document.querySelectorAll('.question');
    document.querySelectorAll('.answer-card').forEach(card => {
      const target = inline ? questionCards[Number(card.dataset.questionIndex)] : answersContainer;
      if (target && card.parentNode !== target) target.appendChild(card);
    });
    document.querySelector('.answers-column').style.display = inline ? 'none' : 'block';
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
    document.querySelector('.timer-float').appendChild(dropdownContainer);

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
      const selectedTime = document.getElementById('timeDropdown').value;
      this.timeLimit = parseInt(selectedTime);
      this.startQuiz();
    });

    // Append the start button to the new-box container
    const newBox = document.querySelector('.timer-float');
    newBox.appendChild(startButton);
    // document.getElementById('quiz').appendChild(startButton);
  }

  adjustTimerFloatPosition() {
    const rect = this.column1Top.getBoundingClientRect();
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;

    if (scrollTop >= rect.bottom) {
      const originalWidth = this.timerFloat.offsetWidth; // Store the original width

      // Apply fixed positioning and set the original width
      this.timerFloat.style.position = 'fixed';
      this.timerFloat.style.top = '0';
      // this.timerFloat.style.left = '0';
      this.timerFloat.style.width = `${originalWidth}px`; // Explicitly set the width
    } else {
      // Revert to relative positioning and remove the width property
      this.timerFloat.style.position = 'relative';
      this.timerFloat.style.top = '';
      this.timerFloat.style.left = '';
      this.timerFloat.style.width = '';
    }
  }

  startQuiz() {
    if (this.quizStarted) {
      return;
    }
    // Hide time dropdown and start button
    document.getElementById('timeDropdown').style.display = 'none';
    this.startButton.style.display = 'none';

    // Hide the dropdown container
    const dropdownContainer = document.querySelector('.timer-float');
    dropdownContainer.querySelector('select').style.display = 'none';
    dropdownContainer.querySelector('label').style.display = 'none';

    // Display remaining time
    this.displayTimer();

    // Display the quiz column, answers column, and submit button
    document.querySelector('.quiz-column').style.display = 'block';
    document.querySelector('.answers-column').style.display = 'block';
    document.querySelector('.submit-button-container').style.display = 'block';

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
    // document.getElementById('quiz').appendChild(timerElement);

    // Append the timer element to the timer-float container
    const newBox = document.querySelector('.timer-float');
    newBox.appendChild(timerElement);

    // Start the timer
    this.timerInterval = setInterval(() => {
      this.timeLimit--;
      timerElement.textContent = `Time left: ${this.formatTime(this.timeLimit)}`;

      if (this.timeLimit <= 0) {
        clearInterval(this.timerInterval);
        this.submitQuiz();
        // console.log("submitQuiz was called.");
      }
    }, 1000); // Update the timer every second
  }

  formatTime(seconds) {
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
    clearInterval(this.timerInterval);

    document.querySelectorAll('.choices button').forEach(button => {
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
    document.querySelector('.submit-button').disabled = true;
    this.calculateScore();

    const statusLabels = { correct: 'Correct', wrong: 'Incorrect', unanswered: 'Unanswered' };
    document.querySelectorAll('.question').forEach(card => {
      const status = this.answerCorrectness[Number(card.dataset.questionIndex)].status;
      const badge = document.createElement('span');
      badge.classList.add('status', `status-${status}`);
      badge.textContent = statusLabels[status];
      card.querySelector('.card-heading').appendChild(badge);
    });
    document.querySelector('.timer-float').style.display = 'none';
  }
}

// Run with --verify to check the real selection, loading and scoring functions.
async function verifyQuiz() {
  const { readFile } = await import('node:fs/promises');
  const { createHash } = await import('node:crypto');
  const { pathToFileURL } = await import('node:url');
  const { default: assert } = await import('node:assert/strict');
  const bank = JSON.parse(await readFile(new URL('../questions/questionsPart5Sample.json', pathToFileURL(__filename)), 'utf8'));
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
        const common = [...words[index]].filter(word => other.has(word)).length;
        return { index: otherIndex, overlap: common / (words[index].size + other.size - common) };
      }).reduce((best, candidate) => candidate.overlap > best.overlap ? candidate : best, { index: 0, overlap: 0 });
      if (closest.overlap >= 0.4) {
        matches += 1;
        console.log(`Review ${index + 1} against ${closest.index + 1}:\n${question.question}\n${bank[closest.index].question}`);
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
  const newVocabulary = newQuestions.filter(question => ['vocabulary', 'distinction'].includes(question.category));
  assert.equal(newVocabulary.length, 99);
  assert.equal(new Set(newVocabulary.map(question => question.answer.toLowerCase())).size, newVocabulary.length);
  const activeQuestions = bank.filter(question => question.review === 'eligible' &&
    QUESTION_MIX.some(group => group.difficulty === question.difficulty));
  assert.equal(activeQuestions.length, 882);
  const questionsWithNotes = bank.filter((question, index) => activeQuestions.includes(question) || revisedPositions.has(index + 1));
  assert.ok(questionsWithNotes.every(question => ['vocabulary', 'grammar', 'usage', 'example']
    .every(field => typeof question.explanation?.[field] === 'string' && question.explanation[field].trim())));

  const savedTimeZone = process.env.TZ;
  try {
    [
      ['UTC', '2026-10-28T05:32:08.000Z', 'UTC+00:00', 'October 28, 2026', '5:32:08'],
      ['Asia/Tokyo', '2026-10-28T05:32:08.000Z', 'UTC+09:00', 'October 28, 2026', '2:32:08'],
      ['Asia/Kathmandu', '2026-10-28T05:32:08.000Z', 'UTC+05:45', 'October 28, 2026', '11:17:08'],
      ['America/New_York', '2026-01-01T12:00:00.000Z', 'UTC-05:00', 'January 1, 2026', '7:00:00'],
      ['America/New_York', '2026-07-01T12:00:00.000Z', 'UTC-04:00', 'July 1, 2026', '8:00:00'],
      ['Pacific/Kiritimati', '2026-10-28T15:32:08.000Z', 'UTC+14:00', 'October 29, 2026', '5:32:08']
    ].forEach(([zone, instant, offset, day, clock]) => {
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
    const scoreState = {
      questions, correctAnswers: new Map(),
      answers: new Map(questions.map((question, index) => [String(index), question.answer])),
      displayScore() {}, displayCorrectAnswers() {}
    };
    TOEICQuiz.prototype.loadCorrectAnswers.call(scoreState);
    TOEICQuiz.prototype.calculateScore.call(scoreState);
    assert.equal(scoreState.score, 30);
    scoreState.answers = new Map(questions.slice(0, 20).map((question, index) => [String(index),
      index < 10 ? question.answer : question.choices.find(choice => choice !== question.answer)]));
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
  const excluded = { ...additions[0], review: 'excluded', exclusionReason: 'This entry is excluded for the selection check.' };
  const bankWithExclusion = [excluded, ...bank.filter(question => question !== additions[0])];
  assert.ok(!selectQuestions(bankWithExclusion, questions => questions).includes(excluded));

  const savedFetch = globalThis.fetch;
  let fetches = 0;
  const state = {
    questions: [], correctAnswers: new Map([['old', 'old']]), shuffleArray: shuffle,
    loadCorrectAnswers: TOEICQuiz.prototype.loadCorrectAnswers
  };
  try {
    globalThis.fetch = async () => {
      fetches += 1;
      return { ok: true, json: async () => bank };
    };
    await TOEICQuiz.prototype.loadQuestions.call(state);
    assert.equal(fetches, 1);
    assert.equal(state.correctAnswers.size, 30);
    assert.ok(!state.correctAnswers.has('old'));
    state.questions.forEach((question, index) => assert.equal(state.correctAnswers.get(String(index)), question.answer));

    const savedDocument = globalThis.document;
    const savedWindow = globalThis.window;
    const savedConfirm = globalThis.confirm;
    const savedSetInterval = globalThis.setInterval;
    const savedClearInterval = globalThis.clearInterval;
    const originalSelection = state.questions;
    const element = tag => {
      const classes = new Set();
      const attributes = new Map();
      const listeners = new Map();
      return {
        tag, style: {}, dataset: {}, textContent: '', children: [],
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
          return this.children.flatMap(child => [
            ...(selector.startsWith('.') ? child.classList.contains(selector.slice(1)) : child.tag === selector) ? [child] : [],
            ...child.querySelectorAll(selector)
          ]);
        },
        querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
      };
    };
    const createPage = () => {
      const root = element('div');
      root.classList.add('container');
      ['timer-float', 'quiz-column', 'answers-column', 'submit-button-container'].forEach((className, index) => {
        const panel = element('div');
        panel.classList.add(className);
        panel.id = ['timer', 'quiz', 'answers', 'submit'][index];
        root.appendChild(panel);
      });
      globalThis.document = {
        createElement: element,
        getElementById: id => [root, ...root.querySelectorAll('div')].find(node => node.id === id) ??
          root.querySelectorAll('select').find(node => node.getAttribute('id') === id) ?? null,
        querySelector: selector => selector === '.container' ? root : root.querySelector(selector),
        querySelectorAll: selector => selector === '.choices button'
          ? root.querySelectorAll('.choices').flatMap(choices => choices.querySelectorAll('button'))
          : root.querySelectorAll(selector)
      };
      return root;
    };
    const createQuizState = () => ({
      ...Object.fromEntries(Object.getOwnPropertyNames(TOEICQuiz.prototype)
        .filter(name => name !== 'constructor').map(name => [name, TOEICQuiz.prototype[name]])),
      ...state, answers: new Map(), numQuestions: 30, score: 0, timeLimit: 300,
      quizStarted: false, quizSubmitted: false, submitClicked: false, completedAt: null,
      answerCorrectness: []
    });
    let intervalCallback;
    let intervalCount = 0;
    let viewportWidth = 1024;
    const clearedIntervals = new Set();
    try {
      globalThis.window = {
        scrollTo() {},
        matchMedia: () => ({ matches: viewportWidth <= 768 })
      };
      globalThis.setInterval = callback => {
        intervalCallback = callback;
        intervalCount += 1;
        return intervalCount;
      };
      globalThis.clearInterval = interval => clearedIntervals.add(interval);
      createPage();
      const startState = createQuizState();
      startState.displayTimeDropdown();
      startState.displayStartButton();
      document.getElementById('timeDropdown').value = '300';
      startState.startButton.click();
      const questionCards = document.querySelectorAll('.question');
      assert.equal(questionCards.length, 30);
      assert.equal(intervalCount, 1);
      startState.startQuiz();
      assert.equal(document.querySelectorAll('.question').length, 30);
      assert.equal(intervalCount, 1);
      assert.equal(fetches, 1);
      assert.equal(startState.questions, originalSelection);
      assert.equal(document.querySelectorAll('details').length, 0);
      assert.equal(document.querySelectorAll('time').length, 0);
      assert.equal(document.querySelectorAll('.completion').length, 0);
      assert.equal(document.querySelector('.answers-column').children.length, 0);
      startState.positionSolutions();
      assert.equal(document.querySelectorAll('.answer-card').length, 0);

      questionCards.forEach((card, index) => {
        assert.equal(card.querySelector('.question-text').textContent, startState.questions[index].question);
        const buttons = card.querySelectorAll('button');
        assert.equal(buttons.length, 4);
        assert.ok(buttons.every(button => button.dataset.questionIndex === index));
        assert.deepEqual(new Set(buttons.map(button => button.dataset.choice)), new Set(startState.questions[index].choices));
        if (index < 20) {
          const choice = buttons.find(button => index < 10
            ? button.dataset.choice === startState.questions[index].answer
            : button.dataset.choice !== startState.questions[index].answer);
          choice.click();
          assert.equal(startState.answers.get(String(index)), choice.dataset.choice);
          assert.equal(choice.getAttribute('aria-pressed'), 'true');
        }
      });

      const firstButtons = questionCards[0].querySelectorAll('button');
      const correctButton = firstButtons.find(button => button.dataset.choice === startState.questions[0].answer);
      const wrongButton = firstButtons.find(button => button !== correctButton);
      wrongButton.click();
      correctButton.click();
      assert.equal(wrongButton.getAttribute('aria-pressed'), 'false');
      assert.equal(correctButton.getAttribute('aria-pressed'), 'true');

      const submitButton = document.querySelector('.submit-button');
      globalThis.confirm = () => false;
      submitButton.click();
      assert.equal(startState.completedAt, null);
      assert.equal(startState.quizSubmitted, false);
      assert.equal(startState.answerCorrectness.length, 0);
      assert.equal(document.querySelectorAll('details').length, 0);
      assert.ok(!clearedIntervals.has(startState.timerInterval));

      globalThis.confirm = () => true;
      const beforeSubmission = Date.now();
      submitButton.click();
      assert.equal(startState.score, 10);
      assert.equal(startState.quizSubmitted, true);
      assert.equal(startState.submitClicked, true);
      assert.ok(startState.completedAt.getTime() >= beforeSubmission);
      assert.ok(startState.completedAt.getTime() <= Date.now());
      assert.ok(clearedIntervals.has(startState.timerInterval));
      assert.ok(document.querySelectorAll('.choices button').every(button => button.disabled));
      assert.equal(submitButton.disabled, true);
      assert.equal(document.querySelector('.timer-float').style.display, 'none');
      assert.equal(document.querySelector('.score').textContent.trim(), '10');
      assert.equal(document.querySelector('.score').querySelector('span').textContent, 'out of 30');
      assert.equal(document.querySelector('time').getAttribute('datetime'), startState.completedAt.toISOString());
      assert.equal(document.querySelector('time').textContent, formatCompletionTime(startState.completedAt).label);
      assert.equal(document.querySelector('.time-zone').textContent, formatCompletionTime(startState.completedAt).timeZone);

      const resultCards = document.querySelectorAll('.answer-card');
      assert.equal(resultCards.length, 30);
      ['correct', 'wrong', 'unanswered'].forEach(status => {
        assert.equal(resultCards.filter(card => card.classList.contains(status)).length, 10);
      });
      resultCards.forEach((card, index) => {
        const question = startState.questions[index];
        assert.equal(card.dataset.questionIndex, String(index));
        assert.equal(card.parentNode, document.querySelector('.correct-answers'));
        const status = index < 10 ? 'correct' : index < 20 ? 'wrong' : 'unanswered';
        const badge = card.querySelector('.status');
        assert.ok(badge.classList.contains('status-' + status));
        assert.ok(questionCards[index].querySelector('.status').classList.contains('status-' + status));
        assert.equal(card.querySelector('h3').textContent, 'Question ' + (index + 1));
        const values = card.querySelector('.answer-lines').querySelectorAll('dd');
        assert.equal(values[0].textContent, startState.answers.get(String(index)) ?? 'No answer selected');
        assert.equal(values[1].textContent, question.answer);
        const details = card.querySelector('details');
        assert.equal(details.open, index === 0);
        assert.deepEqual(details.querySelectorAll('dd').map(description => description.textContent),
          ['vocabulary', 'grammar', 'usage', 'example'].map(field => question.explanation[field]));
        assert.equal(details.querySelectorAll('dt').map(term => term.textContent).join(','),
          'Vocabulary,Grammar,Usage,Example');
        const buttons = questionCards[index].querySelectorAll('button');
        assert.ok(buttons.find(button => button.dataset.choice === question.answer).classList.contains('choice-correct'));
        if (status === 'wrong') {
          assert.ok(buttons.find(button => button.dataset.choice === startState.answers.get(String(index))).classList.contains('choice-wrong'));
        }
      });

      resultCards[1].querySelector('details').open = true;
      [320, 390, 768, 769, 1024, 390].forEach(width => {
        viewportWidth = width;
        startState.positionSolutions();
        assert.equal(document.querySelectorAll('.answer-card').length, 30);
        assert.equal(document.querySelector('.answers-column').style.display, width <= 768 ? 'none' : 'block');
        resultCards.forEach((card, index) => {
          assert.equal(card.parentNode, width <= 768 ? questionCards[index] : document.querySelector('.correct-answers'));
          if (width <= 768) assert.equal(questionCards[index].children.at(-1), card);
          assert.equal(card.querySelector('details').open, index < 2);
          assert.equal(card.querySelector('.answer-lines').querySelectorAll('dd')[1].textContent,
            startState.questions[index].answer);
        });
      });

      const grades = startState.answerCorrectness;
      const completedAt = startState.completedAt;
      const timestamp = document.querySelector('time').getAttribute('datetime');
      startState.submitQuiz();
      submitButton.click();
      startState.selectAnswer({ target: wrongButton });
      assert.equal(startState.answers.get('0'), startState.questions[0].answer);
      assert.equal(startState.answerCorrectness, grades);
      assert.equal(startState.completedAt, completedAt);
      assert.equal(document.querySelector('time').getAttribute('datetime'), timestamp);
      assert.equal(document.querySelectorAll('.answer-card').length, 30);
      startState.displayScore();
      assert.equal(document.querySelectorAll('.completion').length, 1);
      assert.equal(document.querySelectorAll('time').length, 1);
      assert.equal(document.querySelector('time').getAttribute('datetime'), timestamp);

      createPage();
      const automaticState = createQuizState();
      automaticState.timeLimit = 1;
      automaticState.displayTimeDropdown();
      automaticState.displayStartButton();
      automaticState.startQuiz();
      assert.equal(document.querySelectorAll('.answer-card').length, 0);
      assert.equal(document.querySelectorAll('details').length, 0);
      const automaticButtons = document.querySelectorAll('.choices button');
      automaticButtons.find(button => button.dataset.questionIndex === 0 &&
        button.dataset.choice === automaticState.questions[0].answer).click();
      globalThis.confirm = () => { throw new Error('Automatic submission must not ask for confirmation.'); };
      assert.equal(automaticState.completedAt, null);
      const beforeTimeout = Date.now();
      intervalCallback();
      assert.equal(automaticState.score, 1);
      assert.equal(automaticState.answerCorrectness.filter(answer => answer.status === 'unanswered').length, 29);
      assert.equal(automaticState.quizSubmitted, true);
      assert.ok(automaticState.completedAt.getTime() >= beforeTimeout);
      assert.ok(clearedIntervals.has(automaticState.timerInterval));
      assert.ok(automaticButtons.every(button => button.disabled));
      assert.equal(document.querySelectorAll('details').length, 30);
      assert.equal(document.querySelector('.answers-column').style.display, 'none');
      document.querySelectorAll('.answer-card').forEach((card, index) => {
        assert.equal(card.parentNode, document.querySelectorAll('.question')[index]);
      });
      assert.equal(document.querySelector('time').getAttribute('datetime'), automaticState.completedAt.toISOString());
      const automaticTimestamp = automaticState.completedAt;
      intervalCallback();
      assert.equal(automaticState.completedAt, automaticTimestamp);
      assert.equal(document.querySelectorAll('.answer-card').length, 30);

      automaticState.questions = [{ ...automaticState.questions[0], explanation: undefined }, ...automaticState.questions.slice(1)];
      automaticState.displayCorrectAnswers();
      assert.equal(document.querySelectorAll('.answer-card').length, 30);
      assert.equal(document.querySelectorAll('details').length, 29);
      document.querySelectorAll('.question').forEach(card => {
        assert.equal(card.querySelectorAll('.answer-card').length, 1);
      });
      assert.equal(document.querySelectorAll('.answer-card')[0].querySelector('p').textContent,
        'Learning notes are not available for this question.');
      assert.equal(JSON.stringify(bank), snapshot);
    } finally {
      if (savedDocument === undefined) delete globalThis.document;
      else globalThis.document = savedDocument;
      if (savedWindow === undefined) delete globalThis.window;
      else globalThis.window = savedWindow;
      if (savedConfirm === undefined) delete globalThis.confirm;
      else globalThis.confirm = savedConfirm;
      globalThis.setInterval = savedSetInterval;
      globalThis.clearInterval = savedClearInterval;
    }

    globalThis.fetch = async () => ({ ok: false });
    await assert.rejects(() => TOEICQuiz.prototype.loadQuestions.call(state), /could not be loaded/);
    globalThis.fetch = async () => ({ ok: true, json: async () => { throw new SyntaxError(); } });
    await assert.rejects(() => TOEICQuiz.prototype.loadQuestions.call(state), /could not be read/);
  } finally {
    globalThis.fetch = savedFetch;
  }

  const counts = ['basic', 'intermediate', 'advanced'].map(difficulty =>
    `${difficulty}: ${bank.filter(question => question.review === 'eligible' && question.difficulty === difficulty).length}`);
  console.log(`Questions: ${bank.length}. Eligible ${counts.join(', ')}. Excluded: ${bank.filter(question => question.review === 'excluded').length}.`);
  console.log(`Passed: ${revisedPositions.size} revised entries, ${bank.length - revisedPositions.size} preserved entries, category counts, unique stems, ${newVocabulary.length} distinct vocabulary targets, 100 selections, exact pool limits, exclusions, choice shuffling, scoring, answer key matching, start, answer selection and load errors.`);
  console.log(`Passed: ${activeQuestions.length} active learning notes, notes for every revised entry, question and answer cards, note matching, no early results, manual submission, canceled submission, timeout submission, answer locking, fixed completion times, six time zone cases and missing notes.`);
  console.log('Passed: mobile solutions below matching questions, desktop solution column, resizing across 768 pixels, open notes preserved and no duplicate solutions.');
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
