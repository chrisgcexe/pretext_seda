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
        // --- MATH FIX v6.6: Paramos deshilachado en el Kanji (idx + 1). El '(' previo se queda quieto.
        const stopIndex = this.kanjiIndex + 1; 
        const totalToFray = Math.max(0, this.chars.length - stopIndex);
        const currentActiveFloat = (1 - this.progress) * totalToFray + stopIndex;

        const currentActiveIdx = Math.floor(currentActiveFloat);
        const stepT = 1 - (currentActiveFloat % 1);

        // --- CARACTERES (Momentum Logic v6.0) ---
        // v31.4: Reordenado. Primero actualizamos caracteres para que los nodos del hilo
        // usen las posiciones frescas de este mismo frame (Evita el lag/desfase visual).
        this.threadsToDraw = [];
        this.chars.forEach((c, i) => {
            const isFrayed = i > currentActiveIdx;
            const isActive = i === currentActiveIdx && this.progress > 0;

            const sX = c.homeX;
            const sY = c.homeY;

            // v31.10: Lógica de Relevo (Relay) - Como SilkSystem
            // El 'isRelay' es el carácter que acaba de llegar a la zona segura.
            const isRelay = (i === currentActiveIdx + 1);
            
            // v31.9: Elevamos chequeo de anclaje para que el Kanji llegue con autoridad
            c.isAnchored = c.isHUDAnchor && this.progress > 0.95;

            if (c.isAnchored) {
                c.opacity = 1.0;
                c.curX += (this.safeZoneX - c.curX) * 0.3; // Interpolación suave final
                c.curY += (this.safeZoneY - c.curY) * 0.3;
                c.el.style.visibility = 'hidden';
            } else if (isFrayed) {
                // Si es el relevo actual, lo mostramos en la zona segura
                if (isRelay) {
                    c.curX = this.safeZoneX;
                    c.curY = this.safeZoneY;
                    c.opacity = 1.0;
                } else {
                    // El resto de los ya deshilachados se ocultan (reemplazados por el nuevo)
                    c.opacity = 0;
                }
                c.el.style.visibility = 'hidden';

            } else if (isActive) {
                const t = stepT;
                const elastic = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
                const targetX = sX + (this.safeZoneX - sX) * elastic;
                const targetY = sY + (this.safeZoneY - sY) * elastic;

                c.vX += (targetX - c.curX) * 0.4;
                c.vY += (targetY - c.curY) * 0.4;
                c.vX *= 0.65; c.vY *= 0.65;
                c.curX += c.vX; c.curY += c.vY;

                // El que está volando siempre es visible hasta llegar
                c.opacity = 1.0;
                c.el.style.visibility = 'hidden';

            } else {
                c.vX = 0; c.vY = 0;
                c.el.style.visibility = 'visible';
                c.opacity = 1.0;

                const distFromActive = Math.abs(i - currentActiveIdx);

                if (distFromActive < 12 && c.isVisible && this.state !== this.STATE.CUT) {
                    let prevChar = null;
                    let prevIdx = -1;
                    // v31.8: Solo reconectamos hasta el currentActiveIdx y sin pasarnos del límite.
                    // No conectamos a letras que ya se soltaron y están volando (o invisibles)
                    for (let k = i + 1; k <= currentActiveIdx && k < this.chars.length; k++) {
                        if (this.chars[k].isVisible) {
                            prevChar = this.chars[k];
                            prevIdx = k;
                            break;
                        }
                    }

                    if (prevChar) {
                        const sameLine = Math.abs(prevChar.homeY - c.homeY) < 15;
                        const isSameWord = (prevIdx - i === 1); 

                        if (sameLine) {
                            const tensionFactor = 1 - (distFromActive / 12);
                            const psY = prevChar.homeY;
                            const despX = prevChar.curX - prevChar.homeX;
                            const despY = prevChar.curY - psY;

                            if (isSameWord) {
                                // v31.11: Limitamos el fuelle. Si la letra ya voló lejos, no arrastra al párrafo.
                                const totalDesp = Math.hypot(despX, despY);
                                if (totalDesp < 60) {
                                    // v31.4: Mayor fuelle (0.42) para que se sienta la conexión física
                                    c.curX = sX + despX * (0.42 * tensionFactor);
                                    c.curY = sY + despY * (0.42 * tensionFactor);
                                    this.threadsToDraw.push({ x1: c.curX, y1: c.curY, x2: prevChar.curX, y2: prevChar.curY, tension: 0.45 * tensionFactor });
                                    c.el.style.visibility = 'hidden'; // Forzar dibujo en canvas para ver el estiramiento
                                } else {
                                    c.curX = sX; c.curY = sY;
                                }
                            } else {
                                const distVisual = Math.hypot(c.curX - prevChar.curX, c.curY - prevChar.curY);
                                if (distVisual < 45) {
                                    c.curX = sX + despX * (0.12 * tensionFactor);
                                    c.curY = sY + despY * (0.12 * tensionFactor);
                                    this.threadsToDraw.push({ x1: c.curX, y1: c.curY, x2: prevChar.curX, y2: prevChar.curY, tension: 0.22 * tensionFactor });
                                    c.el.style.visibility = 'hidden'; // Forzar dibujo en canvas
                                } else {
                                    c.curX = sX; c.curY = sY;
                                }
                            }
                        } else {
                            c.curX = sX; c.curY = sY;
                        }
                    } else {
                        c.curX = sX; c.curY = sY;
                    }
                } else {
                    c.curX = sX; c.curY = sY;
                }

            }
        });

        // --- NODOS ---
        const lastNode = this.nodeCount - 1;
        if (this.state !== this.STATE.CUT) {
            // Si currentActiveIdx === length, usamos el último char como ancla visual
            const targetIdx = Math.min(this.chars.length - 1, currentActiveIdx);
            const targetChar = this.chars[targetIdx];
            
            // v31.4: Ahora usamos targetChar recién actualizado (Lag 0)
            this.nodes[0].x = targetChar.curX;
            this.nodes[0].y = targetChar.curY;
            
            this.nodes[lastNode].x = this.safeZoneX;
            this.nodes[lastNode].y = this.safeZoneY;
        } else {
            // v24.0: Metáfora del ovillo en el corte (SilkSystem sync)
            let enroll = 0;
            if (Date.now() - this.cutTime > 2000) {
                if (!this.enrollmentStarted) this.enrollmentStarted = true;
                if (this.enrollmentProgress < 1.0) {
                    this.enrollmentProgress += 0.012;
                    if (this.enrollmentProgress >= 1.0) {
                        this.enrollmentProgress = 1.0;
                    }
                }
                enroll = this.enrollmentProgress;
            }

            // v31.7: Caída suave al "hilo colgante" y luego enrollado
            const targetHangY = this.safeZoneY + (60 * (1 - enroll));
            this.nodes[0].x += (this.safeZoneX - this.nodes[0].x) * 0.15;
            this.nodes[0].y += (targetHangY - this.nodes[0].y) * 0.15;
            
            this.nodes[lastNode].x = this.safeZoneX;
            this.nodes[lastNode].y = this.safeZoneY;
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

        // --- DINÁMICA DE SEDA VERLET (SilkSystem logic) ---
        const iterations = 24;
        const relaxFactor = 1.02; // Tensado suave
        const nStart = this.nodes[0];
        const nEnd = this.nodes[lastNode];
        const totalDist = Math.hypot(nEnd.x - nStart.x, nEnd.y - nStart.y);
        const targetLen = totalDist * relaxFactor;
        const segLen = targetLen / (this.nodeCount - 1);

        for (let j = 0; j < iterations; j++) {
            for (let i = 0; i < this.nodeCount - 1; i++) {
                const n1 = this.nodes[i];
                const n2 = this.nodes[i + 1];
                const dx = n2.x - n1.x;
                const dy = n2.y - n1.y;
                const d = Math.hypot(dx, dy);
                const diff = (segLen - d) / (d || 1);
                
                const m1 = (i === 0 && this.state !== this.STATE.CUT) ? 0 : 0.5;
                const m2 = (i + 1 === lastNode) ? 0 : 0.5;
                if (m1 + m2 === 0) continue;
                
                const offsetX = dx * diff * 0.5;
                const offsetY = dy * diff * 0.5;
                
                if (m1 !== 0) {
                    n1.x -= offsetX;
                    n1.y -= offsetY;
                }
                if (m2 !== 0) {
                    n2.x += offsetX;
                    n2.y += offsetY;
                }
            }
        }

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

        if (this.threadsToDraw) {
            this.threadsToDraw.forEach(t => this.drawThread(ctx, t.x1, t.y1, t.x2, t.y2, t.tension));
        }

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
                    ctx.font = `600 ${this.baseSize * 1.15}px "Courier New", monospace`;
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

                // v31.3: Visual Offset ahora está integrado en curX/Y para una sincronía absoluta
                // Solo mantenemos el render directo.
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
            
            // v31.4: Fix Gap - El primer punto de la curva DEBE ser exactamente nodes[0]
            const midX1 = (i === 0) ? p1.x : (p1.x + p2.x) / 2;
            const midY1 = (i === 0) ? p1.y : (p1.y + p2.y) / 2;
            const midX2 = (i === this.nodeCount - 2) ? p2.x : (p2.x + p3.x) / 2;
            const midY2 = (i === this.nodeCount - 2) ? p2.y : (p2.y + p3.y) / 2;
            
            const arcDist = Math.hypot(midX2 - midX1, midY2 - midY1);
            let t = (i === 0) ? 0 : (accumulator / (arcDist || 1)); // Reset t at start to anchor dot 0
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

    drawThread(ctx, x1, y1, x2, y2, opacity, color = "#4a7a9e") {
        ctx.save(); 
        ctx.fillStyle = color; 
        ctx.globalAlpha = opacity * 0.7; // Más sutil
        ctx.font = '7px "Courier New", monospace'; // Más pequeño
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        const dx = x2 - x1;
        const dy = y2 - y1;
        const dist = Math.hypot(dx, dy);
        const midX = x1 + dx * 0.5;
        const midY = y1 + dy * 0.5;
        const sag = 3 + (dist * 0.035); 

        const cpX = midX;
        const cpY = midY + sag;

        // Densidad uniforme para hilos finos
        const dotGap = 3.5;
        const steps = Math.max(3, Math.floor(dist / dotGap));

        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const bx = (1-t)*(1-t)*x1 + 2*(1-t)*t*cpX + t*t*x2;
            const by = (1-t)*(1-t)*y1 + 2*(1-t)*t*cpY + t*t*y2;
            ctx.fillText('.', bx, by);
        }
        
        ctx.restore(); 
    }
}
