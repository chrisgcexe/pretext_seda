/**
 * SILK CANVAS ENGINE
 * Reemplaza el sistema de Spans por un Canvas de alta performance.
 * v3.0 - Mecánica de Ruptura y Costura (Drag & Drop)
 */
export class SilkCanvas {
    constructor(elements, fullText, limitIndex = -1) {
        // elements: Array of { el: HTMLElement, text: string }
        this.elements = elements;
        this.fullText = fullText;
        this.limitIndex = limitIndex;
        this.cutoff = this.fullText.length;
        
        // El container principal (para referencia de estilo base)
        this.mainContainer = elements[0].el;

        // Limpiamos overlays previos

        document.querySelectorAll('.silk-overlay-canvas').forEach(el => el.remove());

        this.canvas = document.createElement('canvas');
        this.canvas.className = 'silk-overlay-canvas';
        this.ctx = this.canvas.getContext('2d');
        this.canvas.style.transition = 'opacity 0.4s ease-in-out'; // v27.0: Smooth Hiding
        document.body.appendChild(this.canvas);

        this.chars = [];
        this.isInitialized = false;
        this.hasResized = false;
        this.relayTriggered = false;
        
        // --- FÍSICAS GHOST SHIP (v11.0) ---
        // Desacoplamos el movimiento visual del párrafo del DOM
        this.yOffset = 0;       
        this.yVelocity = 0;     // Velocidad para gravedad/muelles
        this.targetYOffset = 0; 
        this.angleOffset = 0;   // Inclinación visual del párrafo roto
        this.targetAngle = 0;
        this.offsetLerp = 0.08; 
        this.yDamping = 0.92;   // Fricción física vertical
        this.ySpring = 0.15;    // Fuerza del muelle de recuperación

        this.nodeCount = 15; // Optimización de rendimiento (v10.5)
        this.nodes = [];
        this.anchorNodes = []; 
        this.linkNodes = []; // NUEVO: Para el Vínculo Narrativo con física real

        for (let i = 0; i < this.nodeCount; i++) {
            this.nodes.push({ x: 0, y: 0, oldX: 0, oldY: 0, pinned: (i === 0) });
            this.anchorNodes.push({ x: 0, y: 0, oldX: 0, oldY: 0, pinned: (i === 0) });
            this.linkNodes.push({ x: 0, y: 0, oldX: 0, oldY: 0, pinned: (i === 0) });
        }

        // --- ESTADOS NARRATIVOS (RELEVO DE ANCLA) ---
        this.activeHUDChar = "J";
        this.relayTriggered = false;
        this.oConsumed = false; // v31.2: Para ocultar la O al tocar la J

        // --- ESTADOS DE LA MECÁNICA (MAQUINA DE ESTADOS v9.0) ---
        this.STATE = {
            INTACT: 'intact',
            BROKEN: 'broken',
            DRAGGING: 'dragging',
            REPAIRED: 'repaired',
            DONE: 'done'
        };
        this.state = this.STATE.INTACT;

        this.mouseX = 0;
        this.mouseY = 0;
        this.repairScrollY = 0;
        
        // --- SEGUIMIENTO DE DEBUG (v13.0) ---
        this.mergeEventTriggered = false;
        this.mergePoint = { x: 0, y: 0 };
        
        // --- OPTIMIZACIÓN PERFORMANCE ARMOR (v3.5) ---
        this.isSleeping = false;
        this.framesInactive = 0;
        this.lastScrollY = window.scrollY; 
        
        // --- HITBOXES FÍSICAS (v5.0) ---
        this.collisionRects = [];
        this.postRepairScrollStarted = false; // Deadzone de inercia
        
        // --- EFECTOS DE IMPACTO (v3.1) ---
        this.snapT = 0; // Timer para el shake de impacto
        
        this.setupInteraction();
    }
    
    // Helpers para compatibilidad y legibilidad
    get isBroken() { return this.state === this.STATE.BROKEN || this.state === this.STATE.DRAGGING; }
    get isDragging() { return this.state === this.STATE.DRAGGING; }
    get isRepaired() { return this.state === this.STATE.REPAIRED || this.state === this.STATE.DONE; }

    // --- MOTOR DE INTERACCIÓN (MOUSE/TOUCH) ---
    setupInteraction() {
        this.canvas.addEventListener('mousedown', (e) => {
            this.wakeUp(); 
            if (this.state !== this.STATE.BROKEN) return;
            
            const lastNode = this.anchorNodes[this.nodeCount - 1];
            const dist = Math.hypot(e.clientX - lastNode.x, e.clientY - lastNode.y);
            
            if (dist < 80) { 
                this.transitionToState(this.STATE.DRAGGING);
                this.mouseX = e.clientX;
                this.mouseY = e.clientY;
                document.body.style.cursor = 'grabbing';
            }
        });

        window.addEventListener('mousemove', (e) => {
            if (this.state === this.STATE.DRAGGING) {
                this.mouseX = e.clientX;
                this.mouseY = e.clientY;
            } else if (this.state === this.STATE.BROKEN) {
                const lastNode = this.anchorNodes[this.nodeCount - 1];
                const dist = Math.hypot(e.clientX - lastNode.x, e.clientY - lastNode.y);
                document.body.style.cursor = dist < 80 ? 'grab' : 'default';
            }
        });

        window.addEventListener('mouseup', (e) => {
            if (this.state === this.STATE.DRAGGING) {
                document.body.style.cursor = 'default';
                
                // SNAP usando coordenadas visuales guardadas durante el frame
                const targetX = this.snapTargetX;
                const targetY = this.snapTargetY;
                
                if (targetX !== undefined) {
                    const distToO = Math.hypot(this.mouseX - targetX, this.mouseY - targetY);
                    console.log(`[SNAP] dist=${Math.round(distToO)} mouse=(${Math.round(this.mouseX)},${Math.round(this.mouseY)}) target=(${Math.round(targetX)},${Math.round(targetY)})`);
                    
                    if (distToO < 80) {
                        this.transitionToState(this.STATE.REPAIRED, { targetX, targetY });
                    } else {
                        this.transitionToState(this.STATE.BROKEN);
                    }
                } else {
                    this.transitionToState(this.STATE.BROKEN);
                }
            }
        });

        window.addEventListener('scroll', () => {
            this.wakeUp();
        });
    }

    transitionToState(newState, data = {}) {
        const oldState = this.state;
        if (oldState === newState) return;

        console.log(`SILK: Transition [${oldState}] -> [${newState}]`);
        this.state = newState;

        // --- LÓGICA DE ENTRADA AL ESTADO ---
        switch (newState) {
            case this.STATE.BROKEN:
                this.canvas.style.pointerEvents = 'auto';
                this.oConsumed = false; // Reset al romper para permitir re-intento
                if (oldState === this.STATE.INTACT) {
                    // EL QUIEBRE INICIAL
                    this.snapT = 15;
                    this.anchorNodes.forEach((n, i) => {
                        if (i > 0) {
                            n.oldY = n.y - 12;
                            n.oldX += (Math.random() - 0.5) * 15;
                        }
                    });
                    
                    
                    const pElement = this.hangingTarget.parentElement;
                    const rectO = this.hangingTarget.getBoundingClientRect();
                    const currentOY = rectO.top + rectO.height / 2;
                    const landingY = window.innerHeight - 100; // ZONA DE INTERACCIÓN SEGURA
                    
                    const dropDist = landingY - currentOY;
                    this.lastDropDist = dropDist;

                    // GHOST SHIP: Sincronización física con aterrizaje controlado
                    this.targetYOffset = dropDist;
                    this.yVelocity = 4.5; // Caída más rápida y decidida
                    this.targetAngle = 3; 
                    this.snapT = 30;     

                    // HANDOVER INMEDIATO: El DOM desaparece para que se vea el Canvas caer
                    this.hangingTarget.style.color = 'transparent';
                    const targetO = document.getElementById('target-o');
                    if (targetO) targetO.style.color = 'transparent';
                }
                break;

            case this.STATE.DRAGGING:
                // El motor solo actualiza mouseX/Y, no requiere lógica extra de entrada
                break;

            case this.STATE.REPAIRED:
                this.repairScrollY = window.scrollY;
                this.repairStartTime = Date.now();
                this.canvas.style.pointerEvents = 'none';
                this.liftStarted = false; // Control de fase secuencial

                // Captura de tensión para feedback físico
                const rect = this.hangingTarget.getBoundingClientRect();
                const tx = data.targetX || (rect.left);
                const ty = data.targetY || (rect.top + rect.height / 2 + this.yOffset);
                this.repairStartDist = Math.hypot(rect.left - tx, (rect.top + rect.height / 2 + this.yOffset) - ty);

                // WHIP SNAP (v15.0): Impulso para que el hilo se recoja al conectar.
                const whipStrength = 15;
                this.anchorNodes.forEach((n, i) => {
                    if (i > 0 && i < this.nodeCount - 1) {
                        const dx = tx - n.x;
                        const dy = ty - n.y;
                        const dist = Math.hypot(dx, dy);
                        n.oldX = n.x - (dx / (dist || 1)) * whipStrength;
                        n.oldY = n.y - (dy / (dist || 1)) * whipStrength;
                    }
                });

                // No seteamos targetYOffset aún para permitir la fase de tensión (tug)
                this.finalLiftedDist = (this.lastDropDist || 0) * 0.7;
                
                // Desvanecemos el texto del DOM para el consumo por Canvas
                this.hangingTarget.style.color = 'transparent';
                const targetO = document.getElementById('target-o');
                if (targetO) targetO.style.color = 'transparent';
                break;
        }
    }

    wakeUp() {
        this.isSleeping = false;
        this.framesInactive = 0;
    }

    // --- HITBOXES (v5.0) ---
    // Recibe los rectángulos de colisión desde el DOM centralizado
    setCollisionRects(rects) {
        this.collisionRects = rects;
    }

    // Motor de Colisiones de Alta Frecuencia (v5.9)
    resolveCollisions(nodes) {
        if (!this.collisionRects || this.collisionRects.length === 0) return;
        const scrollDelta = this.isRepaired ? (this.repairScrollY - window.scrollY) : 0;

        const limit = nodes.length;
        for (let i = 1; i < limit - 1; i++) { 
            const n = nodes[i];
            const renderX = n.x;
            const renderY = n.y + scrollDelta;

        for (const rect of this.collisionRects) {
            // SYNC GHOST SHIP: Si el rect pertenece a este párrafo (marcado por id o clase),
            // le aplicamos el yOffset para que la colisión siga al Canvas.
            const isOwnRect = rect.isTarget || false;
            
            // AMNISTÍA DE REPARACIÓN (v12.5): No colisionamos con el objetivo si el hilo está roto
            // Esto evita que "repela" el hilo cuando intentamos conectarlo a la 'O'.
            if (isOwnRect && this.isBroken) continue;

            const rTop = isOwnRect ? rect.top + this.yOffset : rect.top;
            const rBot = isOwnRect ? rect.bottom + this.yOffset : rect.bottom;

            if (renderX > rect.left && renderX < rect.right &&
                renderY > rTop && renderY < rBot) {
                
                const dTop = Math.abs(renderY - rTop);
                const dBot = Math.abs(renderY - rBot);
                const dLeft = Math.abs(renderX - rect.left);
                const dRight = Math.abs(renderX - rect.right);
                const minDist = Math.min(dTop, dBot, dLeft, dRight);

                if (minDist === dTop) {
                    n.y = rTop - scrollDelta;
                }
                else if (minDist === dBot) n.y = rBot - scrollDelta;
                    else if (minDist === dLeft) n.x = rect.left;
                    else if (minDist === dRight) n.x = rect.right;
                    
                    // Sincronizamos la inercia (Soft-Kill vertical)
                    n.oldY = n.y - (n.y - n.oldY) * 0.1; 
                }
            }
        }
    }

    setup() {
        this.chars = [];
        const range = document.createRange();

        // Estilo base desde el primer contenedor
        const fontStyle = getComputedStyle(this.mainContainer);
        this.fontString = fontStyle.font;
        let color = fontStyle.color;
        if (color === "rgba(0, 0, 0, 0)" || color === "transparent" || color === "rgb(255, 255, 255)") {
            color = "#0d0900";
        }
        this.textColor = color;

        let charGlobalIndex = 0;
        this.elements.forEach((entry, elementIdx) => {
            const el = entry.el;
            const textContent = entry.text;
            
            // Forzamos el texto en el elmento para medirlo
            el.innerText = textContent;
            const textNode = el.firstChild;
            if (!textNode) return;

            const elRect = el.getBoundingClientRect();

            for (let i = 0; i < textContent.length; i++) {
                try {
                    range.setStart(textNode, i);
                    range.setEnd(textNode, i + 1);
                    const rects = range.getClientRects();
                    if (rects.length > 0) {
                        const rect = rects[0];
                        this.chars.push({
                            char: textContent[i],
                            homeX: rect.left + rect.width / 2 - elRect.left,
                            homeY: rect.top + rect.height / 2 - elRect.top,
                            el: el,
                            curX: rect.left + rect.width / 2, // Posicionamiento absoluto inmediato
                            curY: rect.top + rect.height / 2,
                            opacity: 1,
                            isVisible: (textContent[i].trim() !== "")
                        });
                    }
                } catch (e) {}
            }
        });

        this.totalChars = this.chars.length;

        // Búsqueda robusta de la 'H' de "Hélene" para el relevo
        for (let i = 0; i < this.totalChars - 5; i++) {
            if (this.chars[i].char === 'H' && 
                this.chars[i+1].char === 'é' && 
                this.chars[i+2].char === 'l' && 
                this.chars[i+3].char === 'e' && 
                this.chars[i+4].char === 'n' && 
                this.chars[i+5].char === 'e') {
                this.chars[i].isRelayNode = true;
                break;
            }
        }

        // Fija la J del corte de P1 como el ancla inicial de HUD (ignora la J de P0)
        if (this.limitIndex !== -1 && this.chars[this.limitIndex]) {
            this.chars[this.limitIndex].isHUDAnchor = true;
        }

        // INICIALIZACIÓN DE NODOS (v7.2): Evitamos el salto desde (0,0)
        if (this.totalChars > 0) {
            const startX = window.innerWidth * 0.05;
            const startY = window.innerHeight * 0.15;
            const endX = this.chars[0].curX;
            const endY = this.chars[0].curY;

            for (let i = 0; i < this.nodeCount; i++) {
                const t = i / (this.nodeCount - 1);
                const x = startX + (endX - startX) * t;
                const y = startY + (endY - startY) * t;
                this.nodes[i].x = this.nodes[i].oldX = x;
                this.nodes[i].y = this.nodes[i].oldY = y;
                
                // Inicializamos también el vínculo para evitar sobresaltos
                this.linkNodes[i].x = this.linkNodes[i].oldX = x;
                this.linkNodes[i].y = this.linkNodes[i].oldY = y;
            }
        }

        this.enrollmentProgress = 0; // v23.0 - Metáfora del ovillo (Enrollment)
        this.enrollmentStarted = false;
        
        this.isInitialized = true;

        // IDENTIFICACIÓN DE HITOS (v10.0): Para hilos guía y vínculos
        this.p0LastCharIdx = -1;
        this.p1FirstCharIdx = -1;
        this.snapCharIdx = -1; // <- primer char de hangingTarget (la 'O')

        for (let i = 0; i < this.chars.length; i++) {
            // Último de P0
            if (this.chars[i].el === this.elements[0].el) {
                this.p0LastCharIdx = i;
            }
            // Primero de P1 (si existe) - usado para física del puente
            if (this.elements[1] && this.p1FirstCharIdx === -1 && this.chars[i].el === this.elements[1].el) {
                this.p1FirstCharIdx = i;
            }
            // PRIMER CHAR DEL TARGET 'O' (hangingTarget = spanEstatica)
            // Este es el punto de conexión real - distinto de p1FirstCharIdx (que es spanSeda)
            if (this.snapCharIdx === -1 && this.hangingTarget && this.chars[i].el === this.hangingTarget) {
                this.snapCharIdx = i;
            }
        }
    }

    resize() {
        const dpr = window.devicePixelRatio || 1;
        const vW = window.innerWidth;
        const vH = window.innerHeight;

        this.canvas.width = vW * dpr;
        this.canvas.height = vH * dpr;
        this.ctx.setTransform(1, 0, 0, 1, 0, 0); 
        this.ctx.scale(dpr, dpr);
    }

    update(progress, targetX, targetY, rect = null) {
        if (!this.isInitialized) { this.setup(); if (!this.isInitialized) return; }

        // v25.0: Proactive Enrollment (Auto-Ovillo Off-Screen)
        // Solo adelantamos si TODO el sistema (P0 y P1) está fuera de vista.
        const isBlockInView = this.elements.some(entry => {
            const r = entry.el.getBoundingClientRect();
            return (r.bottom > -400 && r.top < window.innerHeight + 400);
        });

        if (!isBlockInView) {
            if (this.state === this.STATE.DONE || (this.isRepaired && progress > 1.9)) {
                this.enrollmentProgress = 1.0;
                this.enrollmentStarted = true;
            }
        }

        if (!this.hasResized) { this.resize(); this.hasResized = true; }

        // Calculamos velocidad de scroll SIEMPRE para mantener el delta correcto
        const currentScroll = window.scrollY;
        this.scrollVelocity = (currentScroll - this.lastScrollY) * 0.95; 
        this.lastScrollY = currentScroll;

        // --- TRAVEL ZONE GUARD ---
        // El silk canvas es un overlay fijo que cubre todo el viewport (z-index 20).
        // Cuando el usuario llega a una zona de viaje (mar o tierra), lo ocultamos
        // para que los sistemas de Ocean/Land sean completamente visibles.
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
            if (inTravelZone) {
                this.canvas.style.pointerEvents = 'none';
                return; // No renderizamos nada mientras hay zona de viaje en pantalla
            }
        }

        // OPTIMIZACIÓN CULLING: Si está reparado y fuera de pantalla, ahorramos CPU
        if (this.isRepaired) {
            // Chequeamos si alguno de los contenedores está en vista
            const isInView = this.elements.some(entry => {
                const rect = entry.el.getBoundingClientRect();
                return (rect.bottom > -200 && rect.top < window.innerHeight + 200);
            });
            // v25.0: Si no está en vista PERO el ovillo está empezando o terminado, NO retornamos
            // para permitir que el ancla del HUD siga renderizándose.
            if (!isInView && !this.enrollmentStarted && this.state !== this.STATE.DONE) return; 
        }

        // --- BLOQUEO DE ESTADO FINAL (LOCK) ---
        // Si ya terminamos todo el bloque, congelamos el progreso al final (2.0)
        // para evitar que el scroll inverso vuelva a deshilachar lo ya consumido.
        if (this.state === this.STATE.DONE) {
            progress = 1.999;
        }

        // FIX 1: Una vez que el tejido se rompe, la animación no tiene marcha atrás.
        // Si está roto Y NO REPARADO, progress se ancla en el límite (1.0).
        if (this.isBroken && !this.isRepaired) {
            progress = 1.0;
        }

        // FIX DEADZONE: Garantiza que el poema se quede estático y no salte de golpe tras conectarse.
        // Absorbe la inercia del scroll residual (trackpads mac/windows) y ancla las letras visualmente 
        // hasta que haya una acción deliberada y palpable de scroll del usuario (del 2%).
        if (this.isRepaired && !this.postRepairScrollStarted) {
            if (progress > 1.02) {
                this.postRepairScrollStarted = true;
            } else {
                progress = 1.0;
            }
        }

        // --- FÍSICAS GHOST SHIP CINEMÁTICAS (v14.0) ---
        // Dinamizamos constantes segun el estado para dar "carácter" físico.
        let currentSpring = this.ySpring;
        let currentDamping = this.yDamping;

        if (this.isBroken && !this.isRepaired) {
            // CAÍDA PESADA: Menos elástica, más fricción para un aterrizaje seco.
            currentSpring = 0.04;
            currentDamping = 0.75; 
        } else if (this.isRepaired) {
            const age = Date.now() - this.repairStartTime;
            if (age < 350) {
                // ETAPA 1: TENSIÓN — leve vibración orgánica antes del ascenso
                this.targetYOffset = this.lastDropDist; 
                currentSpring = 0.01;
                currentDamping = 0.90; // Amortiguamiento para limpiar la inercia del arrastre
                // Jitter orgánico de tensión
                this.yVelocity += (Math.random() - 0.5) * 1.2; 
            } else {
                // ETAPA 2: ASCENSO MUCHO MÁS SUTIL — aterrizaje de "gravedad cero"
                if (!this.liftStarted) {
                    this.targetYOffset = this.finalLiftedDist;
                    this.yVelocity = -1.2;  // Impulso mínimo, casi imperceptible
                    this.targetAngle = 0;
                    this.liftStarted = true;
                }
                currentSpring = 0.035; // Muelle muy suave para un retorno lento
                currentDamping = 0.88; // Mucha fricción para que el rebote sea apenas un suspiro
            }
        }

        const springForce = (this.targetYOffset - this.yOffset) * currentSpring;
        this.yVelocity += springForce;
        this.yVelocity *= currentDamping;
        this.yOffset += this.yVelocity;

        // Suavizado del ángulo
        this.angleOffset += (this.targetAngle - this.angleOffset) * 0.1;

        const ctx = this.ctx;
        const dpr = window.devicePixelRatio || 1;
        ctx.clearRect(0, 0, this.canvas.width / dpr, this.canvas.height / dpr);

        ctx.save();

        const effectiveTotal = (this.limitIndex !== -1) ? this.limitIndex + 1 : this.totalChars;
        
        // --- MAPEADO DE PROGRESO LÓGICO ---
        let scaledProgress = 0;
        const phaseTotal = (this.limitIndex !== -1) ? this.limitIndex + 1 : this.totalChars;
        
        if (progress <= 1.0) {
            // Dedicamos el 90% del scroll a P0 y solo el último 10% a P1 PRE-CORTE
            let mappedProgress = progress;
            if (this.p0LastCharIdx !== -1 && this.p0LastCharIdx < phaseTotal - 1) {
                const boundaryProg = (this.p0LastCharIdx + 1) / phaseTotal;
                if (progress < 0.9) {
                    mappedProgress = (progress / 0.9) * boundaryProg;
                } else {
                    mappedProgress = boundaryProg + ((progress - 0.9) / 0.1) * (1 - boundaryProg);
                }
            }
            scaledProgress = mappedProgress * phaseTotal;
        } else {
            // POST-COSTURA (progress > 1.0): 
            // Avanza linealmente hacia el fin del párrafo
            const remainingChars = this.totalChars - phaseTotal;
            // Evaluamos progress - 1.0 (que va de 0 a 1 debido a que setMaxProgress ahora es 2.0)
            scaledProgress = phaseTotal + (progress - 1.0) * remainingChars;
        }

        // --- LOCK DE REGENERACIÓN (v9.5) ---
        // Si ya estamos en estado DONE, ignoramos por completo el progress externo
        // y forzamos que todas las letras estén consumidas permanentemente.
        if (this.state === this.STATE.DONE) {
            scaledProgress = this.totalChars;
            // v23.0: Iniciamos la metáfora del ovillo
            if (!this.enrollmentStarted) {
                this.enrollmentStarted = true;
            }
            if (this.enrollmentProgress < 1.0) {
                this.enrollmentProgress += 0.02; // Velocidad de enrollado más fluida para evitar sensación de lag/bug
                if (this.enrollmentProgress >= 1.0) {
                    this.enrollmentProgress = 1.0;
                    this.snapT = 0; // Sin jitter final para evitar rebote brusco
                }
            }
        }
        
        const currentIdx = Math.floor(scaledProgress);
        const stepProgress = scaledProgress % 1;
        
        // --- DETECTOR DE RELEVO DE ANCLA (J -> H) ---
        if (this.isRepaired && !this.relayTriggered && this.chars[currentIdx] && this.chars[currentIdx].isRelayNode) {
            this.relayTriggered = true;
            this.snapT = 12; // Micro-shake para dar feedback del relevo
            
            // Relevamos el anclaje: Destruimos la J anterior y coronamos la H
            this.chars.forEach(c => c.isHUDAnchor = false);
            this.chars[currentIdx].isHUDAnchor = true;
        }

        // --- CIERRE DE CICLO (TRANSICIÓN A DONE) ---
        // Si ya se activó el relevo y llegamos al final práctico del párrafo (95%)
        // o si scaledProgress ya cubrió todas las letras.
        const isPhysicallyDone = (scaledProgress >= this.totalChars - 1);
        if (this.relayTriggered && (progress >= 1.95 || isPhysicallyDone) && this.state !== this.STATE.DONE) {
            this.transitionToState(this.STATE.DONE);
        }

        const dX = (typeof targetX === 'number') ? targetX : window.innerWidth * 0.05;
        const dY = (typeof targetY === 'number') ? targetY : window.innerHeight * 0.15;

        ctx.font = this.fontString;
        ctx.fillStyle = this.textColor;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        let mainAnchor = this.chars[Math.min(currentIdx, this.totalChars - 1)];
        if (mainAnchor && !mainAnchor.isVisible) {
            for (let k = currentIdx + 1; k < this.totalChars; k++) {
                if (this.chars[k].isVisible) { mainAnchor = this.chars[k]; break; }
            }
        }

        if (mainAnchor) {
            // v19.0: Retrasamos la activación de P1 para permitir que el puente siga al último carácter de P0
            // mientras vuela al margen. El cambio real ocurre solo cuando P1 empieza su deshilachado.
            const isP1Active = (this.p1FirstCharIdx !== -1 && currentIdx > this.p1FirstCharIdx);
            const wasP1Active = (this.p1FirstCharIdx !== -1 && this.lastIdx > this.p1FirstCharIdx);
            
            // Handover point: P0 terminado y P1 por empezar (0.9 a 0.91 aprox)
            const isHandoverPhase = (this.p1FirstCharIdx !== -1 && currentIdx === this.p1FirstCharIdx);

            if (isP1Active && !wasP1Active) {
                // FORWARD HANDOVER...
                // CONTINUIDAD FÍSICA PERFECTA: Si cruzamos el límite tras una rotura/costura interactiva,
                // debemos heredar las físicas y posición espacial de 'anchorNodes' (el hilo rojo y tirante que arrastró el usuario),
                // no del 'linkNodes' que es puramente un puente lógico fantasma. Esto evita un glitch espacial.
                const sourceNodes = this.isRepaired ? this.anchorNodes : this.linkNodes;
                
                for(let i = 0; i < this.nodeCount; i++) {
                    this.nodes[i].x = sourceNodes[i].x;
                    this.nodes[i].y = sourceNodes[i].y;
                    this.nodes[i].oldX = sourceNodes[i].oldX;
                    this.nodes[i].oldY = sourceNodes[i].oldY;
                }
            } else if (!isP1Active && wasP1Active) {
                // REVERSE HANDOVER: El usuario scrollea hacia arriba de P1 a P0. Vínculo hereda inercia.
                for(let i = 0; i < this.nodeCount; i++) {
                    this.linkNodes[i].x = this.nodes[i].x;
                    this.linkNodes[i].y = this.nodes[i].y;
                    this.linkNodes[i].oldX = this.nodes[i].oldX;
                    this.linkNodes[i].oldY = this.nodes[i].oldY;
                }
            }
            this.lastIdx = currentIdx;
            
            // v22.0: REMANENTE COLGANTE (Post-Relay)
            // Cuando llegamos al final de P0, el hilo no desaparece; queda colgando de la H.
            let targetXNodes = mainAnchor.curX;
            let targetYNodes = mainAnchor.curY;
            
            const isEndOfP0 = (currentIdx >= this.totalChars - 1.5);
            if (isEndOfP0 || this.state === this.STATE.DONE) {
                // v23.0: Metáfora del ovillo - El punto final se repliega hacia el ancla (dX, dY)
                const hangLength = 60 * (1 - this.enrollmentProgress);
                targetXNodes = dX;
                targetYNodes = dY + hangLength;
            } else if (isHandoverPhase && this.p0LastCharIdx !== -1 && this.chars[this.p0LastCharIdx]) {
                const endChar = this.chars[this.p0LastCharIdx];
                targetXNodes = endChar.curX;
                targetYNodes = endChar.curY;
            }

            this.updatePhysics(this.nodes, dX, dY, targetXNodes, targetYNodes);
            
            // 1. HILO MAESTRO (Tramo Margen -> Punto Activo de P0)
            this.drawSilkPath(ctx, this.nodes, "#4a7a9e", null); 
            
            // 2. VÍNCULO NARRATIVO: Puente visible P0 -> P1
            // v19.0: Ahora el puente se dibuja también durante la fase de handover para una unión fluida.
            // v20.0: Solo dibujamos el puente si NO es P1_ACTIVE para evitar duplicados en el tramo principal.
            if ((!isP1Active || isHandoverPhase) && this.p0LastCharIdx !== -1 && this.chars[this.p0LastCharIdx]) {
                const endChar = this.chars[this.p0LastCharIdx];
                if (this.p1FirstCharIdx !== -1 && this.chars[this.p1FirstCharIdx]) {
                    const startP1 = this.chars[this.p1FirstCharIdx];
                    this.updatePhysics(this.linkNodes, endChar.curX, endChar.curY, startP1.curX, startP1.curY);
                    
                    // Durante handover, usamos el mismo azul para que parezca una sola cuerda continua
                    const bridgeColor = isHandoverPhase ? "#4a7a9e" : "#8a9aae";
                    this.drawSilkPath(ctx, this.linkNodes, bridgeColor, null);
                }
            }
        }

        const fSizeMatch = this.fontString.match(/\d+(\.\d+)?/);
        const baseSize = fSizeMatch ? parseFloat(fSizeMatch[0]) : 16;
        const jFont = `700 ${baseSize * 1.25}px "Courier New", monospace`;

        // CACHE DE RECTS: evitamos getBoundingClientRect() por char (cientos de reflows/frame)
        // Medimos cada elemento UNA SOLA VEZ por frame y reutilizamos.
        const rectCache = new Map();
        const getRect = (el) => {
            if (!rectCache.has(el)) rectCache.set(el, el.getBoundingClientRect());
            return rectCache.get(el);
        };

        this.chars.forEach((c, i) => {
            const isFrayLimit = (this.limitIndex !== -1 ? i === this.limitIndex : i === this.chars.length - 1); 
            // Usamos el rect cacheado del elemento (una sola medición por elemento por frame)
            const charRect = getRect(c.el);
            
            // APLICAMOS yOffset GHOST SHIP: El DOM permanece estático, el Canvas lo mueve
            const sX = charRect.left + c.homeX;
            // APLICAMOS INCLINACIÓN (v12.0): Rotamos virtualmente sobre el punto de anclaje de la 'J'
            const tiltY = (sX - dX) * (this.angleOffset * Math.PI / 180);
            const sY = charRect.top + c.homeY + this.yOffset + tiltY;
            
            // Guardamos orígenes reales del frame para el comparador de física inercial de arrastre
            c.renderedSX = sX;
            c.renderedSY = sY;

            if (i < currentIdx) {
                const isLastArrived = (i === Math.floor(currentIdx) - 1);
                const isMarked = (this.limitIndex !== -1 && i === this.limitIndex);
                
                // DISIPACIÓN (v17.1): Los caracteres de P0 se desvanecen al llegar al margen
                // para no ensuciar la lectura de P1.
                const distToMargin = Math.hypot(c.curX - dX, c.curY - dY);
                let dissipation = Math.max(0, Math.min(1, distToMargin / 50));
                
                // Si el relevo fue activado, hacemos que todos los demás caracteres desaparezcan
                // para dejar lugar a la única protagonista visible: la 'H'
                if (this.relayTriggered && !c.isHUDAnchor) {
                    c.opacity = 0;
                } else {
                    // --- RELEVO INTELIGENTE (Smart Relay v15.5) ---
                    // Recuperamos el baile secuencial de letras sin el amontonamiento negro.
                    
                    const isLastArrived = (i === Math.floor(currentIdx) - 1);
                    const isJ = (this.limitIndex !== -1 && i === this.limitIndex);
                    const isH = c.isRelayNode || (i === this.chars.length - 1); // Búsqueda robusta

                    if (this.relayTriggered) {
                        // FASE 3: La 'H' tomó el relevo permanente. Es la única visible.
                        // No desaparece aunque termine el deshilachado.
                        c.opacity = isH ? 1 : 0;
                    } else if (this.limitIndex !== -1 && currentIdx > this.limitIndex) {
                        // FASE 2: La 'J' llegó y se queda fija. Todo lo demás se oculta al llegar.
                        c.opacity = isJ ? 1 : 0;
                    } else {
                        // FASE 1: Las letras se van reemplazando secuencialmente hasta llegar a la J.
                        c.opacity = isLastArrived ? 1 : 0;
                    }
                }

                c.curX = dX;
                c.curY = dY;
            } else if (i === currentIdx) {
                const t = stepProgress;
                const elastic = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
                c.curX = sX + (dX - sX) * elastic;
                c.curY = sY + (dY - sY) * elastic;
                const isMarked = (this.limitIndex !== -1 && i === this.limitIndex);
                c.opacity = isMarked ? 1 : Math.max(0, Math.min(1, (0.95 - elastic) * 10));
            } else {
                const distFromActive = i - currentIdx;
                
                if (distFromActive < 10 && c.isVisible) { 
                    let prevChar = null;
                    let prevIdx = -1;
                    // Buscamos la última letra visible
                    for (let k = i - 1; k >= 0; k--) {
                        if (this.chars[k].isVisible) {
                            prevChar = this.chars[k];
                            prevIdx = k;
                            break;
                        }
                    }

                    if (prevChar) {
                        const sameLine = Math.abs(prevChar.homeY - c.homeY) < 15;
                        // MAGIA: Si la diferencia de índice es 1, están pegadas (misma palabra)
                        const isSameWord = (i - prevIdx === 1); 
                        
                        // FIX: Prevenir que la tensión física "corte" deforme el interletraje natural 
                        // entre P0 (termina en J) y P1 (empieza en O) mientras P1 está estático.
                        const crossLimit = (this.limitIndex !== -1 && prevIdx <= this.limitIndex && i > this.limitIndex);

                        if (sameLine && !crossLimit) {
                            const tensionFactor = 1 - (distFromActive / 10);
                            const distVisual = Math.hypot(c.curX - prevChar.curX, c.curY - prevChar.curY);
                            
                            if (isSameWord) {
                                // HILO DE LETRA (Intra-palabra): Transmisión de fuerza por desplazamiento.
                                // Usamos el Delta del carácter anterior respecto a su origen (rendered), no 
                                // respecto al carácter actual, para evitar que colapse el Interletraje en reposo absoluto.
                                const despX = prevChar.curX - (prevChar.renderedSX || prevChar.curX);
                                const despY = prevChar.curY - (prevChar.renderedSY || prevChar.curY);
                                c.curX = sX + despX * (0.25 * tensionFactor);
                                c.curY = sY + despY * (0.25 * tensionFactor);
                                this.drawThread(ctx, prevChar.curX, prevChar.curY, c.curX, c.curY, 0.3 * tensionFactor);
                            } else {
                                // HILO DE PALABRA (Puente de Espacio): Tira suave y se estira
                                if (distVisual < 45) { // SNAP! Se rompe si la palabra anterior ya voló
                                    const despX = prevChar.curX - (prevChar.renderedSX || prevChar.curX);
                                    const despY = prevChar.curY - (prevChar.renderedSY || prevChar.curY);
                                    c.curX = sX + despX * (0.05 * tensionFactor);
                                    c.curY = sY + despY * (0.05 * tensionFactor);
                                    this.drawThread(ctx, prevChar.curX, prevChar.curY, c.curX, c.curY, 0.15 * tensionFactor);
                                } else {
                                    // El puente se rompió, la letra espera tranquila su turno
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
                
                // NOT YET REACHED (Aún estático en el DOM/Canvas)
                const isAfterLimit = (this.limitIndex !== -1 && !this.isRepaired && i > this.limitIndex);
                if (isAfterLimit) {
                    // Solo el cuerpo que cae es tenue. No las letras ya deshilachadas.
                    c.opacity = this.isBroken ? 0.6 : 0; 
                } else {
                    // Comportamiento normal (v12.0)
                    c.opacity = (this.isRepaired || !this.isBroken) ? 1 : 0;
                }
            }

            // --- LÓGICA MAESTRA: LA CAÍDA Y LA COSTURA ---
            if (isFrayLimit && this.hangingTarget) {
                const range = document.createRange();
                if (this.hangingTarget.firstChild) {
                    range.setStart(this.hangingTarget.firstChild, 0);
                    range.setEnd(this.hangingTarget.firstChild, 1);
                    const rect = range.getBoundingClientRect();
                    
                    const distMoved = Math.hypot(c.curX - sX, c.curY - sY);
                    
                    // 1. EL QUIEBRE (SNAP!)
                    // Si el progreso es casi total y aún no se ha roto
                    if (progress > 0.99 && this.state === this.STATE.INTACT) {
                        this.transitionToState(this.STATE.BROKEN);
                    }

                    // 2. OBJETIVO DEL HILO
                    // La posición visual (con yOffset+tilt) se lee desde curX/Y del char
                    // después del forEach. Aquí usamos el valor del frame anterior (1 frame de lag,
                    // imperceptible) para la física del hilo.
                    let targetX = (this.snapTargetX !== undefined) ? this.snapTargetX : (rect.left + rect.width / 2);
                    let targetY = (this.snapTargetY !== undefined) ? this.snapTargetY : (rect.top + rect.height / 2 + this.yOffset);

                    let distRealToO = 1000;
                    this.magneticEase = 0;

                    if (this.isBroken) {
                        if (this.isDragging) {
                            // MAGNETISMO usando la posición visual correcta (ya calculada arriba)
                            distRealToO = Math.hypot(this.mouseX - this.snapTargetX, this.mouseY - this.snapTargetY);
                            const proximity = Math.max(0, 1 - (distRealToO / 250));
                            this.magneticEase = proximity * proximity;
                            
                            targetX = this.mouseX + (this.snapTargetX - this.mouseX) * this.magneticEase;
                            targetY = this.mouseY + (this.snapTargetY - this.mouseY) * this.magneticEase;
                        } else {
                            targetX = c.curX + (Math.sin(Date.now() * 0.003) * 15); 
                            targetY = c.curY + 150; 
                        }
                    }

                    if (this.isRepaired) this.magneticEase = 1.0; 

                    // --- RELEVAMIENTO DE HITBOXES Y FÍSICAS ---
                    // El DOM aquí es solo un sensor de scroll y referencia estática.

                    // 3. ACTUALIZACIÓN DE FÍSICAS (Con sincronización de coordenadas locales)
                    const scrollOffset = this.isRepaired ? (this.repairScrollY - window.scrollY) : 0;
                    
                    // Solo dibujamos la caída o el hilo fijo si aún no reanudamos el deshilachado post-costura
                    const isFrayingPastCut = this.isRepaired && progress > 1.0;

                    if (!isFrayingPastCut) { 
                        if (distMoved > 2 || this.isBroken || this.isRepaired) {
                            this.updateAnchorPhysics(dX, dY, targetX, targetY, this.isBroken);
                            this.drawAnchorSilk(ctx, this.isBroken);
                        }
                    }
                }
            }

            if (c.opacity > 0) {
                ctx.globalAlpha = c.opacity;
                
                const isAnchor = c.isHUDAnchor;
                if (isAnchor) {
                    if (this.hideHUDAnchor) return; // v35.1: Takeover by CompasTension
                    // LETRA ANCLA: ligeramente más grande y semi-bold para dar jerarquía
                    // Azul seda solo cuando está en su posición final (REPAIRED)
                    const anchorColor = this.isRepaired ? "#4a7a9e" : "#3a3a3a";
                    ctx.font = `600 ${baseSize * 1.15}px "Courier New", monospace`;
                    ctx.fillStyle = anchorColor;
                } else {
                    ctx.font = this.fontString;
                    ctx.fillStyle = this.textColor;
                }

                let sOffX = 0, sOffY = 0;
                if (this.snapT > 0) {
                    sOffX = (Math.random() - 0.5) * (this.snapT * 0.5);
                    sOffY = (Math.random() - 0.5) * (this.snapT * 0.5);
                    this.snapT--;
                    if (this.snapT <= 0) this.isSnapping = false;
                }

                ctx.fillText(c.char, c.curX + sOffX, c.curY + sOffY);
            }
        });

        // Ghost Ship: actualiza el target de la 'O' SIEMPRE (no solo cuando roto).
        // Así el extremo del hilo sigue a la 'O' mientras el párrafo sube (REPAIRED).
        if (this.state !== this.STATE.DONE && this.snapCharIdx >= 0 && this.chars[this.snapCharIdx]) {
            const oChar = this.chars[this.snapCharIdx];
            this.snapTargetX = oChar.curX;
            this.snapTargetY = oChar.curY;

            // v31.2: Detección de colisión "O" con "J" (el margen dX, dY)
            if (this.isRepaired && !this.oConsumed) {
                const distToJ = Math.hypot(oChar.curX - dX, oChar.curY - dY);
                if (distToJ < 10) {
                    this.oConsumed = true;
                }
            }
        }

        // === 'O' / 'J': EMPAREJAMIENTO VISUAL ===
        if (this.snapCharIdx >= 0 && !this.oConsumed) {
            const oChar = this.chars[this.snapCharIdx];
            if (oChar) {
                // El estilo de destino es el mismo que el de la letra ancla J
                const anchorFont = `600 ${baseSize * 1.15}px "Courier New", monospace`;
                const anchorColor = "#4a7a9e";
                
                if (this.isRepaired) {
                    // CONECTADAS: la O es idéntica a la J
                    ctx.globalAlpha = 1;
                    ctx.font = anchorFont;
                    ctx.fillStyle = anchorColor;
                    ctx.textAlign = "center";
                    ctx.textBaseline = "middle";
                    ctx.fillText(oChar.char, oChar.curX, oChar.curY);
                } else if (this.isBroken) {
                    // ACERCÁNDOSE: la O anima hacia el estilo de la J
                    const t = this.magneticEase;
                    const weight = t > 0.4 ? '600' : 'normal';
                    const size = baseSize + (baseSize * 0.15 * t); // crece hacia 1.15x
                    ctx.globalAlpha = 1;
                    ctx.font = `${weight} ${size}px "Courier New", monospace`;
                    ctx.fillStyle = t > 0.25 ? anchorColor : this.textColor;
                    ctx.textAlign = "center";
                    ctx.textBaseline = "middle";
                    ctx.fillText(oChar.char, oChar.curX, oChar.curY);
                }
            }
        }

        ctx.restore();
        ctx.globalAlpha = 1;
    }

    updatePhysics(nodes, xStart, yStart, xEnd, yEnd) {
        if (this.isSleeping && !this.isDragging) return;
        
        const gravity = 0.12, friction = 0.94, iterations = 24;
        const relaxFactor = 1.02; // De 1.08 a 1.02 para que el hilo esté más tenso y responda mejor
        nodes[0].x = xStart; 
        nodes[0].y = yStart;
        
        const last = nodes[this.nodeCount - 1];
        last.x = xEnd; 
        last.y = yEnd;

        for (let i = 1; i < this.nodeCount - 1; i++) {
            const n = nodes[i];
            const vx = (n.x - n.oldX) * friction;
            const vy = (n.y - n.oldY) * friction;
            n.oldX = n.x; 
            n.oldY = n.y; 
            n.x += vx; 
            n.y += vy + gravity;
        }

        const totalDist = Math.hypot(xEnd - xStart, yEnd - yStart);
        const targetLen = totalDist * relaxFactor;
        const segLen = targetLen / (this.nodeCount - 1);

        for (let j = 0; j < iterations; j++) {
            for (let i = 0; i < this.nodeCount - 1; i++) {
                const p1 = nodes[i], p2 = nodes[i + 1];
                const dx = p2.x - p1.x, dy = p2.y - p1.y;
                const dist = Math.hypot(dx, dy);
                const diff = (segLen - dist) / (dist || 1);
                const offsetX = dx * diff * 0.5, offsetY = dy * diff * 0.5;
                if (i !== 0) { p1.x -= offsetX; p1.y -= offsetY; }
                if (i + 1 !== this.nodeCount - 1) { 
                    p2.x += offsetX; p2.y += offsetY; 
                }
            }
        }
    }

    drawSilkPath(ctx, nodes, color, label = null, labelOffsetY = 0) {
        ctx.save();
        ctx.fillStyle = color; 
        ctx.globalAlpha = 0.85;
        ctx.font = 'bold 10px "Courier New", monospace';
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        const dotGap = 2.5;
        let accumulator = 0;

        for (let i = 0; i < this.nodeCount - 1; i++) {
            const p1 = nodes[i];
            const p2 = nodes[Math.min(i + 1, this.nodeCount - 1)];
            const p3 = nodes[Math.min(i + 2, this.nodeCount - 1)];

            let startPtX, startPtY, cpX, cpY, endPtX, endPtY;

            if (i === 0) {
                // PRIMER SEGMENTO: Desde el primer nodo exacto hasta el punto medio del primer segmento
                startPtX = p1.x; startPtY = p1.y;
                cpX = p1.x; cpY = p1.y; // Recto al inicio
                endPtX = (p1.x + p2.x) / 2; endPtY = (p1.y + p2.y) / 2;
                
                // Forzamos el reinicio de la iteración para el primer segmento
                let arcD = Math.hypot(endPtX - startPtX, endPtY - startPtY);
                let tt = accumulator / (arcD || 1);
                while (tt < 1.0) {
                    const bx = (1-tt)*(1-tt)*startPtX + 2*(1-tt)*tt*cpX + tt*tt*endPtX;
                    const by = (1-tt)*(1-tt)*startPtY + 2*(1-tt)*tt*cpY + tt*tt*endPtY;
                    ctx.fillText('.', bx, by);
                    tt += dotGap / (arcD || 1);
                }
                accumulator = (tt - 1.0) * arcD;
            }

            const midX1 = (p1.x + p2.x) / 2;
            const midY1 = (p1.y + p2.y) / 2;
            const midX2 = (p2.x + p3.x) / 2;
            const midY2 = (p2.y + p3.y) / 2;
            const arcDist = Math.hypot(midX2 - midX1, midY2 - midY1);

            let t = accumulator / (arcDist || 1);
            while (t < 1.0) {
                const bx = (1-t)*(1-t)*midX1 + 2*(1-t)*t*p2.x + t*t*midX2;
                const by = (1-t)*(1-t)*midY1 + 2*(1-t)*t*p2.y + t*t*midY2;
                ctx.fillText('.', bx, by);
                t += dotGap / (arcDist || 1);
            }
            accumulator = (t - 1.0) * arcDist;
        }

        if (label) {
            const midIdx = Math.floor(this.nodeCount / 2);
            const midNode = nodes[midIdx];
            this.drawLabel(ctx, label, midNode.x, midNode.y + labelOffsetY, color);
        }
        ctx.restore();
    }

    drawLabel(ctx, text, x, y, color) {
        ctx.save();
        ctx.fillStyle = color;
        ctx.font = 'bold 8px "Courier New", monospace';
        ctx.globalAlpha = 0.6;
        ctx.textAlign = "center";
        ctx.fillText(text, x, y);
        ctx.restore();
    }

    drawSilk(ctx) {
        ctx.save();
        ctx.fillStyle = "#4a7a9e"; 
        ctx.globalAlpha = 0.85 * (1 - this.enrollmentProgress); // v23.0: Desvanece al enrollarse
        if (ctx.globalAlpha <= 0.01) { ctx.restore(); return; }
        ctx.font = 'bold 10px "Courier New", monospace';
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        const dotGap = 2.5;
        let accumulator = 0;

        // SUAVIZADO POR INTERPOLACIÓN: Usamos el algoritmo de punto medio (Quadratic Bezier)
        // para que los puntos sigan una curva suave y no segmentos rectos.
        for (let i = 0; i < this.nodeCount - 1; i++) {
            const p1 = this.nodes[i];
            const p2 = this.nodes[Math.min(i + 1, this.nodeCount - 1)];
            const p3 = this.nodes[Math.min(i + 2, this.nodeCount - 1)];

            // Puntos medios para la curva suave
            const midX1 = (p1.x + p2.x) / 2;
            const midY1 = (p1.y + p2.y) / 2;
            const midX2 = (p2.x + p3.x) / 2;
            const midY2 = (p2.y + p3.y) / 2;

            // Estimación de distancia del arco (aproximada para performance)
            const arcDist = Math.hypot(midX2 - midX1, midY2 - midY1);

            let t = accumulator / (arcDist || 1);
            while (t < 1.0) {
                // Ecuación Quadratic Bezier para el suavizado de la seda
                const bx = (1-t)*(1-t)*midX1 + 2*(1-t)*t*p2.x + t*t*midX2;
                const by = (1-t)*(1-t)*midY1 + 2*(1-t)*t*p2.y + t*t*midY2;
                
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

        for (let i = 0; i <= steps; i++) { // Cambiado < por <= para llegar al final exacto
            const t = i / steps;
            const bx = (1-t)*(1-t)*x1 + 2*(1-t)*t*cpX + t*t*x2;
            const by = (1-t)*(1-t)*y1 + 2*(1-t)*t*cpY + t*t*y2;
            ctx.fillText('.', bx, by);
        }
        
        ctx.restore(); 
    }

    updateAnchorPhysics(xStart, yStart, xEnd, yEnd, isBroken) {
        if (this.isSleeping && !this.isDragging) return;
        // AMORTIGUACIÓN Y FLEXIBILIDAD: Fricción alta para evitar lag percibido
        const friction = 0.92; 
        
        // MOTOR DE COHERENCIA "SEDA": Tirón inicial -> Pausa de Inercia -> Izado -> Relajación
        const repairAge = this.isRepaired ? (Date.now() - (this.repairStartTime || 0)) : 2000;
        
        // El izado físico real ocurre tras 300ms de pausa por inercia
        const isLifting = repairAge < 1100; 
        const liftProgress = Math.min(1, Math.max(0, (repairAge - 300) / 800)); 
        
        // Fase 1: Tirón violento (instantáneo) | Fase 2: Pausa | Fase 3: Izado graduado
        const easeLift = liftProgress; 

        // MOTOR DE ITERACIÓN ADAPTATIVA: Más iteraciones para mayor precisión y respuesta instantánea
        let iterations = (isLifting || this.isDragging) ? 24 : 12; 
        
        // Gravedad dinámica: Tira hacia arriba después de la pausa para izar
        let gravity = 0.08; 
        if (isBroken && !this.isDragging) gravity = 0.32; 
        if (this.isRepaired) {
            // Durante la pausa (0-300ms), mantenemos tensión. Tras la pausa (300ms+), izamos.
            gravity = isLifting ? (-0.12 + (0.32 * liftProgress)) : 0.20; 
        }
        
        const isPinnedEnd = !isBroken || this.isDragging || this.isRepaired;
        
        this.anchorNodes[0].x = xStart;
        this.anchorNodes[0].y = yStart;
        
        if (isPinnedEnd) {
            this.anchorNodes[this.nodeCount - 1].x = xEnd;
            this.anchorNodes[this.nodeCount - 1].y = yEnd;
        }

        // Integración Verlet con INERCIA REACTIVA (v5.2)
        const limit = isPinnedEnd ? this.nodeCount - 1 : this.nodeCount;
        const scrollImpact = this.isRepaired ? this.scrollVelocity * 0.35 : 0; 

        for (let i = 1; i < limit; i++) {
            const n = this.anchorNodes[i];
            const vx = (n.x - n.oldX) * friction;
            const vy = (n.y - n.oldY) * friction;
            n.oldX = n.x;
            n.oldY = n.y;
            
            n.x += vx;
            n.y += vy + gravity - scrollImpact; // La inercia del scroll vuelve a la vida

            // Micro-vibración orgánica
            if (this.isRepaired) {
                n.x += (Math.random() - 0.5) * 0.1;
                n.y += (Math.random() - 0.5) * 0.1;
            }
        }

        // --- SISTEMA DE HITBOXES (v5.6): Ahora dentro del motor de iteración ---
        // Movido adentro del bucle de constraints para máxima estabilidad.

        // CATENARIA DINÁMICA: CONSECUENCIA FÍSICA (CAUSA -> EFECTO)
        let targetLen = 135; 
        if (isPinnedEnd) {
            const distRecta = Math.hypot(xEnd - xStart, yEnd - yStart);
            let relaxFactor = this.isRepaired ? 1.15 : 1.12; 
            
            if (this.isRepaired && repairAge < 1000) {
                // CURVA DE TENSIÓN EXTREMA (v15.0): Sincronización Secuencial
                if (repairAge < 350) {
                    // Fase TENSORA: El hilo está como una vara de acero (Snap)
                    relaxFactor = 0.995; // Ligeramente sobre-tenso para el latigazo
                } else {
                    const tensionBlend = Math.min(1, Math.max(0, (repairAge - 350) / 450)); 
                    relaxFactor = 1.01 + (0.14 * tensionBlend); 
                }
                targetLen = distRecta * relaxFactor;
            } else if (this.relayTriggered) {
                // HILO COLGANTE (Relay v15.5): Una vez que la H releva, 
                // el hilo se mantiene "corto" y controlado (1.05 relax).
                relaxFactor = 1.05;
                targetLen = distRecta * relaxFactor;
            } else {
                targetLen = distRecta * relaxFactor;
            }
        }
        const segLen = targetLen / (this.nodeCount - 1);

        for (let j = 0; j < iterations; j++) {
            for (let i = 0; i < this.nodeCount - 1; i++) {
                const p1 = this.anchorNodes[i];
                const p2 = this.anchorNodes[i + 1];
                const dx = p2.x - p1.x;
                const dy = p2.y - p1.y;
                const dist = Math.hypot(dx, dy);
                const diff = (segLen - dist) / (dist || 1);
                const offsetX = dx * diff * 0.5;
                const offsetY = dy * diff * 0.5;
                
                if (i !== 0) { p1.x -= offsetX; p1.y -= offsetY; }
                if (i + 1 !== this.nodeCount - 1 || !isPinnedEnd) { 
                    p2.x += offsetX; p2.y += offsetY; 
                }
            }

            // --- RESOLUCIÓN ITERATIVA DE ALTA FRECUENCIA (v5.9) ---
            // SOLO cuando está reparado: evita que la colisión repela el hilo al conectar.
            if (this.isRepaired && !this.isDragging) {
                this.resolveCollisions(this.anchorNodes);
            }
        }

        // --- CHEQUEO DE ENERGÍA PARA SLEEPING ---
        let totalVelocity = 0;
        for (let i = 0; i < this.nodeCount; i++) {
            const n = this.anchorNodes[i];
            totalVelocity += Math.abs(n.x - (n.oldX || n.x)) + Math.abs(n.y - (n.oldY || n.y));
        }

        // Si la energía es mínima durante 60 frames, ponemos a dormir el hilo.
        if (totalVelocity < 0.1 && !this.isDragging && !isLifting) {
            this.framesInactive++;
            if (this.framesInactive > 60) this.isSleeping = true;
        } else {
            this.framesInactive = 0;
            this.isSleeping = false;
        }
    }

    drawAnchorSilk(ctx, isBroken) {
        ctx.save();
        ctx.fillStyle = isBroken && !this.isDragging ? "#d05151" : "#4a7a9e"; 
        ctx.globalAlpha = 0.95;
        ctx.font = 'bold 10px "Courier New", monospace';
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        const n = this.nodeCount;
        const last = this.anchorNodes[n - 1];
        
        // ALTA RESOLUCIÓN PARA HILO MAESTRO: Interpolación Suave Bezier
        const dotGap = 2.5;
        let accumulator = 0;

        for (let i = 0; i < n - 1; i++) {
            const p1 = this.anchorNodes[i];
            const p2 = this.anchorNodes[Math.min(i + 1, n - 1)];
            const p3 = this.anchorNodes[Math.min(i + 2, n - 1)];

            if (i === 0) {
                // TRAMO INICIAL: Del primer nodo al punto medio
                const startPtX = p1.x; const startPtY = p1.y;
                const endPtX = (p1.x + p2.x) / 2; const endPtY = (p1.y + p2.y) / 2;
                let arcD = Math.hypot(endPtX - startPtX, endPtY - startPtY);
                let tt = accumulator / (arcD || 1);
                while (tt < 1.0) {
                    const bx = (1-tt)*startPtX + tt*endPtX; // Recto para tramo corto
                    const by = (1-tt)*startPtY + tt*endPtY;
                    ctx.fillText('.', bx, by);
                    tt += dotGap / (arcD || 1);
                }
                accumulator = (tt - 1.0) * arcD;
            }

            const midX1 = (p1.x + p2.x) / 2;
            const midY1 = (p1.y + p2.y) / 2;
            const midX2 = (p2.x + p3.x) / 2;
            const midY2 = (p2.y + p3.y) / 2;

            const arcDist = Math.hypot(midX2 - midX1, midY2 - midY1);

            let t = accumulator / (arcDist || 1);
            while (t < 1.0) {
                const bx = (1-t)*(1-t) * midX1 + 2*(1-t)*t*p2.x + t*t*midX2;
                const by = (1-t)*(1-t) * midY1 + 2*(1-t)*t*p2.y + t*t*midY2;
                ctx.fillText('.', bx, by);
                t += dotGap / (arcDist || 1);
            }
            accumulator = (t - 1.0) * arcDist;
        }

        // El nudo ●
        if (isBroken) {
            ctx.font = 'bold 20px "Courier New", monospace';
            ctx.fillStyle = this.isDragging ? "#4a7a9e" : "#d05151";
            ctx.fillText('●', last.x, last.y + 2);
        }

        ctx.restore();
    }
}
