/**
 * KANJI SYSTEM - Master Narrative Engine (v6.0 - Final Polish)
 * High-fidelity 'Ghost Ship' implementation mirroring SilkSystem.js logic.
 * v40.5: Identifier: "HILO DE LA MUCHACHA" (Kanji Thread) - Special end animation (Hanging Tail).
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
        this.nodeCount = 15; // Sincronizado con SilkSystem para paridad perfecta
        this.nodes = [];
        this.safeZoneX = 0;
        this.safeZoneY = 0;

        this.progress = 0;
        this.targetProgress = 0; // v40.0: Internal target for smoothing
        this.isLocked = false;
        this.isDone = false;

        this.waitT0 = 0; // v40.0: Internal wait timer

        // Physics State (v30.0: Ghost Ship Fall)
        this.yOffset = 0;
        this.targetYOffset = 0;
        this.yVelocity = 0;
        this.angleOffset = 0;
        this.targetAngle = 0;

        // v40.6: Organic Movement State
        this.lastScrollY = window.scrollY;
        this.scrollVelocity = 0;
        this.windTime = Math.random() * 100;

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

    update(rect = null) {
        if (!this.isInitialized) return;

        // v40.6: Scroll Velocity & Wind Update
        const currentScroll = window.scrollY;
        this.scrollVelocity = (currentScroll - this.lastScrollY) * 0.95;
        this.lastScrollY = currentScroll;
        this.windTime += 0.02;

        // v40.0: Internal progress smoothing (Lerp)
        const kanjiLerpFactor = 0.12;
        this.progress += (this.targetProgress - this.progress) * kanjiLerpFactor;

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

        // v25.0: Final State Guard (Off-Screen)
        // No enrollment/ovillo allowed. Just mark as done if really far.
        if (rect && (rect.top < -1200 || rect.top > window.innerHeight + 1200)) {
            if (this.state === this.STATE.CUT || (this.progress > 0.95 && this.state !== this.STATE.READY)) {
                this.state = this.STATE.DONE;
                this.isDone = true;
            }
        }

        if (this.state === this.STATE.DONE) {
            this.updatePhysics();
            this.render();
            return;
        }

        this.updateStaticPositions();


        // Clímax: El Kanji llega al destino -> CORTE
        if (this.progress >= 0.999 && this.state === this.STATE.FRAYING) {
            this.state = this.STATE.CUT;
            this.cutTime = Date.now();
            this.isLocked = false; // UNLOCK IMMEDIATELY (User requested)
            console.log("KANJI: Fraying complete, unlocking scroll.");
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
                    // v38.0: Relay Suave. Se desvanece gradualmente mientras llega el siguiente para evitar parpadeos.
                    c.opacity = Math.max(0, 1 - stepT * 2.5); 
                } else {
                    // El resto de los ya deshilachados se ocultan
                    c.opacity = 0;
                }
                c.el.style.visibility = 'hidden';

            } else if (isActive) {
                const t = stepT;
                // v38.1: Interpolación Bezier pura (sin momentum) para un vuelo de seda perfecto
                const elastic = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
                c.curX = sX + (this.safeZoneX - sX) * elastic;
                c.curY = sY + (this.safeZoneY - sY) * elastic;
                c.vX = 0; c.vY = 0; // Reset momentum

                // El que está volando siempre es visible hasta llegar
                c.opacity = 1.0;
                c.el.style.visibility = 'hidden';

            } else {
                c.vX = 0; c.vY = 0;
                c.el.style.visibility = 'visible';
                c.opacity = 1.0;

                const distFromActive = Math.abs(i - currentActiveIdx);

                if (distFromActive < 12 && c.isVisible && this.state === this.STATE.FRAYING) {
                    let prevChar = null;
                    let prevIdx = -1;
                    // v38.11: Búsqueda de vecino con límite de arrastre (SilkSystem style)
                    for (let k = i + 1; k <= currentActiveIdx && k < this.chars.length; k++) {
                        if (this.chars[k].isVisible) {
                            prevChar = this.chars[k];
                            prevIdx = k;
                            break;
                        }
                    }

                    // v38.11: El párrafo (i < stopIndex) corta la conexión si el vecino despega demasiado lejos (>50px)
                    let isCrossLimit = (i < stopIndex && prevIdx > stopIndex);
                    if (prevChar && i < stopIndex && prevIdx === stopIndex) {
                        const neighborDesp = Math.hypot(prevChar.curX - prevChar.homeX, prevChar.curY - prevChar.homeY);
                        if (neighborDesp > 50) isCrossLimit = true; // Snap! El Kanji despega y el párrafo se queda.
                    }

                    if (prevChar && !isCrossLimit) {
                        const sameLine = Math.abs(prevChar.homeY - c.homeY) < 15;
                        const isSameWord = (prevIdx - i === 1); 

                        if (sameLine) {
                            const tensionFactor = 1 - (distFromActive / 12);
                            const psY = prevChar.homeY;
                            const despX = prevChar.curX - prevChar.homeX;
                            const despY = prevChar.curY - psY;

                            if (isSameWord) {
                                // v38.9: Restablecemos el 'feel' sutil de SilkSystem (0.25) sin dampings extraños
                                const fuelleScale = 0.25 * tensionFactor;
                                c.curX = sX + despX * fuelleScale;
                                c.curY = sY + despY * fuelleScale;
                                this.threadsToDraw.push({ x1: c.curX, y1: c.curY, x2: prevChar.curX, y2: prevChar.curY, tension: 0.3 * tensionFactor });
                                c.el.style.visibility = 'hidden';
                            } else {
                                const distVisual = Math.hypot(c.curX - prevChar.curX, c.curY - prevChar.curY);
                                if (distVisual < 45) {
                                    const fuelleScale = 0.05 * tensionFactor;
                                    c.curX = sX + despX * fuelleScale;
                                    c.curY = sY + despY * fuelleScale;
                                    this.threadsToDraw.push({ x1: c.curX, y1: c.curY, x2: prevChar.curX, y2: prevChar.curY, tension: 0.15 * tensionFactor });
                                    c.el.style.visibility = 'hidden'; 
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
        if (this.state !== this.STATE.CUT && this.state !== this.STATE.DONE) {
            // FRAYING PHASE: Hilo unido al carácter que vuela
            const targetIdx = Math.min(this.chars.length - 1, currentActiveIdx);
            const targetChar = this.chars[targetIdx];
            
            this.nodes[0].x = targetChar.curX;
            this.nodes[0].y = targetChar.curY;
            this.nodes[lastNode].x = this.safeZoneX;
            this.nodes[lastNode].y = this.safeZoneY;
        } else {
            // CUT / DONE PHASE: Hilo colgando (HILO DE LA MUCHACHA)
            const tailLength = 45; 
            const t = this.windTime + 0.5; // v45.3: Phase offset to differentiate from Silk
            const windX = Math.sin(t * 1.05) * 12 + Math.sin(t * 2.45) * 2.5; 
            const windY = (windX * windX) / 144 * -3; // Synchronized with SilkSystem parity
            
            let targetX = this.safeZoneX + windX;
            let targetY = this.safeZoneY + tailLength + windY;

            // Scroll Inertia Impact (v44.1: Subtler, ethereal feel - 0.18x)
            if (Math.abs(this.scrollVelocity) > 1) {
                targetY -= this.scrollVelocity * 0.18;
            }

            this.nodes[0].x = targetX;
            this.nodes[0].y = targetY;
            this.nodes[lastNode].x = this.safeZoneX;
            this.nodes[lastNode].y = this.safeZoneY;
        }

        // v40.8: Final Physics Parity (Synchronized with SilkSystem)
        const gravity = this.state === this.STATE.CUT || this.state === this.STATE.DONE ? 0.25 : 0.12;
        const friction = 0.94;

        for (let i = 0; i < this.nodeCount; i++) {
            const n = this.nodes[i];
            
            // v40.8: HARD PIN both ends in DONE/CUT phase (match SilkSystem logic)
            const isTailPin = (i === 0);
            const isAnchorPin = (i === lastNode);

            if (isTailPin || isAnchorPin) {
                // Keep pinned to what we set before the loop
                n.oldX = n.x;
                n.oldY = n.y;
            } else {
                const vx = (n.x - n.oldX) * friction;
                const vy = (n.y - n.oldY) * friction;
                n.oldX = n.x;
                n.oldY = n.y;
                n.x += vx;
                n.y += vy + gravity;

                // Micro-vibración orgánica
                if (this.state === this.STATE.DONE || this.state === this.STATE.CUT) {
                    n.x += (Math.random() - 0.5) * 0.15;
                    n.y += (Math.random() - 0.5) * 0.15;
                }
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
                
                // Pin both ends in CUT/DONE to avoid receding/twitching
                const m1 = (i === 0) ? 0 : 0.5;
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

        if (this.state === this.STATE.CUT && Date.now() - this.cutTime > 2000) {
            this.state = this.STATE.DONE;
            this.isDone = true;
        }
    }

    // --- PRO SCROLL HANDLER (v40.0) ---
    /**
     * Replaces the logic previously scattered in NarrativeManager and main.js
     * Handles the "magnetic pull" and instantaneous lock.
     */
    checkTrigger(rect, vH) {
        if (!rect || this.isDone || this.isLocked && (this.state === this.STATE.CUT || this.state === this.STATE.DONE)) {
            if (this.isLocked && (this.state === this.STATE.CUT || this.state === this.STATE.DONE)) this.isLocked = false;
            return;
        }

        const kanjiCenter = rect.top + rect.height / 2;
        const fadeStart = vH * 0.5;
        const fadeEnd = vH * 0.15;

        // Opacidad por proximidad
        const proximityAlpha = Math.max(0, Math.min(1, (fadeStart - rect.top) / (fadeStart - fadeEnd)));
        const targetAlpha = this.isDone ? 1 : proximityAlpha;
        this.globalAlpha += (targetAlpha - this.globalAlpha) * 0.1;

        // v40.3: Fast-scroll protection
        // If we are already deep into the threshold, we lock instantly bypass the 400ms wait
        const isDeepIn = kanjiCenter < (fadeEnd - 40);

        if (this.state === this.STATE.READY && kanjiCenter <= fadeEnd) {
            if (this.waitT0 === 0) {
                this.waitT0 = Date.now();
                if (isDeepIn) this.lock(kanjiCenter, fadeEnd); // Instant catch
            } else if (Date.now() - this.waitT0 >= 400 || isDeepIn) {
                this.lock(kanjiCenter, fadeEnd);
            }
        } else if (this.state === this.STATE.READY && kanjiCenter > fadeStart) {
            this.waitT0 = 0;
        }
        
        // v40.1: Soft Magnetism during LOCKING
        if (this.isLocked && this.state === this.STATE.LOCKING) {
            const pull = (kanjiCenter - fadeEnd);
            if (Math.abs(pull) > 1) {
                window.scrollTo(0, window.scrollY + pull * 0.1); // Smooth pull instead of hard snap
            } else {
                // Once centered, we are ready to fray
                // We keep LOCKING state until the user actually scrolls to advance
            }
        }
    }

    lock(currentCenter, targetCenter) {
        this.state = this.STATE.LOCKING;
        this.isLocked = true;
        
        // INSTANT CATCH: Si el usuario ya se pasó el límite, lo traemos de vuelta 
        // pero convertimos ese exceso en progreso inicial para que no se sienta "trabado"
        if (currentCenter < targetCenter - 10) {
            const excess = (targetCenter - currentCenter);
            window.scrollTo(0, window.scrollY + (currentCenter - targetCenter));
            // Opcional: Podríamos dar un boost inicial a targetProgress aquí
            // this.targetProgress = Math.min(0.1, excess * 0.001); 
        }
        
        // Trigger global lock in NarrativeManager (handled via instance check)
        console.log("KANJI: Locked and magnetic pull active.");
    }

    handleScroll(deltaY, sensitivity) {
        if (!this.isLocked || this.isDone || this.state === this.STATE.CUT || this.state === this.STATE.DONE) return;

        // v40.2: Start fraying as soon as there's movement
        if (this.state === this.STATE.LOCKING && Math.abs(deltaY) > 0.1) {
            this.state = this.STATE.FRAYING;
        }

        if (this.state === this.STATE.FRAYING) {
            const delta = deltaY * sensitivity;
            this.targetProgress = Math.max(0, Math.min(1, this.targetProgress + delta));
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
                // v44.0: Removida restricción incorrecta que ocultaba letras en DONE

                const finalAlpha = Math.max(0, Math.min(1, c.opacity * this.globalAlpha));
                if (finalAlpha <= 0.01) return;

                ctx.save();
                ctx.globalAlpha = finalAlpha;
                if (c.isHUDAnchor && c.isAnchored) {
                    if (this.hideHUDAnchor) return; // v35.0: Takeover by CompasTension
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
        const isHanging = (this.state === this.STATE.CUT || this.state === this.STATE.DONE);
        ctx.globalAlpha = (isHanging ? 0.95 : 0.85) * this.globalAlpha;
        ctx.font = 'bold 10px "Courier New", monospace';
        const dotGap = 2.5;
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
