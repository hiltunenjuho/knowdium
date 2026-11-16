export interface TriviaCategory {
  id: string;
  name: string;
}

export interface TriviaQuestion {
  id: string;
  question: string;
  correctAnswer: string;
  answers: string[];
  category: string;
  difficulty: TriviaDifficulty;
  hint?: string;
}

export type TriviaDifficulty = 'easy' | 'medium' | 'hard';

export interface TriviaOptions {
  amount: number;
  categories?: string[];
  difficulty?: TriviaDifficulty;
}

export const TRIVIA_CATEGORIES: TriviaCategory[] = [
  { id: 'general_knowledge', name: 'General knowledge' },
  { id: 'arts_and_literature', name: 'Arts and literature' },
  { id: 'film_and_tv', name: 'Film and TV' },
  { id: 'food_and_drink', name: 'Food and drink' },
  { id: 'geography', name: 'Geography' },
  { id: 'history', name: 'History' },
  { id: 'music', name: 'Music' },
  { id: 'science', name: 'Science' },
  { id: 'society_and_culture', name: 'Society and culture' },
  { id: 'sport_and_leisure', name: 'Sport and leisure' },
];

export class TriviaApiError extends Error {
  status: number;

  constructor(status: number) {
    super(`The Trivia API returned HTTP ${status}`);
    this.name = 'TriviaApiError';
    this.status = status;
  }
}

export class NoQuestionsError extends Error {
  constructor() {
    super('The Trivia API returned too few non-niche questions for this selection');
    this.name = 'NoQuestionsError';
  }
}

interface ApiQuestion {
  id: string;
  category: string;
  difficulty: TriviaDifficulty;
  question: { text: string };
  correctAnswer: string;
  incorrectAnswers: string[];
  isNiche: boolean;
  hint?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isApiQuestion(value: unknown): value is ApiQuestion {
  if (!isRecord(value) || !isRecord(value.question)) return false;
  return typeof value.id === 'string' &&
    typeof value.category === 'string' &&
    (value.difficulty === 'easy' || value.difficulty === 'medium' || value.difficulty === 'hard') &&
    typeof value.question.text === 'string' &&
    typeof value.correctAnswer === 'string' &&
    Array.isArray(value.incorrectAnswers) &&
    value.incorrectAnswers.every((answer) => typeof answer === 'string') &&
    typeof value.isNiche === 'boolean' &&
    (value.hint === undefined || typeof value.hint === 'string');
}

const API_BASE = 'https://the-trivia-api.com/v2/questions';
const MAX_QUESTIONS_PER_REQUEST = 50;

function shuffle<T>(items: T[]): T[] {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
  }
  return items;
}

async function requestQuestions(options: TriviaOptions & { limit: number }): Promise<TriviaQuestion[]> {
  const params = new URLSearchParams({
    limit: String(options.limit),
    contentFilter: 'family',
  });
  if (options.categories?.length) params.set('categories', options.categories.join(','));
  if (options.difficulty) params.set('difficulties', options.difficulty);

  const response = await fetch(`${API_BASE}?${params}`);
  if (!response.ok) throw new TriviaApiError(response.status);
  const data: unknown = await response.json();
  if (!Array.isArray(data) || !data.every(isApiQuestion)) {
    throw new Error('The Trivia API returned an invalid question list');
  }

  return data
    .filter((question) => !question.isNiche)
    .map((question) => ({
      id: question.id,
      question: question.question.text,
      correctAnswer: question.correctAnswer,
      answers: shuffle([...question.incorrectAnswers, question.correctAnswer]),
      category: question.category.replaceAll('_', ' '),
      difficulty: question.difficulty,
      ...(question.hint?.trim() ? { hint: question.hint } : {}),
    }));
}

function selectQuestions(questions: TriviaQuestion[], amount: number): TriviaQuestion[] {
  if (questions.length < amount) throw new NoQuestionsError();
  return shuffle(questions).slice(0, amount);
}

export async function loadTriviaQuestions(options: TriviaOptions): Promise<{ questions: TriviaQuestion[] }> {
  if (!Number.isInteger(options.amount) || options.amount < 1 || options.amount > MAX_QUESTIONS_PER_REQUEST) {
    throw new RangeError('Question count must be between 1 and 50');
  }

  const questions = await requestQuestions({ ...options, limit: MAX_QUESTIONS_PER_REQUEST });
  if (options.difficulty) {
    return { questions: selectQuestions(questions.filter((question) => question.difficulty === options.difficulty), options.amount) };
  }
  return { questions: selectQuestions(questions, options.amount) };
}

export async function loadSurvivalQuestions(options: TriviaOptions): Promise<{ questions: TriviaQuestion[] }> {
  if (!Number.isInteger(options.amount) || options.amount < 1 || options.amount > MAX_QUESTIONS_PER_REQUEST) {
    throw new RangeError('Survival question count must be between 1 and 50');
  }

  const difficulties = ['easy', 'medium', 'hard'] as const;
  const counts = difficulties.map((_, index) =>
    Math.floor(options.amount / difficulties.length) + (index < options.amount % difficulties.length ? 1 : 0),
  );
  const batches = await Promise.all(difficulties.map((difficulty, index) =>
    counts[index] === 0
      ? Promise.resolve([])
      : requestQuestions({ ...options, difficulty, limit: MAX_QUESTIONS_PER_REQUEST }),
  ));
  const questions = batches.flatMap((batch, index) =>
    selectQuestions(batch.filter((question) => question.difficulty === difficulties[index]), counts[index]),
  );
  return { questions };
}
