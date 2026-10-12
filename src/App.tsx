import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AudioLines,
  ArrowDownToLine,
  ArrowUpRight,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  Clock3,
  Cpu,
  Disc3,
  Download,
  FileAudio,
  FolderHeart,
  Headphones,
  Library,
  LoaderCircle,
  Music2,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Search,
  Settings2,
  ShieldCheck,
  SkipBack,
  SkipForward,
  Sparkles,
  Square,
  Volume2,
  WandSparkles,
  X,
} from 'lucide-react';
import { api, native } from './api';
import type { Draft, Engine, Operation, Song } from './types';
import { bytes, duration, initialDraft, readDraft, validate } from './utils';

type View = 'create' | 'library' | 'engine';
const presets = [
  [
    'Synth-pop',
    'Dreamy synth-pop, warm female vocal, analog synthesizers, driving bassline, English, 100 BPM',
  ],
  [
    'Indie folk',
    'Intimate indie folk, warm male vocal, fingerpicked acoustic guitar, gentle percussion, English',
  ],
  [
    'R&B',
    'Smooth contemporary R&B, soulful female vocal, warm Rhodes, deep bass, restrained drums, English',
  ],
  [
    'Rock',
    'Anthemic alternative rock, expressive male vocal, electric guitars, live drums, English',
  ],
  ['Jazz', 'Late-night jazz, intimate female vocal, upright bass, brushed drums, piano, English'],
  [
    'Cinematic',
    'Cinematic orchestral pop, soaring vocal, strings, piano, spacious percussion, English',
  ],
];
function Wave({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 96 50" fill="none" aria-hidden="true">
      <path
        d="M1 25h13l8-17 12 37L47 3l13 38 11-25 8 9h16"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function Elapsed({ started }: { started: number }) {
  const [tick, setTick] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return <span>{duration(Math.max(0, tick / 1000 - started))}</span>;
}

export default function App() {
  const [view, setView] = useState<View>('create');
  const [draft, setDraft] = useState<Draft>(readDraft);
  const [engine, setEngine] = useState<Engine | null>(null);
  const [songs, setSongs] = useState<Song[]>([]);
  const [operation, setOperation] = useState<Operation | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [help, setHelp] = useState(false);
  const latestRefresh = useRef(0);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const guide = useRef<HTMLElement>(null);
  const guideTrigger = useRef<HTMLButtonElement>(null);
  const active = operation?.status === 'running';
  const current = songs.find((song) => song.id === selected) || null;
  const refresh = useCallback(async () => {
    const seq = ++latestRefresh.current;
    try {
      const [nextEngine, nextSongs] = await Promise.all([api.engine(), api.songs()]);
      if (seq !== latestRefresh.current) return;
      setEngine(nextEngine);
      setSongs(nextSongs);
      setOperation(nextEngine.operation);
      setSelected(
        (previous) => previous || nextSongs.find((song) => song.status === 'complete')?.id || null,
      );
    } catch (e) {
      setError(String(e));
    }
  }, []);
  useEffect(() => {
    void refresh();
    let disposed = false;
    let stop = () => {};
    void api
      .subscribe(
        (value) => {
          setOperation(value);
        },
        () => void refresh(),
      )
      .then((unsubscribe) => {
        if (disposed) unsubscribe();
        else stop = unsubscribe;
      })
      .catch((e) => setError(String(e)));
    return () => {
      disposed = true;
      stop();
      latestRefresh.current++;
    };
  }, [refresh]);
  useEffect(() => {
    try {
      localStorage.setItem('maestro:draft:v1', JSON.stringify(draft));
    } catch {
      setError('Your draft could not be saved on this computer. Keep a copy of your lyrics.');
    }
  }, [draft]);
  useEffect(() => {
    if (!toast) return;
    const timeout = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timeout);
  }, [toast]);
  useEffect(() => {
    if (!help) return;
    function keyboard(event: KeyboardEvent) {
      if (event.key === 'Escape') setHelp(false);
      if (event.key !== 'Tab') return;
      const controls = guide.current?.querySelectorAll<HTMLElement>('button, a[href]');
      if (!controls?.length) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', keyboard);
    return () => {
      document.removeEventListener('keydown', keyboard);
      guideTrigger.current?.focus();
    };
  }, [help]);
  function change<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((previous) => ({ ...previous, [key]: value }));
  }
  async function action(work: () => Promise<unknown>) {
    setPending(true);
    setError(null);
    try {
      await work();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  }
  function create() {
    const problem = validate(draft);
    if (problem) {
      setError(problem);
      return;
    }
    void action(async () => {
      const id = await api.generate({ ...draft });
      setSelected(id);
    });
  }
  function insertSection(section: string) {
    const field = textarea.current;
    const start = field?.selectionStart ?? draft.lyrics.length;
    const end = field?.selectionEnd ?? start;
    const insert = `${start ? '\n\n' : ''}[${section}]\n`;
    change('lyrics', draft.lyrics.slice(0, start) + insert + draft.lyrics.slice(end));
    requestAnimationFrame(() => {
      field?.focus();
      field?.setSelectionRange(start + insert.length, start + insert.length);
    });
  }
  function load(song: Song) {
    setDraft({ ...song.request });
    setSelected(song.id);
    setView('create');
    setToast('Song settings loaded into the composer.');
  }
  const ready = engine?.installed;
  const runningSong = songs.find((song) => song.status === 'running');

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="studio-photo" />
        <a
          className="brand"
          href="#"
          onClick={(event) => {
            event.preventDefault();
            setView('create');
          }}
          aria-label="Music Maestro home"
        >
          <Wave />
          <div>
            <strong>Music Maestro</strong>
            <span>POWERED BY YuE2</span>
          </div>
        </a>
        <nav aria-label="Studio navigation">
          {(
            [
              ['create', WandSparkles, 'Create'],
              ['library', Library, 'Library'],
              ['engine', Cpu, 'Engine'],
            ] as const
          ).map(([id, Icon, label]) => (
            <button
              key={id}
              className={view === id ? 'nav-item selected' : 'nav-item'}
              onClick={() => setView(id)}
              aria-label={label}
              aria-current={view === id ? 'page' : undefined}
            >
              <Icon size={20} />
              <span>{label}</span>
              {id === 'library' && songs.length > 0 && <small>{songs.length}</small>}
              {id === 'engine' && <i className={ready ? 'status-dot ready' : 'status-dot'} />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="private-note">
            <ShieldCheck size={16} />
            <span>Made here. Kept here.</span>
          </div>
          <button ref={guideTrigger} className="help-button" onClick={() => setHelp(true)}>
            <CircleHelp size={16} /> Studio guide <ArrowUpRight size={13} />
          </button>
          <span className="version">MUSIC MAESTRO · 0.1.0</span>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            Your studio <span>/</span>
            <strong>
              {view === 'create'
                ? 'Create a song'
                : view === 'library'
                  ? 'Song library'
                  : 'Music engine'}
            </strong>
          </div>
          <button className="engine-pill" onClick={() => setView('engine')}>
            <i className={ready ? 'status-dot ready' : 'status-dot'} />
            {active ? 'Engine working' : ready ? 'YuE2 ready' : 'Set up your engine'}
            <ChevronDown size={13} />
          </button>
        </header>
        <main className={view === 'create' ? 'content composer-content' : 'content'}>
          {error && (
            <div className="error-banner" role="alert">
              <CircleHelp size={18} />
              <span>{error}</span>
              <button onClick={() => setError(null)} aria-label="Dismiss error">
                <X size={16} />
              </button>
            </div>
          )}
          {view === 'create' && (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">A LITTLE IDEA. A WHOLE NEW SOUND.</span>
                  <h1>
                    Let’s make something <span>yours.</span>
                  </h1>
                  <p>Give your music a direction. YuE2 brings it to life.</p>
                </div>
                <button
                  className="text-button"
                  onClick={() => {
                    setDraft({ ...initialDraft, title: 'Untitled song', style: '', lyrics: '' });
                    setSelected(null);
                    setToast('A fresh canvas, ready for your next idea.');
                  }}
                >
                  <Plus size={15} /> New song
                </button>
              </div>
              <div className="workbench">
                <section className="composer-panel" aria-label="Song composer">
                  <div className="section-kicker">
                    <span>01</span> THE IDEA
                  </div>
                  <label className="field-label" htmlFor="song-title">
                    SONG TITLE
                  </label>
                  <input
                    id="song-title"
                    value={draft.title}
                    maxLength={100}
                    onChange={(event) => change('title', event.target.value)}
                    placeholder="Give this one a name"
                  />
                  <div className="label-row">
                    <label className="field-label" htmlFor="song-style">
                      THE SOUND
                    </label>
                    <span>Genre, instruments, voice & mood</span>
                  </div>
                  <div className="textarea-wrap style-wrap">
                    <textarea
                      id="song-style"
                      value={draft.style}
                      maxLength={1000}
                      onChange={(event) => change('style', event.target.value)}
                      placeholder="A late-night jazz ballad, warm vocals, brushed drums…"
                    />
                    <small>{draft.style.length}/1000</small>
                  </div>
                  <div className="presets" aria-label="Style presets">
                    {presets.map(([label, style]) => (
                      <button
                        key={label}
                        className={
                          draft.style.toLowerCase().includes(label.toLowerCase())
                            ? 'chip chosen'
                            : 'chip'
                        }
                        onClick={() => change('style', style)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <div className="lyrics-heading">
                    <div className="section-kicker">
                      <span>02</span> THE WORDS
                    </div>
                    <div className="section-inserts">
                      <button onClick={() => insertSection('Verse')} title="Insert a verse">
                        + Verse
                      </button>
                      <button onClick={() => insertSection('Chorus')} title="Insert a chorus">
                        + Chorus
                      </button>
                      <button onClick={() => insertSection('Bridge')} title="Insert a bridge">
                        + Bridge
                      </button>
                    </div>
                  </div>
                  <label className="sr-only" htmlFor="song-lyrics">
                    Lyrics
                  </label>
                  <div className="textarea-wrap lyrics-wrap">
                    <textarea
                      ref={textarea}
                      id="song-lyrics"
                      value={draft.lyrics}
                      maxLength={6000}
                      spellCheck={false}
                      onChange={(event) => change('lyrics', event.target.value)}
                      placeholder={
                        '[Verse]\nEvery song starts with a line…\n\n[Chorus]\nThe part they’ll sing again'
                      }
                    />
                    <div className="lyric-footer">
                      <span>Use [Verse] and [Chorus] to shape your song.</span>
                      <small>{draft.lyrics.length.toLocaleString()}/6000</small>
                    </div>
                  </div>
                </section>
                <aside className="inspector">
                  <EngineCard
                    engine={engine}
                    operation={operation}
                    pending={pending}
                    setup={() => void action(api.setup)}
                    details={() => setView('engine')}
                  />
                  <section className="inspector-section settings-section">
                    <div className="section-kicker">
                      <span>03</span> THE ARRANGEMENT
                    </div>
                    <label className="field-label" htmlFor="song-planning">
                      SONG PLANNING
                    </label>
                    <div className="select-wrap">
                      <Music2 size={15} />
                      <select
                        id="song-planning"
                        value={draft.cot}
                        onChange={(event) => change('cot', event.target.value as Draft['cot'])}
                      >
                        <option value="full">Melody + chords</option>
                        <option value="melody">Melody only</option>
                        <option value="off">Direct generation</option>
                      </select>
                      <ChevronDown size={14} />
                    </div>
                    <p className="control-help">
                      {draft.cot === 'full'
                        ? 'YuE2 composes a score before performing your song.'
                        : draft.cot === 'melody'
                          ? 'Plan the melody and let the accompaniment find its way.'
                          : 'Generate straight from your style and lyrics.'}
                    </p>
                    <label className="field-label" htmlFor="song-length">
                      GENERATION BUDGET
                    </label>
                    <div className="budget-buttons">
                      {(['sketch', 'standard', 'extended'] as const).map((length) => (
                        <button
                          key={length}
                          onClick={() => change('length', length)}
                          className={draft.length === length ? 'selected' : ''}
                        >
                          {length === 'sketch'
                            ? 'Sketch'
                            : length === 'standard'
                              ? 'Song'
                              : 'Longer'}
                        </button>
                      ))}
                    </div>
                    <p className="control-help">
                      {draft.length === 'sketch'
                        ? 'A short idea to explore the sound.'
                        : draft.length === 'standard'
                          ? 'A balanced starting point for the 16 GB preset.'
                          : 'More room for longer lyrics. Takes more time.'}{' '}
                      Length follows the composition; a limit may produce partial audio.
                    </p>
                    <button
                      className="advanced-toggle"
                      aria-expanded={advanced}
                      onClick={() => setAdvanced(!advanced)}
                    >
                      <Settings2 size={14} /> Advanced{' '}
                      <ChevronDown size={14} className={advanced ? 'rotated' : ''} />
                    </button>
                    {advanced && (
                      <div className="advanced-settings">
                        <label className="field-label" htmlFor="song-seed">
                          SEED
                        </label>
                        <div className="seed-row">
                          <input
                            id="song-seed"
                            type="number"
                            min={0}
                            max={Number.MAX_SAFE_INTEGER}
                            value={draft.seed}
                            onChange={(event) => change('seed', Number(event.target.value))}
                          />
                          <button
                            className="icon-button"
                            aria-label="Randomize seed"
                            onClick={() => change('seed', Math.floor(Math.random() * 2147483647))}
                          >
                            <RotateCcw size={16} />
                          </button>
                        </div>
                        <p className="control-help">
                          Keep the seed to explore variations with the same starting point.
                        </p>
                      </div>
                    )}
                  </section>
                  <section className="preview-section">
                    <div className="label-row">
                      <span className="field-label">IN THE STUDIO</span>
                      {current?.status === 'complete' && (
                        <span className="tiny-tag">48 kHz · stereo</span>
                      )}
                    </div>
                    {current?.status === 'complete' ? (
                      <div className="song-preview">
                        <div className="artwork">
                          <Wave />
                        </div>
                        <h3>{current.request.title}</h3>
                        <p>
                          {duration(current.duration)} ·{' '}
                          {current.truncated ? 'Partial audio' : 'Generated locally'}
                        </p>
                        <button className="text-button" onClick={() => setView('library')}>
                          View in library <ArrowUpRight size={14} />
                        </button>
                      </div>
                    ) : (
                      <div className="empty-preview">
                        {runningSong ? (
                          <>
                            <AudioLines size={34} className="pulse" />
                            <h3>Your idea is taking shape.</h3>
                            <p>Listen here when your song is ready.</p>
                          </>
                        ) : (
                          <>
                            <Wave />
                            <h3>Your first song starts here.</h3>
                            <p>
                              A sound only you could have imagined.
                              <br />A song you can call your own.
                            </p>
                          </>
                        )}
                      </div>
                    )}
                  </section>
                </aside>
              </div>
            </>
          )}
          {view === 'library' && (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">MADE BY YOU, WITH YuE2</span>
                  <h1>
                    Your song <span>collection.</span>
                  </h1>
                  <p>Every idea, every take. Saved on this computer.</p>
                </div>
                <button className="primary-button compact" onClick={() => setView('create')}>
                  <Plus size={17} /> Create a song
                </button>
              </div>
              <div className="library-toolbar">
                <span>
                  {songs.length} {songs.length === 1 ? 'creation' : 'creations'}
                </span>
                <label className="search">
                  <Search size={16} />
                  <input
                    aria-label="Search songs"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Find a song…"
                  />
                </label>
              </div>
              {songs.length === 0 ? (
                <div className="library-empty">
                  <div className="empty-disc">
                    <Disc3 size={62} />
                  </div>
                  <span className="eyebrow">THE COLLECTION BEGINS WITH YOU</span>
                  <h2>Nothing here. Yet.</h2>
                  <p>Turn the melody in your head into something you can play.</p>
                  <button className="primary-button" onClick={() => setView('create')}>
                    <Sparkles size={18} /> Create your first song
                  </button>
                </div>
              ) : (
                <div className="song-list">
                  {songs
                    .filter((song) =>
                      `${song.request.title} ${song.request.style}`
                        .toLowerCase()
                        .includes(query.toLowerCase()),
                    )
                    .map((song) => (
                      <article
                        key={song.id}
                        className={selected === song.id ? 'song-row selected' : 'song-row'}
                      >
                        <button
                          className="small-artwork"
                          aria-label={`Select ${song.request.title}`}
                          disabled={song.status !== 'complete'}
                          onClick={() => setSelected(song.id)}
                        >
                          {song.status === 'running' ? (
                            <LoaderCircle className="spin" />
                          ) : (
                            <Music2 />
                          )}
                        </button>
                        <div className="song-row-info">
                          <h3>{song.request.title}</h3>
                          <p>{song.request.style}</p>
                          {song.error && <span className="row-error">{song.error}</span>}
                        </div>
                        <div className="song-meta">
                          <span className={`song-status ${song.status}`}>
                            {song.status === 'complete'
                              ? song.truncated
                                ? 'Partial audio'
                                : 'Ready'
                              : song.status}
                          </span>
                          <small>
                            {new Date(song.created * 1000).toLocaleDateString()} ·{' '}
                            {duration(song.duration)}
                          </small>
                        </div>
                        <button
                          className="icon-button"
                          title="Load song settings"
                          aria-label={`Load settings for ${song.request.title}`}
                          onClick={() => load(song)}
                        >
                          <RotateCcw size={17} />
                        </button>
                        {song.status === 'complete' && (
                          <button
                            className="icon-button"
                            title="Export FLAC"
                            aria-label={`Export ${song.request.title}`}
                            onClick={() =>
                              void action(async () => {
                                if (await api.export(song, 'flac'))
                                  setToast('Lossless FLAC exported.');
                              })
                            }
                          >
                            <ArrowDownToLine size={18} />
                          </button>
                        )}
                      </article>
                    ))}
                  {songs.length > 0 &&
                    !songs.some((song) =>
                      `${song.request.title} ${song.request.style}`
                        .toLowerCase()
                        .includes(query.toLowerCase()),
                    ) && <p className="no-results">No songs match “{query}”.</p>}
                </div>
              )}
            </>
          )}
          {view === 'engine' && (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">THE POWER BEHIND YOUR SOUND</span>
                  <h1>
                    A studio, <span>on your computer.</span>
                  </h1>
                  <p>Set up once. Your songs and your ideas stay with you.</p>
                </div>
                <span className="privacy-badge">
                  <ShieldCheck size={16} /> Local by design
                </span>
              </div>
              <div className="engine-layout">
                <section className="engine-main-card">
                  <div className="engine-hero">
                    <div className="engine-icon">
                      <Cpu size={34} />
                    </div>
                    <div>
                      <span className="eyebrow">OPEN MUSIC GENERATION</span>
                      <h2>YuE2-3B</h2>
                      <p>From lyrics and style to a complete musical performance.</p>
                    </div>
                    <span className={ready ? 'state-badge ready' : 'state-badge'}>
                      {ready ? <Check size={13} /> : <Download size={13} />}{' '}
                      {ready ? 'Installed' : 'Setup required'}
                    </span>
                  </div>
                  <div className="engine-features">
                    <span>
                      <Headphones size={16} /> 48 kHz stereo
                    </span>
                    <span>
                      <Music2 size={16} /> Editable score
                    </span>
                    <span>
                      <ShieldCheck size={16} /> Offline after setup
                    </span>
                  </div>
                  <div className="setup-steps">
                    {[
                      [
                        'Private Python runtime',
                        'No Python, terminal or developer tools required.',
                        engine?.runtimeReady,
                      ],
                      [
                        'YuE2 model + audio decoder',
                        `${bytes(engine?.totalBytes || 7.8e9)} of models, with resumable downloads.`,
                        engine?.modelsReady,
                      ],
                      [
                        'Ready for your first song',
                        'CUDA check, integrity verification and the 16 GB Windows preset.',
                        ready,
                      ],
                    ].map(([title, description, done], index) => (
                      <div className="setup-step" key={String(title)}>
                        <span className={done ? 'step-number done' : 'step-number'}>
                          {done ? <Check size={15} /> : index + 1}
                        </span>
                        <div>
                          <h3>{title}</h3>
                          <p>{description}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="engine-install-footer">
                    <p>
                      {native
                        ? 'Initial setup needs an internet connection and about 20 GB of free disk space. It can take several minutes.'
                        : 'This is the browser preview. Engine setup and music generation run in the Windows desktop app.'}
                    </p>
                    <button
                      className="primary-button"
                      disabled={!native || active || pending || !engine?.hardware.compatible}
                      onClick={() => void action(api.setup)}
                    >
                      {active && operation?.kind === 'setup' ? (
                        <LoaderCircle className="spin" size={17} />
                      ) : ready ? (
                        <ShieldCheck size={17} />
                      ) : (
                        <Download size={17} />
                      )}{' '}
                      {active && operation?.kind === 'setup'
                        ? 'Setting up…'
                        : ready
                          ? 'Verify & repair engine'
                          : 'Set up music engine'}
                    </button>
                  </div>
                </section>
                <aside className="engine-side">
                  <section className="hardware-card">
                    <div className="label-row">
                      <span className="field-label">YOUR COMPUTER</span>
                      <Cpu size={17} />
                    </div>
                    <h3>
                      {engine?.hardware.gpu || (!native ? 'Desktop app required' : 'Checking GPU…')}
                    </h3>
                    <div className="hardware-specs">
                      <div>
                        <strong>
                          {engine?.hardware.vramGib
                            ? `${Math.round(engine.hardware.vramGib)} GB`
                            : '—'}
                        </strong>
                        <span>VIDEO MEMORY</span>
                      </div>
                      <div>
                        <strong>
                          {engine?.hardware.ramGib
                            ? `${Math.round(engine.hardware.ramGib)} GB`
                            : '—'}
                        </strong>
                        <span>SYSTEM MEMORY</span>
                      </div>
                    </div>
                    <span className="preset-badge">WINDOWS · 16 GB PRESET</span>
                    <p>{engine?.hardware.message || 'Checking your computer…'}</p>
                  </section>
                  <section className="storage-card">
                    <FolderHeart size={22} />
                    <h3>A home for your music.</h3>
                    <p>
                      Models, requests, scores and lossless audio live in your local app data.
                      Reinstalling the app preserves them.
                    </p>
                    <code>{engine?.dataPath || 'Loading…'}</code>
                  </section>
                  <div className="model-attribution">
                    By{' '}
                    <a
                      href="https://github.com/multimodal-art-projection/YuE"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Multimodal Art Projection <ArrowUpRight size={12} />
                    </a>
                    <p>
                      Model weights: CC BY-NC 4.0.
                      <br />
                      For noncommercial use; see the{' '}
                      <a
                        href="https://huggingface.co/m-a-p/YuE2-3B"
                        target="_blank"
                        rel="noreferrer"
                      >
                        model license
                      </a>
                      .
                    </p>
                  </div>
                </aside>
              </div>
            </>
          )}
        </main>
        {view === 'create' && (
          <div className="creation-bar">
            <div className="creation-note">
              <ShieldCheck size={16} />
              <div>
                <strong>
                  {ready ? 'Your ideas stay with you.' : 'One setup. Endless possibilities.'}
                </strong>
                <span>
                  {ready
                    ? 'Private generation on your computer.'
                    : 'Set up your engine once, then create offline.'}
                </span>
              </div>
            </div>
            <button
              className="primary-button"
              disabled={!ready || active || pending || Boolean(validate(draft))}
              onClick={create}
            >
              {active && operation?.kind === 'generation' ? (
                <LoaderCircle className="spin" size={18} />
              ) : (
                <Sparkles size={18} />
              )}{' '}
              {active && operation?.kind === 'generation' ? 'Creating your song…' : 'Create song'}
              <ArrowUpRight size={16} />
            </button>
          </div>
        )}
        {operation &&
          (active || operation.status === 'failed' || operation.status === 'paused') && (
            <div className={`operation-rail ${operation.status}`} role="status">
              <div className="operation-symbol">
                {active ? <LoaderCircle className="spin" size={19} /> : <CircleHelp size={19} />}
              </div>
              <div className="operation-copy">
                <strong>
                  {operation.status === 'failed'
                    ? 'The engine needs attention'
                    : operation.status === 'paused'
                      ? operation.kind === 'setup'
                        ? 'Setup paused'
                        : 'Generation cancelled'
                      : operation.phase}
                </strong>
                <span>{operation.error || operation.detail}</span>
              </div>
              <div className="operation-measure">
                {active && (
                  <>
                    <Clock3 size={13} />
                    <Elapsed started={operation.started} />
                  </>
                )}
                {operation.total != null && operation.completed != null && operation.total > 0 && (
                  <span>
                    {operation.kind === 'setup'
                      ? `${bytes(operation.completed)} / ${bytes(operation.total)}`
                      : `${operation.completed} / ${operation.total}`}
                  </span>
                )}
              </div>
              {operation.total != null && operation.completed != null && operation.total > 0 && (
                <progress
                  max={operation.total}
                  value={operation.completed}
                  aria-label={operation.phase}
                />
              )}
              <button
                className="text-button"
                disabled={pending}
                onClick={() => {
                  if (active) void action(api.cancel);
                  else if (operation.kind === 'setup') void action(api.setup);
                  else {
                    if (runningSong) load(runningSong);
                    setOperation(null);
                  }
                }}
              >
                {active ? (
                  operation.kind === 'setup' ? (
                    <Pause size={15} />
                  ) : (
                    <Square size={13} />
                  )
                ) : (
                  <RotateCcw size={15} />
                )}{' '}
                {active
                  ? operation.kind === 'setup'
                    ? 'Pause'
                    : 'Cancel'
                  : operation.kind === 'setup'
                    ? 'Resume setup'
                    : 'Dismiss'}
              </button>
            </div>
          )}
        <Player
          song={current}
          songs={songs}
          select={setSelected}
          exportSong={(format) =>
            current &&
            void action(async () => {
              if (await api.export(current, format)) setToast(`${format.toUpperCase()} exported.`);
            })
          }
        />
      </div>
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={17} />
          {toast}
        </div>
      )}
      {help && (
        <div className="modal-backdrop" onClick={() => setHelp(false)}>
          <section
            ref={guide}
            className="guide-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="guide-title"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              autoFocus
              className="icon-button close-modal"
              aria-label="Close studio guide"
              onClick={() => setHelp(false)}
            >
              <X size={18} />
            </button>
            <Wave />
            <span className="eyebrow">WELCOME TO YOUR STUDIO</span>
            <h2 id="guide-title">Make your first song.</h2>
            <ol>
              <li>
                <strong>Set up the engine.</strong> Open Engine and choose Set up music engine. The
                app downloads Python, CUDA dependencies and the verified models for you.
              </li>
              <li>
                <strong>Describe the sound.</strong> Give YuE2 a genre, language, instruments and
                vocal character. Choose a preset to start.
              </li>
              <li>
                <strong>Add your lyrics.</strong> Mark sections with [Verse] and [Chorus]. Choose
                Sketch for a quick exploration.
              </li>
              <li>
                <strong>Create, listen, keep.</strong> Generation takes time. Watch the stages, play
                your finished audio, and export WAV or FLAC.
              </li>
            </ol>
            <p>
              The Windows preset targets 16 GB NVIDIA VRAM and 32 GB RAM. Generation budgets cap
              tokens; partial audio is labelled in your library.
            </p>
            <button className="primary-button" onClick={() => setHelp(false)}>
              Back to the studio <ArrowUpRight size={16} />
            </button>
          </section>
        </div>
      )}
    </div>
  );
}

function EngineCard({
  engine,
  operation,
  pending,
  setup,
  details,
}: {
  engine: Engine | null;
  operation: Operation | null;
  pending: boolean;
  setup: () => void;
  details: () => void;
}) {
  const working = operation?.kind === 'setup' && operation.status === 'running';
  return (
    <section className="engine-card">
      <div className="label-row">
        <span className="field-label">AUDIO ENGINE</span>
        <span className="tiny-tag">LOCAL</span>
      </div>
      <div className="engine-card-title">
        <Cpu size={22} />
        <div>
          <h3>YuE2-3B</h3>
          <span>
            {engine?.installed ? 'Your studio is ready.' : 'Great songs start with a little setup.'}
          </span>
        </div>
      </div>
      {working ? (
        <>
          <div className="mini-progress">
            <LoaderCircle size={14} className="spin" />
            <span>{operation.phase}</span>
          </div>
          {operation.total != null && operation.completed != null && (
            <progress value={operation.completed} max={operation.total} />
          )}
        </>
      ) : engine?.installed ? (
        <div className="ready-line">
          <CheckCircle2 size={15} />
          <span>Installed · Windows 16 GB preset</span>
        </div>
      ) : (
        <>
          <p>Download the music model and audio decoder. We’ll take care of the rest.</p>
          <button
            className="secondary-button"
            disabled={
              !native || pending || operation?.status === 'running' || !engine?.hardware.compatible
            }
            onClick={setup}
          >
            <Download size={16} />
            {native ? 'Set up engine' : 'Available in desktop app'}
            {native && <span>{bytes(engine?.totalBytes || 7.8e9)}</span>}
          </button>
        </>
      )}
      <button className="engine-details" onClick={details}>
        {engine?.installed ? 'Manage engine' : 'Check your computer'}
        <ArrowUpRight size={13} />
      </button>
    </section>
  );
}

function Player({
  song,
  songs,
  select,
  exportSong,
}: {
  song: Song | null;
  songs: Song[];
  select: (id: string) => void;
  exportSong: (format: 'wav' | 'flac') => void;
}) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [volume, setVolume] = useState(0.75);
  const [playError, setPlayError] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const source = song?.status === 'complete' ? api.audio(song) : undefined;
  useEffect(() => {
    setPlaying(false);
    setPosition(0);
    setPlayError(null);
  }, [source]);
  useEffect(() => {
    if (audio.current) audio.current.volume = volume;
  }, [volume]);
  const playable = songs.filter((s) => s.status === 'complete');
  function next(offset: number) {
    const index = playable.findIndex((s) => s.id === song?.id);
    const item = playable[index + offset];
    if (item) select(item.id);
  }
  async function toggle() {
    if (!audio.current || !source) return;
    if (playing) audio.current.pause();
    else
      try {
        await audio.current.play();
      } catch {
        setPlayError('Audio could not be opened. Reopen this song or export its FLAC.');
      }
  }
  return (
    <footer className="player">
      <audio
        ref={audio}
        src={source}
        preload="metadata"
        onTimeUpdate={() => setPosition(audio.current?.currentTime || 0)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onError={() => source && setPlayError('This audio file is missing or unavailable.')}
      />
      <div className="player-track">
        <div className={source ? 'player-art has-song' : 'player-art'}>
          {source ? <Wave /> : <Disc3 size={25} />}
        </div>
        <div>
          <strong>{song?.status === 'complete' ? song.request.title : 'No song selected'}</strong>
          <span>
            {playError ||
              (song?.status === 'complete'
                ? song.truncated
                  ? 'Partial audio · 48 kHz stereo'
                  : 'Made in your studio · 48 kHz stereo'
                : 'Your next favorite song is waiting.')}
          </span>
        </div>
      </div>
      <div className="transport">
        <div className="transport-buttons">
          <button
            aria-label="Previous song"
            disabled={!source || playable.findIndex((s) => s.id === song?.id) <= 0}
            onClick={() => next(-1)}
          >
            <SkipBack size={17} />
          </button>
          <button
            className="play-button"
            aria-label={playing ? 'Pause song' : 'Play song'}
            disabled={!source}
            onClick={() => void toggle()}
          >
            {playing ? <Pause size={20} /> : <Play size={20} fill="currentColor" />}
          </button>
          <button
            aria-label="Next song"
            disabled={
              !source || playable.findIndex((s) => s.id === song?.id) >= playable.length - 1
            }
            onClick={() => next(1)}
          >
            <SkipForward size={17} />
          </button>
        </div>
        <div className="seek">
          <span>{duration(position)}</span>
          <input
            aria-label="Song position"
            type="range"
            min={0}
            max={song?.duration || 1}
            step={0.1}
            value={position}
            disabled={!source}
            onChange={(event) => {
              if (audio.current) audio.current.currentTime = Number(event.target.value);
              setPosition(Number(event.target.value));
            }}
          />
          <span>{duration(song?.duration)}</span>
        </div>
      </div>
      <div className="player-actions">
        <Volume2 size={17} />
        <input
          aria-label="Volume"
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={(event) => setVolume(Number(event.target.value))}
        />
        <div className="export-control">
          <button
            className="icon-button"
            aria-label="Export song"
            disabled={!source}
            onClick={() => setExportOpen(!exportOpen)}
          >
            <ArrowDownToLine size={19} />
          </button>
          {exportOpen && (
            <div className="export-menu">
              <button
                onClick={() => {
                  setExportOpen(false);
                  exportSong('flac');
                }}
              >
                <FileAudio size={15} /> Lossless FLAC
              </button>
              <button
                onClick={() => {
                  setExportOpen(false);
                  exportSong('wav');
                }}
              >
                <FileAudio size={15} /> WAV audio
              </button>
            </div>
          )}
        </div>
      </div>
    </footer>
  );
}
