import { useCallback, useEffect, useRef, useState } from 'react';
import './App.css';
import { loadSurvivalQuestions, loadTriviaQuestions, NoQuestionsError, TriviaApiError, TRIVIA_CATEGORIES, type TriviaDifficulty, type TriviaQuestion } from './data/triviaApi';
import { translateQuestion, type TranslatedQuestion, type TranslationLanguage } from './data/translateTrivia';
import BrandHero from './BrandHero';
import { messages, type Language, type MessageKey } from './messages';

type Theme = 'light' | 'dark';
type GameMode = 'classic' | 'blitz' | 'survival';
type Phase = 'home' | 'playing' | 'results';

const categoryTranslations: Record<string, Record<'fi' | 'ru', string>> = {
  general_knowledge: { fi: 'Yleistieto', ru: 'Общие знания' },
  arts_and_literature: { fi: 'Taide ja kirjallisuus', ru: 'Искусство и литература' },
  film_and_tv: { fi: 'Elokuvat ja televisio', ru: 'Кино и телевидение' },
  food_and_drink: { fi: 'Ruoka ja juoma', ru: 'Еда и напитки' },
  geography: { fi: 'Maantieto', ru: 'География' },
  history: { fi: 'Historia', ru: 'История' },
  music: { fi: 'Musiikki', ru: 'Музыка' },
  science: { fi: 'Tiede', ru: 'Наука' },
  society_and_culture: { fi: 'Yhteiskunta ja kulttuuri', ru: 'Общество и культура' },
  sport_and_leisure: { fi: 'Urheilu ja vapaa-aika', ru: 'Спорт и досуг' },
};



type HeroTextKey = 'tagline' | 'intro' | 'sourceNote' | 'classicDescription' | 'blitzDescription' | 'survivalDescription';

const languages: Language[] = ['fi', 'en', 'ru'];
const modeDescriptionKeys: HeroTextKey[] = ['classicDescription', 'blitzDescription', 'survivalDescription'];

function StableHeroText({ language, text, reserve = [text], className, live = false, inline = false }: {
  language: Language;
  text: HeroTextKey;
  reserve?: HeroTextKey[];
  className: string;
  live?: boolean;
  inline?: boolean;
}) {
  const Element = inline ? 'span' : 'p';
  return (
    <Element className={`localized-copy ${className}`} aria-live={live ? 'polite' : undefined}>
      {reserve.flatMap((key) => languages.map((lang) => (
        <span className="copy-measure" aria-hidden="true" key={`${key}-${lang}`}>{messages[lang][key]}</span>
      )))}
      <span>{messages[language][text]}</span>
    </Element>
  );
}

const modeDetails: Record<GameMode, { icon: string; seconds: number | null }> = {
  classic: { icon: '✳', seconds: null },
  blitz: { icon: '↯', seconds: 12 },
  survival: { icon: '◇', seconds: 15 },
};

const modeOrder: GameMode[] = ['classic', 'blitz', 'survival'];

function getLanguage(): Language {
  const savedLanguage = window.localStorage.getItem('knowdium.language');
  if (savedLanguage === 'fi' || savedLanguage === 'ru' || savedLanguage === 'en') {
    return savedLanguage;
  }
  const browserLanguage = window.navigator.language.split('-')[0].toLowerCase();
  if (browserLanguage === 'fi') return 'fi';
  if (browserLanguage === 'ru') return 'ru';
  return 'en';
}

function getTheme(): Theme {
  const savedTheme = window.localStorage.getItem('knowdium.theme');
  if (savedTheme === 'light' || savedTheme === 'dark') return savedTheme;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function getSavedBest(): number {
  const savedBest = Number(window.localStorage.getItem('knowdium.bestScore'));
  return Number.isFinite(savedBest) && savedBest > 0 ? savedBest : 0;
}

function App() {
  const [language, setLanguage] = useState<Language>(getLanguage);
  const [theme, setTheme] = useState<Theme>(getTheme);
  const [phase, setPhase] = useState<Phase>('home');
  const [mode, setMode] = useState<GameMode>('classic');
  const [classicTimeLimit, setClassicTimeLimit] = useState<number | null>(null);
  const [questionCount, setQuestionCount] = useState(10);
  const [categoryIds, setCategoryIds] = useState<string[] | null>(null);
  const [difficulty, setDifficulty] = useState<TriviaDifficulty | ''>('');
  const categories = TRIVIA_CATEGORIES;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [appsOpen, setAppsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const loginRef = useRef<HTMLDivElement>(null);
  const loginButtonRef = useRef<HTMLButtonElement>(null);
  const [appHintVisible, setAppHintVisible] = useState(false);
  const [gameHintVisible, setGameHintVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [gameQuestions, setGameQuestions] = useState<Awaited<ReturnType<typeof loadTriviaQuestions>>['questions']>([]);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [bestScore, setBestScore] = useState(getSavedBest);
  const [correctCount, setCorrectCount] = useState(0);
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [gameTimeLimit, setGameTimeLimit] = useState<number | null>(null);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [answerLocked, setAnswerLocked] = useState(false);
  const [answerPoints, setAnswerPoints] = useState(0);
  const questionCardRef = useRef<HTMLElement>(null);
  const [loadingCardMinHeight, setLoadingCardMinHeight] = useState(0);
  const [translationAttempt, setTranslationAttempt] = useState(0);
  const [translation, setTranslation] = useState<{
    question: typeof gameQuestions[number];
    language: 'fi' | 'ru';
    attempt: number;
    result?: TranslatedQuestion;
    failed?: boolean;
  } | null>(null);
  const translationBuffer = useRef(new Map<TriviaQuestion, {
    controller: AbortController;
    promise: Promise<TranslatedQuestion>;
  }>());

  const getBufferedTranslation = useCallback((question: TriviaQuestion, language: TranslationLanguage) => {
    const buffered = translationBuffer.current.get(question);
    if (buffered) return buffered.promise;

    const controller = new AbortController();
    const promise = translateQuestion(question, language, controller.signal).catch((error: unknown) => {
      if (translationBuffer.current.get(question)?.promise === promise) {
        translationBuffer.current.delete(question);
      }
      throw error;
    });
    translationBuffer.current.set(question, { controller, promise });
    return promise;
  }, []);

  const t = (key: MessageKey) => messages[language][key];
  const currentQuestion = gameQuestions[questionIndex];
  const currentTranslation = translation && translation.question === currentQuestion && translation.language === language &&
    translation.attempt === translationAttempt ? translation : null;
  const displayedQuestion = language === 'en' ? currentQuestion : currentTranslation?.result;

  const rememberQuestionCardHeight = useCallback(() => {
    if (questionCardRef.current) {
      setLoadingCardMinHeight(questionCardRef.current.getBoundingClientRect().height);
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dataset.theme = theme;
  }, [language, theme]);

  useEffect(() => {
    const preference = window.matchMedia('(prefers-color-scheme: dark)');
    const followDeviceTheme = (event: MediaQueryListEvent) => {
      const savedTheme = window.localStorage.getItem('knowdium.theme');
      if (savedTheme !== 'light' && savedTheme !== 'dark') {
        setTheme(event.matches ? 'dark' : 'light');
      }
    };
    preference.addEventListener('change', followDeviceTheme);
    return () => preference.removeEventListener('change', followDeviceTheme);
  }, []);

  useEffect(() => {
    const buffer = translationBuffer.current;
    return () => {
      for (const entry of buffer.values()) entry.controller.abort();
      buffer.clear();
    };
  }, [gameQuestions, language, phase]);

  useEffect(() => {
    if (phase !== 'playing' || !currentQuestion || language === 'en') return;
    let active = true;
    getBufferedTranslation(currentQuestion, language)
      .then((result) => {
        if (active) {
          setTranslation({ question: currentQuestion, language, attempt: translationAttempt, result });
        }
      })
      .catch(() => {
        if (active) {
          setTranslation({ question: currentQuestion, language, attempt: translationAttempt, failed: true });
        }
      });
    return () => { active = false; };
  }, [currentQuestion, getBufferedTranslation, language, phase, translationAttempt]);

  useEffect(() => {
    const nextQuestion = gameQuestions[questionIndex + 1];
    if (phase !== 'playing' || language === 'en' || !currentTranslation?.result || !nextQuestion) return;
    void getBufferedTranslation(nextQuestion, language).catch((error: unknown) => {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        console.warn('Could not prepare the next translation:', error);
      }
    });
  }, [currentTranslation, gameQuestions, getBufferedTranslation, language, phase, questionIndex]);

  useEffect(() => {
    const showHint = () => {
      if (appsOpen) return;
      setAppHintVisible(true);
      window.setTimeout(() => setAppHintVisible(false), 3500);
    };
    const interval = window.setInterval(showHint, 12000);
    const initialHint = window.setTimeout(showHint, 1800);
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(initialHint);
    };
  }, [appsOpen]);

  useEffect(() => {
    function closeOverlays(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setSettingsOpen(false);
        setInfoOpen(false);
        setAppsOpen(false);
        setMenuOpen(false);
      }
    }
    window.addEventListener('keydown', closeOverlays);
    return () => window.removeEventListener('keydown', closeOverlays);
  }, []);

  useEffect(() => {
    if (!loginOpen) return;

    function closeOnOutsideClick(event: PointerEvent) {
      if (event.target instanceof Node && !loginRef.current?.contains(event.target)) {
        setLoginOpen(false);
      }
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setLoginOpen(false);
        loginButtonRef.current?.focus();
      }
    }

    document.addEventListener('pointerdown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [loginOpen]);

  async function startGame() {
    setError('');
    setLoading(true);
    try {
      const options = {
        amount: questionCount,
        categories: categoryIds ?? undefined,
      };
      const result = mode === 'survival'
        ? await loadSurvivalQuestions(options)
        : await loadTriviaQuestions({ ...options, difficulty: difficulty || undefined });
      setGameQuestions(result.questions);
      setQuestionIndex(0);
      setScore(0);
      setCorrectCount(0);
      setStreak(0);
      setBestStreak(0);
      setSelectedAnswer(null);
      setGameHintVisible(false);
      setAnswerLocked(false);
      setAnswerPoints(0);
      setLoadingCardMinHeight(0);
      const timeLimit = mode === 'classic' ? classicTimeLimit : modeDetails[mode].seconds;
      setGameTimeLimit(timeLimit);
      setTimeLeft(timeLimit);
      setPhase('playing');
      setSettingsOpen(false);
      setAppsOpen(false);
      setMenuOpen(false);
    } catch (reason) {
      if (reason instanceof Error) {
        if (reason instanceof NoQuestionsError) setError(t(mode === 'survival' ? 'survivalNoQuestions' : 'noQuestions'));
        else if (reason instanceof TriviaApiError) {
          if (reason.status === 429) setError(t('rateLimited'));
          else if (reason.status === 400) setError(t('apiInvalid'));
          else setError(t('apiUnavailable'));
        } else setError(t('apiUnavailable'));
      } else {
        setError(t('apiUnavailable'));
      }
    } finally {
      setLoading(false);
    }
  }

  const submitAnswer = useCallback((answer: string | null) => {
    if (answerLocked || !currentQuestion) return;
    setAnswerLocked(true);
    setSelectedAnswer(answer);
    const isCorrect = answer === currentQuestion.correctAnswer;
    let updatedStreak = 0;
    if (isCorrect) {
      updatedStreak = streak + 1;
      const difficultyBonus = currentQuestion.difficulty === 'hard' ? 300 : currentQuestion.difficulty === 'medium' ? 200 : 100;
      const speedBonus = timeLeft === null ? 0 : Math.max(0, timeLeft) * 10;
      const streakBonus = Math.min(streak * 25, 100);
      const points = difficultyBonus + speedBonus + streakBonus;
      const updatedScore = score + points;
      setAnswerPoints(points);
      setScore(updatedScore);
      setCorrectCount((count) => count + 1);
      setStreak(updatedStreak);
      setBestStreak((best) => Math.max(best, updatedStreak));
      if (updatedScore > bestScore) {
        setBestScore(updatedScore);
        window.localStorage.setItem('knowdium.bestScore', String(updatedScore));
      }
    } else {
      setAnswerPoints(0);
      setStreak(0);
    }

    const roundOver = questionIndex + 1 >= gameQuestions.length;
    const survivalOver = mode === 'survival' && !isCorrect;
    window.setTimeout(() => {
      if (roundOver || survivalOver) {
        setPhase('results');
        setAnswerLocked(false);
        return;
      }
      rememberQuestionCardHeight();
      setQuestionIndex((index) => index + 1);
      setGameHintVisible(false);
      setSelectedAnswer(null);
      setAnswerLocked(false);
      setTimeLeft(gameTimeLimit);
    }, 850);
  }, [answerLocked, bestScore, currentQuestion, gameQuestions.length, gameTimeLimit, mode, questionIndex, rememberQuestionCardHeight, score, streak, timeLeft]);

  useEffect(() => {
    if (phase !== 'playing' || answerLocked || !displayedQuestion || timeLeft === null) return;
    if (timeLeft <= 0) {
      const timeout = window.setTimeout(() => submitAnswer(null), 0);
      return () => window.clearTimeout(timeout);
    }
    const timeout = window.setTimeout(() => setTimeLeft((remaining) => remaining === null ? null : remaining - 1), 1000);
    return () => window.clearTimeout(timeout);
  }, [answerLocked, displayedQuestion, phase, submitAnswer, timeLeft]);

  function returnHome() {
    setPhase('home');
    setError('');
    setSelectedAnswer(null);
    setGameHintVisible(false);
    setAnswerLocked(false);
  }

  const infoDialog = infoOpen && (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) setInfoOpen(false);
    }}>
      <section className="dialog-card info-dialog" role="dialog" aria-modal="true" aria-labelledby="info-title">
        <button className="dialog-close" type="button" aria-label={t('close')} onClick={() => setInfoOpen(false)}>×</button>
        <span className="eyebrow">{t('openInfo')}</span>
        <h2 id="info-title">{t('aboutTitle')}</h2>
        <p>{t('aboutBody')}</p>
        <div className="info-callout">
          <strong>{t('dataSource')}</strong>
          <p>{t('aboutApi')}</p>
          <a href="https://the-trivia-api.com/docs/" target="_blank" rel="noreferrer">the-trivia-api.com ↗</a>
        </div>
        <p className="license-note">{t('aboutAttribution')}</p>
      </section>
    </div>
  );

  const settingsDialog = settingsOpen && (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) setSettingsOpen(false);
    }}>
      <section className="dialog-card settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <button className="dialog-close" type="button" aria-label={t('close')} onClick={() => setSettingsOpen(false)}>×</button>
        <span className="eyebrow">{t('gameSettings')}</span>
        <h2 id="settings-title">{t('settings')}</h2>
        <div className="settings-grid">
          <div className="category-setting">
            <div className="category-setting-heading">
              <span>{t('category')}</span>
              <span>{categoryIds === null ? t('allCategories') : `${categoryIds.length} ${t('selectedCategories')}`}</span>
            </div>
            <div className="category-picker" role="group" aria-label={t('category')}>
              <button
                className={`category-option${categoryIds === null ? ' is-selected' : ''}`}
                type="button"
                aria-pressed={categoryIds === null}
                onClick={() => setCategoryIds(null)}
              >
                {t('allCategories')}
              </button>
              {categories.map((category) => {
                const selected = categoryIds?.includes(category.id) ?? false;
                return (
                  <button
                    className={`category-option${selected ? ' is-selected' : ''}`}
                    type="button"
                    aria-pressed={selected}
                    key={category.id}
                    onClick={() => setCategoryIds((current) => {
                      if (current === null) return [category.id];
                      const next = current.includes(category.id)
                        ? current.filter((id) => id !== category.id)
                        : [...current, category.id];
                      return next.length ? next : null;
                    })}
                  >
                    {language === 'en' ? category.name : categoryTranslations[category.id][language]}
                  </button>
                );
              })}
            </div>
            <small className="category-setting-help">{t('categorySelectionHelp')}</small>
          </div>
          <label className="setting-field">
            <span>{t('difficulty')}</span>
            <select value={mode === 'survival' ? '' : difficulty} disabled={mode === 'survival'} onChange={(event) => {
              const value = event.target.value;
              setDifficulty(value === 'easy' || value === 'medium' || value === 'hard' ? value : '');
            }}>
              <option value="">{t(mode === 'survival' ? 'progressiveDifficulty' : 'anyDifficulty')}</option>
              <option value="easy">{t('easy')}</option>
              <option value="medium">{t('medium')}</option>
              <option value="hard">{t('hard')}</option>
            </select>
          </label>
          <label className="setting-field">
            <span>{t('questionCount')}</span>
            <select value={questionCount} onChange={(event) => setQuestionCount(Number(event.target.value))}>
              {[5, 10, 15, 20, 50].map((count) => <option value={count} key={count}>{count}</option>)}
            </select>
          </label>
          {mode === 'classic' && (
            <label className="setting-field">
              <span>{t('classicTimeLimit')}</span>
              <select value={classicTimeLimit ?? ''} onChange={(event) => setClassicTimeLimit(event.target.value === '' ? null : Number(event.target.value))}>
                <option value="">{t('noTimeLimit')}</option>
                {[10, 15, 20, 30, 60, 120].map((seconds) => <option value={seconds} key={seconds}>{seconds} {t('seconds')}</option>)}
              </select>
              {phase === 'playing' && <small>{t('nextGameSetting')}</small>}
            </label>
          )}
        </div>
        {error && <p className="error-message" role="alert">{error}</p>}
        <button className="primary-button dialog-action" type="button" onClick={() => setSettingsOpen(false)}>{t('saveSettings')}</button>
      </section>
    </div>
  );

  return (
    <div className="page-shell">
      {appsOpen && <button className="app-backdrop" type="button" aria-label={t('closeApps')} onClick={() => setAppsOpen(false)} />}
      <div className="content-shell">
        <header className="topbar">
          <div className="brand-heading">
            <button
              className="app-switcher-toggle"
              type="button"
              aria-label={appsOpen ? t('closeApps') : t('openApps')}
              aria-expanded={appsOpen}
              aria-controls="app-switcher-menu"
              onClick={() => {
                setAppsOpen((open) => !open);
                setMenuOpen(false);
                setLoginOpen(false);
                setAppHintVisible(false);
              }}
            >
              <img className="brand-mark" src={`${import.meta.env.BASE_URL}knowdium-logo.svg`} alt="" />
            </button>
            {appHintVisible && !appsOpen && (
              <span className="app-switcher-hint" aria-hidden="true">
                <svg viewBox="0 0 16 16"><path d="m4 10 4-4 4 4" /></svg>
                <span>{t('tryApps')}</span>
              </span>
            )}
            <div className="brand-copy">
              <a className="brand-name" href="#" onClick={(event) => { event.preventDefault(); returnHome(); }}>knowdium!</a>
              <StableHeroText language={language} text="tagline" className="brand-tagline" inline />
            </div>
            {appsOpen && (
              <nav className="app-switcher-menu" id="app-switcher-menu" aria-label={t('apps')}>
                <a className="app-switcher-item" href="https://hiltunenjuho.github.io/">
                  <img className="switcher-symbol" src={`${import.meta.env.BASE_URL}portfolio-logo.svg`} alt="" /><span className="switcher-name-portfolio">{t('portfolio')}</span><span className="external-arrow">↗</span>
                </a>
                <a className="app-switcher-item" href="https://hiltunenjuho.github.io/nearest-pharmacy-web/">
                  <img className="switcher-symbol" src={`${import.meta.env.BASE_URL}pharmacy-logo.svg`} alt="" /><span>{t('pharmacy')}</span><span className="external-arrow">↗</span>
                </a>
                <a className="app-switcher-item is-current" href="https://hiltunenjuho.github.io/knowdium/" aria-current="page">
                  <img className="switcher-symbol" src={`${import.meta.env.BASE_URL}knowdium-logo.svg`} alt="" /><span className="switcher-name-knowdium">knowdium!</span><span className="current-dot" />
                </a>
              </nav>
            )}
          </div>
          <div className="topbar-tools">
            <button className="icon-button info-button" type="button" aria-label={t('openInfo')} onClick={() => setInfoOpen(true)}>
              <span aria-hidden="true">i</span>
            </button>
            <div className="login-wrap" ref={loginRef}>
              <button
                ref={loginButtonRef}
                className="login-button"
                type="button"
                aria-expanded={loginOpen}
                aria-controls="login-panel"
                onClick={() => {
                  setLoginOpen((open) => !open);
                  setAppsOpen(false);
                  setMenuOpen(false);
                }}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0" /></svg>
                <span>{t('login')}</span>
              </button>
              {loginOpen && (
                <section className="login-panel" id="login-panel" aria-label={t('login')}>
                  <strong>{t('login')}</strong>
                  <p role="status">{t('accountsSoon')}</p>
                </section>
              )}
            </div>
            <div className="header-controls">
              <div className="language-toggle" role="group" aria-label={t('language')}>
                {(['fi', 'en', 'ru'] as const).map((value) => (
                  <button type="button" key={value} aria-pressed={language === value} onClick={() => {
                    if (value !== language) rememberQuestionCardHeight();
                    window.localStorage.setItem('knowdium.language', value);
                    setLanguage(value);
                  }}>{value.toUpperCase()}</button>
                ))}
              </div>
              <button
                className="theme-toggle"
                type="button"
                role="switch"
                aria-checked={theme === 'dark'}
                aria-label={t('theme')}
                onClick={() => {
                  const nextTheme = theme === 'dark' ? 'light' : 'dark';
                  window.localStorage.setItem('knowdium.theme', nextTheme);
                  setTheme(nextTheme);
                }}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  {theme === 'dark'
                    ? <path d="M20.2 15.1A8.5 8.5 0 0 1 8.9 3.8 8.5 8.5 0 1 0 20.2 15.1Z" />
                    : <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" /></>}
                </svg>
              </button>
            </div>
            <div className="quick-menu-wrap">
              <button
                className="icon-button menu-button"
                type="button"
                aria-label={menuOpen ? t('closeMenu') : t('menu')}
                aria-expanded={menuOpen}
                aria-controls="quick-menu"
                onClick={() => { setMenuOpen((open) => !open); setAppsOpen(false); setLoginOpen(false); }}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d={menuOpen ? 'm6 6 12 12M18 6 6 18' : 'M4 7h16M4 12h16M4 17h16'} /></svg>
              </button>
              {menuOpen && (
                <nav className="quick-menu" id="quick-menu" aria-label={t('quickLinks')}>
                  <button type="button" onClick={() => { setInfoOpen(true); setMenuOpen(false); }}>{t('howToPlay')}</button>
                  <button type="button" onClick={() => { setSettingsOpen(true); setMenuOpen(false); }}>{t('gameSettings')}</button>
                  <a href="https://the-trivia-api.com/docs/" target="_blank" rel="noreferrer">{t('dataSource')} ↗</a>
                </nav>
              )}
            </div>
          </div>
        </header>

        {phase === 'home' && (
          <main>
            <section className="hero">
              <div className="hero-orbit orbit-one" aria-hidden="true" />
              <div className="hero-orbit orbit-two" aria-hidden="true" />
              <div className="hero-copy">
                <span className="hero-kicker"><span className="sparkle">✳</span>{t('kicker')}</span>
                <h1><span>{t('headline')}</span>{' '}<span className="headline-accent">{t('headlineAccent')}</span>{' '}<span>{t('headlineEnd')}</span></h1>
                <StableHeroText language={language} text="intro" className="hero-intro" />
                <section className="modes-section" aria-labelledby="modes-title">
                  <h2 id="modes-title">{t('chooseMode')}</h2>
                  <div className="mode-grid">
                    {modeOrder.map((gameMode) => (
                      <button
                        className={`mode-card mode-${gameMode}${mode === gameMode ? ' is-selected' : ''}`}
                        type="button"
                        key={gameMode}
                        disabled={loading}
                        aria-pressed={mode === gameMode}
                        aria-label={`${t(gameMode)}: ${t(`${gameMode}Description` as MessageKey)}`}
                        onClick={() => setMode(gameMode)}
                      >
                        <span className="mode-icon" aria-hidden="true">{modeDetails[gameMode].icon}</span>
                        <strong>{t(gameMode)}</strong>
                        {mode === gameMode && <span className="mode-check" aria-hidden="true">✓</span>}
                      </button>
                    ))}
                  </div>
                  <StableHeroText language={language} text={`${mode}Description`} reserve={modeDescriptionKeys} className="mode-description" live />
                </section>
                <div className="hero-actions">
                  <button className="primary-button start-button" type="button" onClick={startGame} disabled={loading}>
                    {loading ? <><span className="button-spinner" />{t('loading')}</> : <>{t('play')}<span aria-hidden="true">↗</span></>}
                  </button>
                  <button className="secondary-button" type="button" onClick={() => setSettingsOpen(true)} disabled={loading}>
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h9m4 0h3M4 17h3m4 0h9M13 4v6M7 14v6" /></svg>{t('settings')}
                  </button>
                </div>
                {error && <p className="error-message home-error" role="alert">{error}</p>}
                <StableHeroText language={language} text="sourceNote" className="api-note" />
                {language !== 'en' && <p className="translation-beta-note" role="note">{t('translationBetaNote')}</p>}
              </div>
              <div className="hero-art" aria-label="Knowdium, a trivia game">
                <span className="orbit-word orbit-word-one" aria-hidden="true">kd!</span>
                <div className="brand-stage" aria-hidden="true">
                  <BrandHero />
                </div>
                <span className="orbit-word orbit-word-two" aria-hidden="true">kd!</span>
                <span className="hero-sticker sticker-top">BRAIN<br />POWER</span>
                <span className="hero-sticker sticker-bottom">GOOD<br />QUESTION!</span>
                <span className="hero-sparkle sparkle-one">✳</span>
                <span className="hero-sparkle sparkle-two">✦</span>
                <span className="hero-sparkle sparkle-three">✧</span>
              </div>
              <div className="best-score-card">
                <span className="trophy-icon" aria-hidden="true">✦</span>
                <span className="best-score-copy"><small>{t('best')}</small><strong>{bestScore.toLocaleString()} <em>{t('bestPoints')}</em></strong></span>
                <span className="score-arrow" aria-hidden="true">↗</span>
              </div>
            </section>

          </main>
        )}

        {phase === 'playing' && currentQuestion && (
          <main className="game-main">
            <div className="game-topline">
              <button className="back-link" type="button" onClick={returnHome}>← {t('backHome')}</button>
              <span className="game-mode-label">{t(mode)} <span>·</span> {t('question')} {questionIndex + 1}/{gameQuestions.length}</span>
            </div>
            <div className="game-progress"><span style={{ width: `${((questionIndex + 1) / gameQuestions.length) * 100}%` }} /></div>
            <section
              className="question-card"
              ref={questionCardRef}
              style={!displayedQuestion && loadingCardMinHeight ? { minHeight: loadingCardMinHeight } : undefined}
            >
              {!displayedQuestion ? (
                <div className="translation-state" role={currentTranslation?.failed ? 'alert' : 'status'}>
                  {currentTranslation?.failed ? (
                    <>
                      <p>{t('translationUnavailable')}</p>
                      <button className="secondary-button" type="button" onClick={() => setTranslationAttempt((attempt) => attempt + 1)}>{t('retryTranslation')}</button>
                    </>
                  ) : (
                    <>
                      <span className="translation-orbit" aria-hidden="true"><span>✦</span></span>
                      <div className="translation-copy">
                        <strong>{t('translating')}</strong>
                        <p>{t('translationLoadingDetail')}</p>
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <>
              <div className="question-meta">
                <span className="category-pill">{displayedQuestion.category}</span>
                {timeLeft !== null && <span className={`timer-pill${timeLeft <= 5 ? ' timer-urgent' : ''}`}><span>◷</span>{timeLeft} {t('seconds')}</span>}
              </div>
              <div className="score-strip">
                <span><small>{t('points')}</small><strong>{score.toLocaleString()}</strong></span>
                <span><small>{t('streak')}</small><strong>{streak}<i>×</i></strong></span>
              </div>
              <span className="question-number">Q{String(questionIndex + 1).padStart(2, '0')}</span>
              <h1>{displayedQuestion.question}</h1>
              {mode === 'classic' && gameTimeLimit === null && displayedQuestion.hint && (
                <div className="game-hint">
                  {gameHintVisible ? (
                    <p><strong>✦ {t('hint')}:</strong> {displayedQuestion.hint}</p>
                  ) : (
                    <button className="hint-button" type="button" onClick={() => setGameHintVisible(true)}>
                      <span aria-hidden="true">✦</span> {t('showHint')}
                    </button>
                  )}
                </div>
              )}
              {language !== 'en' && (
                <details className="original-question">
                  <summary>{t('originalQuestion')}</summary>
                  <p lang="en">{currentQuestion.question}</p>
                </details>
              )}
              <div className="answer-grid">
                {currentQuestion.answers.map((answer, index) => {
                  const isCorrect = answerLocked && answer === currentQuestion.correctAnswer;
                  const isWrong = answerLocked && selectedAnswer === answer && answer !== currentQuestion.correctAnswer;
                  return (
                    <button
                      className={`answer-option${isCorrect ? ' is-correct' : ''}${isWrong ? ' is-wrong' : ''}`}
                      type="button"
                      key={`${questionIndex}-${answer}`}
                      disabled={answerLocked}
                      onClick={() => submitAnswer(answer)}
                    >
                      <span className="answer-letter">{String.fromCharCode(65 + index)}</span>{displayedQuestion.answers[index]}
                      {isCorrect && <span className="answer-result">✓</span>}
                      {isWrong && <span className="answer-result">×</span>}
                    </button>
                  );
                })}
              </div>
              <div className={`answer-feedback${answerLocked ? ' is-visible' : ''}`} aria-live="polite">
                {answerLocked && (selectedAnswer === currentQuestion.correctAnswer ? t('correct') : selectedAnswer === null ? t('timeUp') : t('incorrect'))}
                {answerLocked && <span>{selectedAnswer === currentQuestion.correctAnswer ? `+${answerPoints}` : ''}</span>}
              </div>
                </>
              )}
            </section>
          </main>
        )}

        {phase === 'results' && (
          <main className="results-main">
            <span className="result-confetti" aria-hidden="true">✳ ✦ ✧</span>
            <span className="eyebrow">{t('scoreLabel')}</span>
            <h1>{mode === 'survival' && correctCount < gameQuestions.length ? t('survivalTitle') : t('finishTitle')}</h1>
            <p>{mode === 'survival' && correctCount < gameQuestions.length ? t('survivalMessage') : t('finishMessage')}</p>
            <div className="final-score"><strong>{score.toLocaleString()}</strong><span>{t('points')}</span></div>
            <div className="result-stats">
              <div><small>{t('correctAnswers')}</small><strong>{correctCount}<i>/{questionIndex + 1}</i></strong></div>
              <div><small>{t('accuracy')}</small><strong>{Math.round((correctCount / Math.max(questionIndex + 1, 1)) * 100)}<i>%</i></strong></div>
              <div><small>{t('bestRun')}</small><strong>{bestStreak}<i>×</i></strong></div>
            </div>
            <div className="result-actions">
              <button className="primary-button" type="button" onClick={startGame} disabled={loading}>{loading ? t('loading') : t('playAgain')} <span aria-hidden="true">↗</span></button>
              <button className="secondary-button" type="button" onClick={returnHome} disabled={loading}>{t('backHome')}</button>
            </div>
            {error && <p className="error-message" role="alert">{error}</p>}
          </main>
        )}
      </div>

      <footer className="site-footer">
        <div className="footer-inner">
          <div className="footer-brand"><span className="footer-wordmark">knowdium<span>!</span></span><p>{t('footerTagline')}</p></div>
          <div className="footer-links">
            <span>{t('footerLinks')}</span>
            <a href="https://hiltunenjuho.github.io/" target="_blank" rel="noreferrer">{t('portfolio')}</a>
            <a href="https://hiltunenjuho.github.io/nearest-pharmacy-web/" target="_blank" rel="noreferrer">{t('pharmacy')}</a>
            <a href="https://github.com/hiltunenjuho" target="_blank" rel="noopener noreferrer">GitHub</a>
            <a href="https://www.linkedin.com/in/hiltunenjuho/" target="_blank" rel="noopener noreferrer">LinkedIn</a>
            <a href="https://the-trivia-api.com/docs/" target="_blank" rel="noreferrer">{t('dataSource')}</a>
          </div>
          <div className="footer-bottom">
            <span>© {new Date().getFullYear()} Juho Hiltunen</span>
            <span>Questions via <a href="https://the-trivia-api.com/" target="_blank" rel="noreferrer">The Trivia API</a></span>
            <a className="back-to-top" href="#top" onClick={(event) => { event.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>{t('backToTop')}</a>
          </div>
        </div>
      </footer>

      {settingsDialog}
      {infoDialog}
    </div>
  );
}

export default App;
