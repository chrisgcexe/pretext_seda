/**
 * KANJI SYSTEM - Master Narrative Engine (v6.0 - Final Polish)
 * High-fidelity 'Ghost Ship' implementation mirroring SilkSystem.js logic.
 * Version 6.0: Fixed Indexing math, Magnetic Inertia, and Scroll Lock damping.
 */

export class KanjiCanvas {
    constructor(paragraphEl) {
        this.el = paragraphEl;
        this.fullText = paragraphEl.innerText;

        this.STATE = {
            READY: 'READY',
            LOCKING: 'LOCKING',
            FRAYING: 'FRAYING',
            CUT: 'CUT',
            DONE: 'DONE'
        };
        this.state = this.STATE.READY;
        this.globalAlpha = 0;

        // Setup Canvas
        this.canvas = document.createElement('canvas');
        this.canvas.className = 'kanji-overlay-canvas';
        this.ctx = this.canvas.getContext('2d');
        this.canvas.style.transition = 'opacity 0.4s ease-in-out'; // v27.0: Premium Feel
        document.body.appendChild(this.canvas);

        this.chars = [];
        this.isInitialized = false;

        // Physics Const (consistent with SilkSystem v17.0)
        this.nodeCount = 24; // Más nodos para mayor curvatura
        this.nodes = [];
        this.safeZoneX = 0;
        this.safeZoneY = 0;

        this.progress = 0;
        this.isLocked = false;
        this.isDone = false;

        this.enrollmentProgress = 0; // v24.0: Metáfora del ovillo
        this.enrollmentStarted = false;
        this.snapT = 0;

        // Physics State (v30.0: Ghost Ship Fall)
        this.yOffset = 0;
        this.targetYOffset = 0;
        this.yVelocity = 0;
        this.angleOffset = 0;
        this.targetAngle = 0;

        // Dynamic scaling

        this.baseSize = parseFloat(getComputedStyle(paragraphEl).fontSize) || 16;
        this.fontString = `${this.baseSize}px "Courier New", monospace`;

        // Find the kanji (女)
        this.kanjiIndex = this.fullText.indexOf('(女)');
        if (this.kanjiIndex === -1) this.kanjiIndex = this.fullText.length;

        this.setup();
        this.setupNodes();

        window.addEventListener('resize', () => this.resize());
        this.resize();
    }

    setup() {
        const originalText = this.fullText;
        this.el.innerHTML = '';

        const charsArr = Array.from(originalText);
        charsArr.forEach((char, i) => {
            const span = document.createElement('span');
            span.innerText = char;
            span.style.display = 'inline-block';
            span.style.whiteSpace = 'pre';
            this.el.appendChild(span);

            this.chars.push({
                char: char,
                el: span,
                homeX: 0, homeY: 0,
                curX: 0, curY: 0,
                vX: 0, vY: 0, // Momentum
                opacity: 0,
                isVisible: true,
                // v31.0: Solo el kanji 女 es anchor (índice + 1), no los paréntesis ni la 'r'
                isHUDAnchor: (i === this.kanjiIndex + 1),
                isAnchored: false
            });

        });

        this.isInitialized = true;
    }

    setupNodes() {
        for (let i = 0; i < this.nodeCount; i++) {
            this.nodes.push({ x: 0, y: 0, oldX: 0, oldY: 0 });
        }
    }

    resize() {
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = window.innerWidth * dpr;
        this.canvas.height = window.innerHeight * dpr;
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        this.ctx.scale(dpr, dpr);
        this.updateStaticPositions();

        // Safe Zone
        this.safeZoneX = window.innerWidth - 75;
        this.safeZoneY = window.innerHeight - 85;

        if (this.state === this.STATE.READY) {
            this.initPhysicsPositions();
        }
    }

    initPhysicsPositions() {
        this.updateStaticPositions();
        const start = this.chars[this.chars.length - 1];
        if (!start) return;
        for (let i = 0; i < this.nodeCount; i++) {
            const t = i / (this.nodeCount - 1);
            this.nodes[i].x = this.nodes[i].oldX = start.homeX + (this.safeZoneX - start.homeX) * t;
            this.nodes[i].y = this.nodes[i].oldY = start.homeY + (this.safeZoneY - start.homeY) * t;
        }
    }

    updateStaticPositions() {
        this.chars.forEach(c => {
            const rect = c.el.getBoundingClientRect();
            c.homeX = rect.left + rect.width / 2;
            c.homeY = rect.top + rect.height / 2;
        });
    }

    update(externalProgress, rect = null) {
        if (!this.isInitialized) return;

        // v27.0: Travel Zone Guard (Consistent with SilkSystem)
        if (!this._travelZones) {
            const found = document.querySelectorAll('.zona-viaje');
            if (found.length > 0) this._travelZones = Array.from(found);
        }
        if (this._travelZones) {
            const inTravelZone = this._travelZones.some(z => {
                const r = z.getBoundingClientRect();
                return r.top < window.innerHeight && r.bottom > 0;
            });
            this.canvas.style.opacity = inTravelZone ? '0' : '1';
            this.canvas.style.pointerEvents = inTravelZone ? 'none' : 'auto';
            if (inTravelZone) return; // Skip update for performance
        }

        // v25.0: Proactive Enrollment (Auto-Ovillo Off-Screen)
        if (rect && (rect.top < -800 || rect.top > window.innerHeight + 800)) {
            if (this.state === this.STATE.CUT || (this.progress > 0.95 && this.state !== this.STATE.READY)) {
                this.enrollmentProgress = 1.0;
                this.enrollmentStarted = true;
                this.state = this.STATE.DONE;
                this.isDone = true;
            }
        }

        if (this.state === this.STATE.DONE) {
            this.render();
            return;
        }

        this.updateStaticPositions();

        if (typeof externalProgress === 'number' && this.state !== this.STATE.CUT) {
            // v27.1: State transition trigger (Deadlock Fix)
            if (this.state === this.STATE.LOCKING && externalProgress > 0.001) {
                this.state = this.STATE.FRAYING;
            }

            if (this.state === this.STATE.READY || this.state === this.STATE.LOCKING) {
                this.progress = 0;
            } else {
                this.progress = Math.max(0, Math.min(1, externalProgress));
            }
        }


        // Clímax: El Kanji llega al destino -> CORTE
        if (this.progress >= 0.999 && this.state === this.STATE.FRAYING) {
            this.state = this.STATE.CUT;
            this.cutTime = Date.now();
        }

        this.updatePhysics();
        this.render();
    }

    updatePhysics() {
        // --- MATH FIX v6.3: Deshilachamos hasta el inicio del bloque (fija el kanji en el destino) ---
        const stopIndex = this.kanjiIndex;
        const totalToFray = Math.max(0, this.chars.length - stopIndex);
        const currentActiveFloat = (1 - this.progress) * totalToFray + stopIndex;

        const currentActiveIdx = Math.floor(currentActiveFloat);
        const stepT = 1 - (currentActiveFloat % 1);


        // --- PHYSICS v30.0: Ghost Ship Fall ---
        let spring = 0.05;
        let damping = 0.85;

        if (this.state === this.STATE.CUT) {
            spring = 0.04;
            damping = 0.75; // "Cae" con más peso
            if (this.targetYOffset === 0) {
                this.targetYOffset = 280; // Distancia de caída
                this.yVelocity = 4.5; // Impulso inicial
                this.targetAngle = 3.5; // Inclinación
            }
        }

        // v31.1: Asymptotic smoothing instead of spring for yOffset (No bounce)
        this.yOffset += (this.targetYOffset - this.yOffset) * 0.08;
        this.angleOffset += (this.targetAngle - this.angleOffset) * 0.1;


        // --- NODOS ---
        const lastNode = this.nodeCount - 1;
        if (this.state !== this.STATE.CUT) {
            // Si currentActiveIdx === length, usamos el último char como ancla visual
            const targetIdx = Math.min(this.chars.length - 1, currentActiveIdx);
            const targetChar = this.chars[targetIdx];
            this.nodes[0].x = targetChar.homeX;
            this.nodes[0].y = targetChar.homeY;
            this.nodes[lastNode].x = this.safeZoneX;
            this.nodes[lastNode].y = this.safeZoneY;
        } else {
            // v24.0: Metáfora del ovillo en el corte
            if (Date.now() - this.cutTime > 2000) {
                if (!this.enrollmentStarted) this.enrollmentStarted = true;
                if (this.enrollmentProgress < 1.0) {
                    this.enrollmentProgress += 0.012;
                    if (this.enrollmentProgress >= 1.0) {
                        this.enrollmentProgress = 1.0;
                    }
                }
            }

            this.nodes[lastNode].x = this.safeZoneX;
            this.nodes[lastNode].y = this.safeZoneY;

            if (this.enrollmentStarted) {
                // v31.0: Ovillo más drástico. El ancla muelle tira de todo el sistema.
                const t = this.enrollmentProgress;
                this.nodes[0].x += (this.safeZoneX - this.nodes[0].x) * (t * 0.15);
                this.nodes[0].y += (this.safeZoneY - this.nodes[0].y) * (t * 0.15);
            }
        }

        // Gravedad constante para el "sag". En el enrollado, la gravedad disminuye.
        const gravity = this.state === this.STATE.CUT ? (0.45 * (1 - this.enrollmentProgress)) : 0.08;
        const friction = 0.95;

        for (let i = 0; i < this.nodeCount; i++) {
            const n = this.nodes[i];
            if ((i === 0 && this.state !== this.STATE.CUT) || i === lastNode) {
                // Pin
            } else {
                const vx = (n.x - n.oldX) * friction;
                const vy = (n.y - n.oldY) * friction;
                n.oldX = n.x;
                n.oldY = n.y;
                n.x += vx;
                n.y += vy + gravity;
            }
        }

        const restDist = 28;
        for (let j = 0; j < 8; j++) {
            for (let i = 0; i < this.nodeCount - 1; i++) {
                const n1 = this.nodes[i];
                const n2 = this.nodes[i + 1];
                const dx = n2.x - n1.x;
                const dy = n2.y - n1.y;
                const d = Math.hypot(dx, dy);
                const diff = (d - restDist) / (d || 1);
                const m1 = (i === 0 && this.state !== this.STATE.CUT) ? 0 : 0.5;
                const m2 = (i + 1 === lastNode) ? 0 : 0.5;
                if (m1 + m2 === 0) continue;
                const totalM = m1 + m2;
                n1.x += dx * (m1 / totalM) * diff;
                n1.y += dy * (m1 / totalM) * diff;
                n2.x -= dx * (m2 / totalM) * diff;
                n2.y -= dy * (m2 / totalM) * diff;
            }
        }

        // --- CARACTERES (Momentum Logic v6.0) ---
        this.chars.forEach((c, i) => {
            const isFrayed = i > currentActiveIdx;
            const isActive = i === currentActiveIdx && this.progress > 0;

            if (isFrayed) {
                // LÓGICA SEDAL: Llegada inercial al destino
                // v6.4: Tighter arrival (Fast Force, High Damping)
                c.vX += (this.safeZoneX - c.curX) * 0.25;
                c.vY += (this.safeZoneY - c.curY) * 0.25;
                c.vX *= 0.6; c.vY *= 0.6;
                c.curX += c.vX; c.curY += c.vY;

                c.el.style.visibility = 'hidden';

                const isLastArrived = (i === currentActiveIdx + 1);
                c.isAnchored = c.isHUDAnchor && this.progress > 0.95;

                if (c.isAnchored) {
                    c.opacity = 1.0;
                } else {
                    // Solo visible mientras termina de llegar
                    const distToSafe = Math.hypot(c.curX - this.safeZoneX, c.curY - this.safeZoneY);
                    c.opacity = isLastArrived ? Math.max(0, 1 - (1 - stepT) * 2) * (distToSafe / 50 + 0.1) : 0;
                }

            } else if (isActive) {
                // LÓGICA SEDAL: Peeling Inercial
                const t = stepT;
                const elastic = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

                const targetX = c.homeX + (this.safeZoneX - c.homeX) * elastic;
                const targetY = c.homeY + (this.safeZoneY - c.homeY) * elastic;

                // Suavizado inercial para que no parezca un lerp rígido
                // v6.4: Tighter peeling (Snappy reaction, less overshoot)
                c.vX += (targetX - c.curX) * 0.4;
                c.vY += (targetY - c.curY) * 0.4;
                c.vX *= 0.65; c.vY *= 0.65;
                c.curX += c.vX; c.curY += c.vY;

                c.opacity = Math.max(0, Math.min(1, (0.95 - elastic) * 10));
                c.el.style.visibility = 'hidden';

            } else {
                // LÓGICA SEDAL: Estático
                c.curX = c.homeX;
                c.curY = c.homeY;
                c.vX = 0; c.vY = 0;
                c.el.style.visibility = 'visible';
                c.opacity = 1.0;

                const distFromActive = Math.abs(i - currentActiveIdx);
                if (distFromActive < 8 && this.globalAlpha > 0.5) {
                    const tension = 1 - (distFromActive / 8);
                    c.curY += Math.sin(Date.now() * 0.03) * (1.8 * tension * this.globalAlpha);
                }
            }
        });

        if (this.snapT > 0) {
            this.snapT--;
        }

        if (this.state === this.STATE.CUT && Date.now() - this.cutTime > 5000) {
            this.state = this.STATE.DONE;
            this.isDone = true;
            this.isLocked = false;
        }
    }

    render() {
        const ctx = this.ctx;
        const dpr = window.devicePixelRatio || 1;
        ctx.clearRect(0, 0, this.canvas.width / dpr, this.canvas.height / dpr);

        if (this.globalAlpha <= 0.01) return;

        this.drawSilkPath(ctx);

        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        this.chars.forEach(c => {
            if (c.el.style.visibility === 'hidden' || c.isAnchored) {
                const finalAlpha = Math.max(0, Math.min(1, c.opacity * this.globalAlpha));
                if (finalAlpha <= 0.01) return;

                ctx.save();
                ctx.globalAlpha = finalAlpha;
                if (c.isHUDAnchor && c.isAnchored) {
                    ctx.fillStyle = "#4a7a9e";
                    ctx.font = `600 ${this.baseSize * 1.5}px "Courier New", monospace`;
                } else {
                    ctx.fillStyle = "#333";
                    ctx.font = this.fontString;
                }

                // Jitter del snap final del ovillo
                const offX = 0;
                const offY = 0;

                // --- PHYSICS v30.1: Aplicamos caída y rotación si no está anclado ---
                let drawX = c.curX;
                let drawY = c.curY;

                if (!c.isAnchored) {
                    const tiltY = (c.homeX - window.innerWidth / 2) * Math.sin(this.angleOffset * Math.PI / 180);
                    drawX = c.curX;
                    drawY = c.curY + this.yOffset + tiltY;
                }

                ctx.fillText(c.char, drawX + offX, drawY + offY);
                ctx.restore();
            }

        });
    }

    drawSilkPath(ctx) {
        ctx.save();
        ctx.fillStyle = "#4a7a9e";
        ctx.globalAlpha = (this.state === this.STATE.CUT ? 0.5 : 0.8) * this.globalAlpha * (1 - this.enrollmentProgress);
        ctx.font = 'bold 9px "Courier New", monospace';
        const dotGap = 2.4;
        let accumulator = 0;
        for (let i = 0; i < this.nodeCount - 1; i++) {
            const p1 = this.nodes[i];
            const p2 = this.nodes[i + 1];
            const p3 = this.nodes[Math.min(i + 2, this.nodeCount - 1)];
            const midX1 = (p1.x + p2.x) / 2;
            const midY1 = (p1.y + p2.y) / 2;
            const midX2 = (p2.x + p3.x) / 2;
            const midY2 = (p2.y + p3.y) / 2;
            const arcDist = Math.hypot(midX2 - midX1, midY2 - midY1);
            let t = accumulator / (arcDist || 1);
            while (t < 1.0) {
                const bx = (1 - t) * (1 - t) * midX1 + 2 * (1 - t) * t * p2.x + t * t * midX2;
                const by = (1 - t) * (1 - t) * midY1 + 2 * (1 - t) * t * p2.y + t * t * midY2;
                ctx.fillText('.', bx, by);
                t += dotGap / (arcDist || 1);
            }
            accumulator = (t - 1.0) * arcDist;
        }
        ctx.restore();
    }
}
