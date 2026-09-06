import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import StartGame, { EventBus, EV, Phase, Mode, GAME_WIDTH, GAME_HEIGHT } from './game/main';
import { THEMES, ThemeKey, INTRO_DIALOGUE } from './game/divinationData';

export interface IRefPhaserGame {
    game: Phaser.Game | null;
    scene: Phaser.Scene | null;
}

interface FinishedPayload {
    winner: 'p1' | 'p2' | 'draw';
    p1Store: number;
    p2Store: number;
    p1Captures: number;
    p2Captures: number;
    maxSingleCapture: number;
    totalTurns: number;
    theme: ThemeKey;
    mode: Mode;
    reading: string[];
}

interface GriotPayload {
    quote: string;
    tag: string;
    character: 'diviner' | 'trickster';
}

function App() {
    const phaserRef = useRef<IRefPhaserGame | null>(null);

    const [phase, setPhase] = useState<Phase>('MENU');
    const [mode, setMode] = useState<Mode>('ai');
    const [theme, setTheme] = useState<ThemeKey>('harvest');
    const [introIdx, setIntroIdx] = useState(0);
    const [griot, setGriot] = useState<GriotPayload | null>(null);
    const [finished, setFinished] = useState<FinishedPayload | null>(null);
    const [showRules, setShowRules] = useState(false);
    const [muted, setMuted] = useState(false);

    // Mount the Phaser game exactly once. DO NOT remove this effect or the
    // #game-container div — the canvas mounts there.
    useLayoutEffect(() => {
        if (phaserRef.current === null) {
            const game = StartGame('game-container');
            phaserRef.current = { game, scene: null };
        }
        const handler = (scene: Phaser.Scene) => {
            if (phaserRef.current) phaserRef.current.scene = scene;
        };
        EventBus.on(EV.SCENE_READY, handler);
        return () => {
            EventBus.removeListener(EV.SCENE_READY, handler);
            if (phaserRef.current) {
                phaserRef.current.game?.destroy(true);
                phaserRef.current = null;
            }
        };
    }, []);

    // EventBus subscriptions
    useEffect(() => {
        const onPhase = (p: Phase) => setPhase(p);
        const onGriot = (g: GriotPayload) => {
            setGriot(g);
            window.setTimeout(() => setGriot(null), 4200);
        };
        const onFinished = (f: FinishedPayload) => setFinished(f);
        const onSound = (m: boolean) => setMuted(m);
        EventBus.on(EV.PHASE_CHANGED, onPhase);
        EventBus.on(EV.GRIOt, onGriot);
        EventBus.on(EV.GAME_FINISHED, onFinished);
        EventBus.on(EV.SOUND_TOGGLED, onSound);
        return () => {
            EventBus.removeListener(EV.PHASE_CHANGED, onPhase);
            EventBus.removeListener(EV.GRIOt, onGriot);
            EventBus.removeListener(EV.GAME_FINISHED, onFinished);
            EventBus.removeListener(EV.SOUND_TOGGLED, onSound);
        };
    }, []);

    // Keyboard parity: Space/Enter advance dialogue & restart; Esc pause; M mute.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.code === 'Space' || e.code === 'Enter') {
                if (phase === 'INTRO') advanceIntro();
                else if (phase === 'FINISHED') restart();
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [phase, introIdx]);

    function beginMatch() {
        EventBus.emit(EV.START_GAME, { mode, theme });
    }

    function advanceIntro() {
        if (introIdx < INTRO_DIALOGUE.length - 1) {
            setIntroIdx(i => i + 1);
        } else {
            setIntroIdx(0);
            beginMatch();
        }
    }

    function restart() {
        EventBus.emit(EV.RESTART_GAME);
    }

    function toMenu() {
        EventBus.emit(EV.PHASE_CHANGED, 'MENU' as Phase);
        setFinished(null);
    }

    function togglePause() {
        EventBus.emit(EV.PHASE_CHANGED, phase === 'PAUSED' ? ('PLAYING' as Phase) : ('PAUSED' as Phase));
    }

    function toggleMute() {
        EventBus.emit(EV.SOUND_TOGGLED, !muted);
    }

    const themeMeta = THEMES.find(t => t.key === theme)!;

    return (
        <div id="app">
            <div id="game-container"></div>

            <div id="hud">
                {/* ---- MENU ---- */}
                {phase === 'MENU' && (
                    <div className="screen menu-screen">
                        <div className="menu-inner">
                            <h1 className="title">AYÒ ÀṢẸ</h1>
                            <p className="subtitle">A Yoruba Mancala Divination</p>

                            <div className="section-label">Choose Your Path</div>
                            <div className="mode-row">
                                <button
                                    className={`mode-btn ${mode === 'ai' ? 'active' : ''}`}
                                    onClick={() => { setMode('ai'); EventBus.emit(EV.MODE_CHANGED, 'ai' as Mode); }}
                                >
                                    Solo vs Spirit
                                </button>
                                <button
                                    className={`mode-btn ${mode === 'pvp' ? 'active' : ''}`}
                                    onClick={() => { setMode('pvp'); EventBus.emit(EV.MODE_CHANGED, 'pvp' as Mode); }}
                                >
                                    Two Player
                                </button>
                            </div>

                            <div className="section-label">Divination Theme</div>
                            <div className="theme-row">
                                {THEMES.map(t => (
                                    <button
                                        key={t.key}
                                        className={`theme-btn ${theme === t.key ? 'active' : ''}`}
                                        onClick={() => { setTheme(t.key); EventBus.emit(EV.THEME_CHANGED, t.key); }}
                                    >
                                        <span className="theme-glyph">{t.glyph}</span>
                                        <span className="theme-name">{t.label}</span>
                                    </button>
                                ))}
                            </div>
                            <p className="theme-blurb">{themeMeta.blurb}</p>

                            <button className="primary-btn" onClick={() => setPhase('INTRO')}>
                                Begin Divination Match
                            </button>
                            <button className="ghost-btn" onClick={() => setShowRules(true)}>
                                How to Play Ayò
                            </button>
                        </div>
                    </div>
                )}

                {/* ---- INTRO DIALOGUE ---- */}
                {phase === 'INTRO' && (
                    <div className="screen intro-screen">
                        <div className="dialogue-card">
                            <div className={`portrait ${INTRO_DIALOGUE[introIdx].speaker}`}>
                                {INTRO_DIALOGUE[introIdx].speaker === 'diviner' ? '🧙🏿' : '🎭'}
                            </div>
                            <div className="dialogue-body">
                                <div className="speaker-name">
                                    {INTRO_DIALOGUE[introIdx].speaker === 'diviner' ? 'The Ifá Diviner' : 'The Trickster Spirit'}
                                </div>
                                <p className="dialogue-text typewriter" key={introIdx}>
                                    {INTRO_DIALOGUE[introIdx].text}
                                </p>
                            </div>
                        </div>
                        <button className="primary-btn continue-btn" onClick={advanceIntro}>
                            {introIdx < INTRO_DIALOGUE.length - 1 ? 'Continue ▸' : 'Take the Board ▸'}
                        </button>
                        <div className="hint">Space / Enter to continue</div>
                    </div>
                )}

                {/* ---- PLAYING HUD ---- */}
                {phase === 'PLAYING' && (
                    <div className="hud-bar">
                        <button className="icon-btn" onClick={togglePause}>⏸</button>
                        <div className="hud-title">Ayò Àṣẹ</div>
                        <button className="icon-btn" onClick={toggleMute}>{muted ? '🔇' : '🔊'}</button>
                    </div>
                )}

                {/* ---- GRIOt COMMENTARY ---- */}
                {griot && phase === 'PLAYING' && (
                    <div className={`griot-card ${griot.character}`}>
                        <div className="griot-tag">{griot.tag.replace('_', ' ')}</div>
                        <p className="griot-quote">“{griot.quote}”</p>
                    </div>
                )}

                {/* ---- PAUSED ---- */}
                {phase === 'PAUSED' && (
                    <div className="screen pause-screen">
                        <div className="pause-card">
                            <h2>Paused</h2>
                            <button className="primary-btn" onClick={togglePause}>Resume</button>
                            <button className="ghost-btn" onClick={restart}>Restart Match</button>
                            <button className="ghost-btn danger" onClick={toMenu}>Return to Menu</button>
                        </div>
                    </div>
                )}

                {/* ---- FINISHED / DIVINATION READING ---- */}
                {phase === 'FINISHED' && finished && (
                    <div className="screen finished-screen">
                        <div className="scroll-card">
                            <div className="verdict">
                                {finished.winner === 'draw'
                                    ? 'A Harmonious Draw'
                                    : finished.winner === 'p1'
                                        ? (finished.mode === 'ai' ? 'You Triumph' : 'Player One Triumphs')
                                        : (finished.mode === 'ai' ? 'The Spirit Prevails' : 'Player Two Triumphs')}
                            </div>
                            <div className="stats-grid">
                                <div className="stat"><span className="stat-num">{finished.p1Store}</span><span className="stat-lbl">Your Bowl</span></div>
                                <div className="stat"><span className="stat-num">{finished.p2Store}</span><span className="stat-lbl">Spirit Bowl</span></div>
                                <div className="stat"><span className="stat-num">{finished.maxSingleCapture}</span><span className="stat-lbl">Largest Capture</span></div>
                                <div className="stat"><span className="stat-num">{finished.totalTurns}</span><span className="stat-lbl">Turns</span></div>
                            </div>
                            <div className="reading-label">The Reading — {THEMES.find(t => t.key === finished.theme)?.label}</div>
                            <div className="reading-body">
                                {finished.reading.map((line, i) => (
                                    <p key={i} className="reading-line">{line}</p>
                                ))}
                            </div>
                            <button className="primary-btn" onClick={restart}>Consult Again</button>
                            <button className="ghost-btn" onClick={toMenu}>Return to Menu</button>
                            <div className="hint">Tap or press Enter to consult again</div>
                        </div>
                    </div>
                )}

                {/* ---- RULES MODAL ---- */}
                {showRules && (
                    <div className="modal-backdrop" onClick={() => setShowRules(false)}>
                        <div className="modal-card" onClick={e => e.stopPropagation()}>
                            <h2>How to Play Ayò</h2>
                            <ul className="rules-list">
                                <li>The board has 12 pits (2 rows of 6) and 2 calabash stores. Each pit holds 4 cowrie seeds — 48 in all.</li>
                                <li>On your turn, pick a non-empty pit on your side. Seeds are sown one per pit, counter-clockwise.</li>
                                <li>If your last seed lands in an opponent pit making it exactly 2 or 3, you capture those seeds into your store.</li>
                                <li>Captures chain backward through consecutive opponent pits holding 2 or 3.</li>
                                <li>Grand Slam: you may not capture all opponent seeds unless no other move exists — the opponent must always be fed.</li>
                                <li>When one side cannot move, the other claims the remaining seeds. Highest bowl wins.</li>
                                <li>Controls: tap a pit, or keys 1–6. Esc pauses, M mutes, Space/Enter advance.</li>
                            </ul>
                            <button className="primary-btn" onClick={() => setShowRules(false)}>Understood</button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

export default App;
