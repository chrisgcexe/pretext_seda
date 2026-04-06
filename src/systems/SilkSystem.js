/**
 * SILK CANVAS ENGINE
 * Reemplaza el sistema de Spans por un Canvas de alta performance.
 * v3.0 - Mecánica de Ruptura y Costura (Drag & Drop)
 */
export class SilkCanvas {
    constructor(textToFray, remainingText, container, limitIndex = -1) {
        this.fullText = textToFray + remainingText;
        this.limitIndex = limitIndex;
        this.cutoff = this.fullText.length;
        this.container = container;

        this.container.innerText = this.fullText;

        document.querySelectorAll('.silk-overlay-canvas').forEach(el => el.remove());

        this.canvas = document.createElement('canvas');
        this.canvas.className = 'silk-overlay-canvas';
        this.ctx = this.canvas.getContext('2d');
        document.body.appendChild(this.canvas);

        this.chars = [];
        this.isInitialized = false;
        this.hasResized = false;

        this.nodes = [];
        this.anchorNodes = []; 
        this.nodeCount = 80; // SUPER-FIDELIDAD: 80 nodos físicos para curvas perfectas
        for (let i = 0; i < this.nodeCount; i++) {
            this.nodes.push({ x: 0, y: 0, oldX: 0, oldY: 0, pinned: (i === 0) });
            this.anchorNodes.push({ x: 0, y: 0, oldX: 0, oldY: 0, pinned: (i === 0) });
        }

        // --- ESTADOS DE LA MECÁNICA INTERACTIVA ---
        this.isBroken = false;
        this.isDragging = false;
        this.isRepaired = false;
        this.mouseX = 0;
        this.mouseY = 0;
        this.repairScrollY = 0;
        
        // --- OPTIMIZACIÓN PERFORMANCE ARMOR (v3.5) ---
        this.isSleeping = false;
        this.framesInactive = 0;
        this.lastScrollY = window.scrollY; // Inicialización redundante para seguridad
        
        this.setupInteraction();
    }

    // --- MOTOR DE INTERACCIÓN (MOUSE/TOUCH) ---
    setupInteraction() {
        this.canvas.addEventListener('mousedown', (e) => {
            this.wakeUp(); // Despertar al tocar
            if (!this.isBroken || this.isRepaired) return;
            
            // Buscamos la punta libre del hilo (el último nodo físico)
            const lastNode = this.anchorNodes[this.nodeCount - 1];
            const dist = Math.hypot(e.clientX - lastNode.x, e.clientY - lastNode.y);
            
            // Radio de colisión brutalista (generoso para buen game feel)
            if (dist < 80) { 
                this.isDragging = true;
                this.mouseX = e.clientX;
                this.mouseY = e.clientY;
                document.body.style.cursor = 'grabbing';
            }
        });

        window.addEventListener('mousemove', (e) => {
            if (this.isDragging) {
                this.mouseX = e.clientX;
                this.mouseY = e.clientY;
            } else if (this.isBroken && !this.isRepaired) {
                // Hover effect si pasamos cerca del hilo roto
                const lastNode = this.anchorNodes[this.nodeCount - 1];
                const dist = Math.hypot(e.clientX - lastNode.x, e.clientY - lastNode.y);
                document.body.style.cursor = dist < 80 ? 'grab' : 'default';
            }
        });

        window.addEventListener('mouseup', (e) => {
            if (this.isDragging) {
                this.isDragging = false;
                document.body.style.cursor = 'default';
                
                if (this.hangingTarget) {
                    const range = document.createRange();
                    if (this.hangingTarget.firstChild) {
                        range.setStart(this.hangingTarget.firstChild, 0);
                        range.setEnd(this.hangingTarget.firstChild, 1);
                        const rect = range.getBoundingClientRect();
                        const targetX = rect.left;
                        const targetY = rect.top + rect.height / 2;

                        // Chequeamos si el usuario soltó el hilo cerca de la 'o'
                        const distToO = Math.hypot(this.mouseX - targetX, this.mouseY - targetY);
                        
                        if (distToO < 50) { // SNAP! (COSTURA EXITOSA)
                            this.isBroken = false;
                            this.isRepaired = true;
                            this.repairScrollY = window.scrollY;
                            this.repairStartTime = Date.now(); 
                            
                            // 1. CAPTURA DE TENSIÓN INICIAL: Bloqueamos la distancia para que el ascenso 
                            // genere la panza como consecuencia física (acercamiento de anclajes).
                            const rect = this.hangingTarget.getBoundingClientRect();
                            this.repairStartDist = Math.hypot(rect.left - (typeof targetX === 'number' ? targetX : window.innerWidth * 0.05), (rect.top + rect.height / 2) - (typeof targetY === 'number' ? targetY : window.innerHeight * 0.15));

                            this.canvas.style.pointerEvents = 'none'; 
                            
                            // 2. EL TIRÓN (REBOTE FÍSICO)
                            this.anchorNodes.forEach((n, i) => {
                                if (i > 0 && i < this.nodeCount - 1) {
                                    n.oldY = n.y + 15; 
                                    n.oldX += (Math.random() - 0.5) * 10;
                                }
                            });

                            // 3. RESURRECCIÓN ELÁSTICA (CON INERCIA/RETRASO)
                            setTimeout(() => {
                                const pElement = this.hangingTarget.parentElement;
                                pElement.style.transition = 'all 0.8s cubic-bezier(0.34, 1.56, 0.64, 1)'; 
                                pElement.style.transform = 'translateY(0) rotate(0deg)';
                                pElement.style.opacity = '1';
                            }, 300); // Pausa de 0.3s para vender la inercia del bloque de texto
                        }
                    }
                }
            }
        });

        window.addEventListener('scroll', () => {
            this.wakeUp(); // Despertar ante el scroll
        });
    }

    wakeUp() {
        this.isSleeping = false;
        this.framesInactive = 0;
    }

    setup() {
        const widthCSS = this.container.offsetWidth;
        if (widthCSS <= 0) return;

        this.container.innerText = this.fullText;
        const textNode = this.container.firstChild;
        if (!textNode || textNode.nodeType !== 3) return;

        const pRect = this.container.getBoundingClientRect();
        const fontStyle = getComputedStyle(this.container);
        this.fontString = fontStyle.font;

        let color = fontStyle.color;
        if (color === "rgba(0, 0, 0, 0)" || color === "transparent" || color === "rgb(255, 255, 255)") {
            color = "#0d0900";
        }
        this.textColor = color;
        this.chars = [];
        const range = document.createRange();

        for (let i = 0; i < this.fullText.length; i++) {
            try {
                range.setStart(textNode, i);
                range.setEnd(textNode, i + 1);
                const rects = range.getClientRects();
                if (rects.length > 0) {
                    const rect = rects[0];
                    this.chars.push({
                        char: this.fullText[i],
                        homeX: rect.left + rect.width / 2 - pRect.left,
                        homeY: rect.top + rect.height / 2 - pRect.top,
                        curX: 0, curY: 0, opacity: 1,
                        isVisible: (this.fullText[i].trim() !== "")
                    });
                }
            } catch (e) {}
        }
        this.totalChars = this.chars.length;
        this.isInitialized = true;
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

    update(progress, targetX, targetY) {
        if (!this.isInitialized) { this.setup(); if (!this.isInitialized) return; }
        if (!this.hasResized) { this.resize(); this.hasResized = true; }

        // Calculamos velocidad de scroll SIEMPRE para mantener el delta correcto
        const currentScroll = window.scrollY;
        this.scrollVelocity = (currentScroll - this.lastScrollY) * 0.95; 
        this.lastScrollY = currentScroll;

        // OPTIMIZACIÓN CULLING: Si está reparado y fuera de pantalla, ahorramos CPU
        if (this.isRepaired) {
            const rect = this.container.getBoundingClientRect();
            const isInView = (rect.bottom > -200 && rect.top < window.innerHeight + 200);
            if (!isInView) return; 
        }

        // --- OPTIMIZACIÓN SLEEPING ---
        // Si el hilo está en reposo y no hay interacción, saltamos el procesado pesado.
        if (this.isSleeping && !this.isDragging) return;

        // FIX 1: Una vez que el tejido se rompe o se repara, la animación no tiene marcha atrás.
        if (this.isBroken || this.isRepaired) {
            progress = 1.0;
        }

        const ctx = this.ctx;
        const dpr = window.devicePixelRatio || 1;
        ctx.clearRect(0, 0, this.canvas.width / dpr, this.canvas.height / dpr);

        ctx.save();
        if (this.isRepaired) ctx.translate(0, this.repairScrollY - window.scrollY);

        const effectiveTotal = (this.limitIndex !== -1) ? this.limitIndex + 1 : this.totalChars;
        const scaledProgress = progress * effectiveTotal;
        const currentIdx = Math.floor(scaledProgress);
        const stepProgress = scaledProgress % 1;

        const pRect = this.container.getBoundingClientRect();
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
        if (mainAnchor && progress > 0) {
            this.updatePhysics(dX, dY, mainAnchor.curX, mainAnchor.curY);
            this.drawSilk(ctx);
        }

        const fSizeMatch = this.fontString.match(/\d+(\.\d+)?/);
        const baseSize = fSizeMatch ? parseFloat(fSizeMatch[0]) : 16;
        const jFont = `700 ${baseSize * 1.25}px "Courier New", monospace`;

        this.chars.forEach((c, i) => {
            const isFrayLimit = (i === this.chars.length - 1); 
            const sX = pRect.left + c.homeX;
            const sY = pRect.top + c.homeY;

            if (i < currentIdx) {
                const isLastArrived = (i === Math.floor(currentIdx) - 1);
                c.opacity = (c.char === "J" || isLastArrived) ? 1 : 0;
                c.curX = dX;
                c.curY = dY;
            } else if (i === currentIdx) {
                const t = stepProgress;
                const elastic = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
                c.curX = sX + (dX - sX) * elastic;
                c.curY = sY + (dY - sY) * elastic;
                c.opacity = (c.char === "J") ? 1 : Math.max(0, Math.min(1, (0.95 - elastic) * 10));
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
                        
                        if (sameLine) {
                            const tensionFactor = 1 - (distFromActive / 10);
                            const distVisual = Math.hypot(c.curX - prevChar.curX, c.curY - prevChar.curY);
                            
                            if (isSameWord) {
                                // HILO DE LETRA (Intra-palabra): Fuerte, tira de la letra y nunca se corta
                                c.curX = sX + (prevChar.curX - sX) * (0.2 * tensionFactor);
                                c.curY = sY + (prevChar.curY - sY) * (0.2 * tensionFactor);
                                this.drawThread(ctx, prevChar.curX, prevChar.curY, c.curX, c.curY, 0.3 * tensionFactor);
                            } else {
                                // HILO DE PALABRA (Puente de Espacio): Tira muy suave y es frágil
                                if (distVisual < 45) { // SNAP! Se rompe si la palabra anterior ya voló
                                    c.curX = sX + (prevChar.curX - sX) * (0.05 * tensionFactor);
                                    c.curY = sY + (prevChar.curY - sY) * (0.05 * tensionFactor);
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
                c.opacity = 1;
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
                    // Si el progreso es casi total y aún no se ha roto ni reparado
                    if (progress > 0.99 && !this.isBroken && !this.isRepaired) {
                        this.isBroken = true;
                        this.canvas.style.pointerEvents = 'auto'; // Permitimos hacer click en el hilo
                        
                        // Hacemos que el párrafo caiga y se vuelva gris (CSS DOM)
                        const pElement = this.hangingTarget.parentElement;
                        const dropDist = Math.max(0, window.innerHeight - pElement.getBoundingClientRect().bottom - 40);
                        pElement.style.transition = 'all 1.2s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
                        pElement.style.transform = `translateY(${dropDist}px) rotate(1deg)`;
                        pElement.style.opacity = '0.3';
                    }

                    // 2. OBJETIVO DEL HILO Y DISTANCIA
                    let targetX = rect.left;
                    let targetY = rect.top + rect.height / 2;
                    if (this.isRepaired) targetY -= (this.repairScrollY - window.scrollY);

                    let distRealToO = 1000;
                    this.magneticEase = 0; // Reseteamos ease en cada frame

                    if (this.isBroken) {
                        if (this.isDragging) {
                            targetX = this.mouseX;
                            targetY = this.mouseY;
                            distRealToO = Math.hypot(this.mouseX - rect.left, this.mouseY - (rect.top + rect.height / 2));
                            
                            // Cálculo de proximidad magnética
                            const proximity = Math.max(0, 1 - (distRealToO / 250));
                            this.magneticEase = proximity * proximity;
                        } else {
                            targetX = c.curX + (Math.sin(Date.now() * 0.003) * 15); 
                            targetY = c.curY + 150; 
                        }
                    }

                    if (this.isRepaired) this.magneticEase = 1.0; 

                    // --- FEEDBACK VISUAL MAGNÉTICO PARA LA 'O' ---
                    const targetDOM = document.getElementById('target-o');
                    if (targetDOM) {
                        if (this.magneticEase > 0) {
                            // Estética ASCII pura: Bold real y escala dura, cero blur.
                            // El contenedor de 1ch evita que el párrafo colapse o salte.
                            targetDOM.style.fontWeight = this.magneticEase > 0.15 ? '700' : '400';
                            targetDOM.style.transform = `scale(${1.0 + (0.25 * this.magneticEase)})`;
                            targetDOM.style.color = '#0d0900'; 
                        } else {
                            targetDOM.style.fontWeight = '400';
                            targetDOM.style.transform = 'scale(1)';
                            targetDOM.style.color = '#0d0900';
                        }
                    }

                    // 3. ACTUALIZACIÓN DE FÍSICAS (Con sincronización de coordenadas locales)
                    const scrollOffset = this.isRepaired ? (this.repairScrollY - window.scrollY) : 0;
                    if (distMoved > 2 || this.isBroken || this.isRepaired) {
                        this.updateAnchorPhysics(dX, dY, targetX - (this.isRepaired ? 0 : 0), targetY - (this.isRepaired ? 0 : 0), this.isBroken);
                        this.drawAnchorSilk(ctx, this.isBroken);
                    }
                }
            }

            if (c.opacity > 0) {
                ctx.globalAlpha = c.opacity;
                ctx.font = (c.char === "J") ? jFont : this.fontString;
                ctx.fillText(c.char, c.curX, c.curY);
            }
        });
        ctx.restore();
        ctx.globalAlpha = 1;
    }

    updatePhysics(xStart, yStart, xEnd, yEnd) {
        const gravity = 0.001, friction = 0.90, iterations = 15;
        this.nodes[0].x = xStart; this.nodes[0].y = yStart;
        const last = this.nodes[this.nodeCount - 1];
        last.x = xEnd; last.y = yEnd;

        for (let i = 1; i < this.nodeCount - 1; i++) {
            const n = this.nodes[i];
            const vx = (n.x - n.oldX) * friction, vy = (n.y - n.oldY) * friction;
            n.oldX = n.x; n.oldY = n.y; n.x += vx; n.y += vy + gravity;
        }

        const totalDist = Math.hypot(xEnd - xStart, yEnd - yStart);
        const segLen = totalDist / (this.nodeCount - 1);

        for (let j = 0; j < iterations; j++) {
            for (let i = 0; i < this.nodeCount - 1; i++) {
                const p1 = this.nodes[i], p2 = this.nodes[i + 1];
                const dx = p2.x - p1.x, dy = p2.y - p1.y;
                const dist = Math.hypot(dx, dy);
                const diff = (segLen - dist) / (dist || 1);
                const offsetX = dx * diff * 0.5, offsetY = dy * diff * 0.5;
                if (i !== 0) { p1.x -= offsetX; p1.y -= offsetY; }
                if (i + 1 !== this.nodeCount - 1) { p2.x += offsetX; p2.y += offsetY; }
            }
        }
    }

    drawSilk(ctx) {
        ctx.save();
        ctx.fillStyle = "#4a7a9e"; 
        ctx.globalAlpha = 0.85;
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

    drawThread(ctx, x1, y1, x2, y2, opacity) {
        ctx.save(); 
        ctx.fillStyle = "#4a7a9e"; 
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

        for (let i = 0; i < steps; i++) {
            const t = i / steps;
            const bx = (1-t)*(1-t)*x1 + 2*(1-t)*t*cpX + t*t*x2;
            const by = (1-t)*(1-t)*y1 + 2*(1-t)*t*cpY + t*t*y2;
            ctx.fillText('.', bx, by);
        }
        
        ctx.restore(); 
    }

    updateAnchorPhysics(xStart, yStart, xEnd, yEnd, isBroken) {
        // AMORTIGUACIÓN Y FLEXIBILIDAD: Fricción más alta para controlar el 'pop'
        const friction = 0.82; 
        
        // MOTOR DE COHERENCIA "SEDA": Tirón inicial -> Pausa de Inercia -> Izado -> Relajación
        const repairAge = this.isRepaired ? (Date.now() - (this.repairStartTime || 0)) : 2000;
        
        // El izado físico real ocurre tras 300ms de pausa por inercia
        const isLifting = repairAge < 1100; 
        const liftProgress = Math.min(1, Math.max(0, (repairAge - 300) / 800)); 
        
        // Fase 1: Tirón violento (instantáneo) | Fase 2: Pausa | Fase 3: Izado graduado
        const easeLift = liftProgress; 

        // MOTOR DE ITERACIÓN ADAPTATIVA: Bajamos a 6 si está quieto, subimos a 18 si hay acción.
        let iterations = (isLifting || this.isDragging) ? 18 : 6; 
        
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

        // Integración Verlet con INERCIA REACTIVA
        const limit = isPinnedEnd ? this.nodeCount - 1 : this.nodeCount;
        const scrollImpact = this.isRepaired ? this.scrollVelocity * 0.42 : 0;

        for (let i = 1; i < limit; i++) {
            const n = this.anchorNodes[i];
            const vx = (n.x - n.oldX) * friction;
            const vy = (n.y - n.oldY) * friction;
            n.oldX = n.x;
            n.oldY = n.y;
            
            n.x += vx;
            n.y += vy + gravity - scrollImpact; 

            // Micro-vibración orgánica
            if (this.isRepaired) {
                n.x += (Math.random() - 0.5) * 0.1;
                n.y += (Math.random() - 0.5) * 0.1;
            }
        }

        // CATENARIA DINÁMICA: CONSECUENCIA FÍSICA (CAUSA -> EFECTO)
        let targetLen = 135; 
        if (isPinnedEnd) {
            const distRecta = Math.hypot(xEnd - xStart, yEnd - yStart);
            
            let relaxFactor = this.isRepaired ? 1.15 : 1.12; 
            
            if (isLifting) {
                // CURVA DE TENSIÓN ABSOLUTA: Hilo de seda tensado al límite físico (0.20)
                relaxFactor = 0.20; 
                
                // El targetLen real basado en la tensión solicitada
                const startDist = this.repairStartDist || distRecta; 
                targetLen = (startDist * 0.2); 
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
