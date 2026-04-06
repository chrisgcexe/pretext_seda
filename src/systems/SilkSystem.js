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
        this.nodeCount = 25; 
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
        
        // --- SEGUIMIENTO DE INERCIA ---
        this.lastScrollY = window.scrollY;
        this.scrollVelocity = 0;
        
        this.setupInteraction();
    }

    // --- MOTOR DE INTERACCIÓN (MOUSE/TOUCH) ---
    setupInteraction() {
        // Escuchamos el mousedown solo en el canvas
        this.canvas.addEventListener('mousedown', (e) => {
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
                            this.canvas.style.pointerEvents = 'none'; // El canvas vuelve a ser fantasma
                            
                            // El párrafo resucita violentamente
                            const pElement = this.hangingTarget.parentElement;
                            pElement.style.transform = 'translateY(0) rotate(0deg)';
                            pElement.style.opacity = '1';
                        }
                    }
                }
            }
        });
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

        // FIX 1: Una vez que el tejido se rompe o se repara, la animación no tiene marcha atrás.
        // Forzamos el progreso al máximo para que la 'J' quede anclada arriba.
        if (this.isBroken || this.isRepaired) {
            progress = 1.0;
        }

        const ctx = this.ctx;
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        // Calculamos velocidad de scroll para inyectarla en los nodos
        const currentScroll = window.scrollY;
        this.scrollVelocity = (currentScroll - this.lastScrollY) * 0.95; // Amortiguación de velocidad
        this.lastScrollY = currentScroll;

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
                if (distFromActive < 10) { 
                    const prevChar = this.chars[i - 1];
                    const sameLine = Math.abs(prevChar.homeY - c.homeY) < 10;
                    if (sameLine) {
                        const tensionFactor = 1 - (distFromActive / 10);
                        c.curX = sX + (prevChar.curX - sX) * (0.2 * tensionFactor);
                        c.curY = sY + (prevChar.curY - sY) * (0.2 * tensionFactor);
                        this.drawThread(ctx, prevChar.curX, prevChar.curY, c.curX, c.curY, 0.3 * tensionFactor);
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

                    // 2. OBJETIVO DEL HILO (COORDENADAS LOCALES)
                    const scrollOffset = this.isRepaired ? (this.repairScrollY - window.scrollY) : 0;
                    
                    // Anclaje J (en espacio local del canvas traducido coincide con dX, dY)
                    const localJX = dX;
                    const localJY = dY; 

                    // Anclaje o (traducido al espacio local del canvas)
                    let targetX = rect.left;
                    let targetY = rect.top + rect.height / 2 - scrollOffset;

                    if (this.isBroken) {
                        if (this.isDragging) {
                            targetX = this.mouseX;
                            targetY = this.mouseY - scrollOffset;
                        } else {
                            targetX = localJX + (Math.sin(Date.now() * 0.003) * 15);
                            targetY = localJY + 150;
                        }
                    }

                    // 3. ACTUALIZACIÓN DE FÍSICAS
                    if (distMoved > 2 || this.isBroken || this.isRepaired) {
                        this.updateAnchorPhysics(localJX, localJY, targetX, targetY, this.isBroken);
                        this.drawAnchorSilk(ctx, this.isBroken);
                    }
                }
            }

            if (c.opacity > 0) {
                ctx.globalAlpha = c.opacity;
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
        ctx.beginPath();
        ctx.strokeStyle = "#4a7a9e"; ctx.lineWidth = 0.8; ctx.globalAlpha = 0.7;
        ctx.lineJoin = "round"; ctx.lineCap = "round";
        ctx.moveTo(this.nodes[0].x, this.nodes[0].y);
        for (let i = 1; i < this.nodeCount - 1; i++) {
            const p = this.nodes[i], prev = this.nodes[i - 1];
            ctx.quadraticCurveTo(prev.x, prev.y, (p.x + prev.x) / 2, (p.y + prev.y) / 2);
        }
        ctx.lineTo(this.nodes[this.nodeCount - 1].x, this.nodes[this.nodeCount - 1].y);
        ctx.stroke(); ctx.restore();
    }

    drawThread(ctx, x1, y1, x2, y2, opacity) {
        ctx.save(); 
        
        const dx = x2 - x1;
        const dy = y2 - y1;
        const dist = Math.hypot(dx, dy);
        const midX = x1 + dx * 0.5;
        const midY = y1 + dy * 0.5;

        // FIX 4: Adiós a la manguera colgada. El sag ahora es dinámico y mínimo (un rango de 3-8px).
        // No sale por abajo de las letras, es un trazo fino y apenas curvado.
        const sag = 3 + (dist * 0.035); 

        // FIX 5: RUIDO ÓRGANICO / MÚLTIPLES FIBRAS.
        // En vez de dibujar una línea gruesa y perfecta, dibujamos tres líneas finísimas
        // con opacidades y offsets diferentes para simular la textura "peluda" de la seda natural.
        ctx.lineWidth = 0.5;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        
        // Fibra 1 (Sutil)
        ctx.beginPath();
        ctx.strokeStyle = "#4a7a9e"; 
        ctx.globalAlpha = opacity * 0.4;
        ctx.moveTo(x1, y1);
        ctx.quadraticCurveTo(midX + (Math.random() - 0.5) * 3, midY + sag + (Math.random() - 0.5) * 2, x2, y2);
        ctx.stroke();

        // Fibra 2 (Principal - Con ruido visual de jitter)
        ctx.beginPath();
        ctx.strokeStyle = "#4a7a9e"; 
        ctx.globalAlpha = opacity * 1.0;
        ctx.moveTo(x1, y1);
        ctx.quadraticCurveTo(midX + (Math.sin(Date.now() * 0.005) * 2), midY + sag, x2, y2);
        ctx.stroke();

        // Fibra 3 (Brillo)
        ctx.beginPath();
        ctx.strokeStyle = "#5a8aac"; 
        ctx.globalAlpha = opacity * 0.6;
        ctx.moveTo(x1, y1);
        ctx.quadraticCurveTo(midX + 2, midY + sag - 1, x2, y2);
        ctx.stroke();
        
        ctx.restore(); 
    }

    updateAnchorPhysics(xStart, yStart, xEnd, yEnd, isBroken) {
        // AMORTIGUACIÓN Y FLEXIBILIDAD: Bajamos fricción para que la inercia dure más
        const friction = 0.72; 
        const iterations = 4; 
        
        // Gravedad dinámica según estado
        let gravity = 0.1; 
        if (isBroken && !this.isDragging) gravity = 0.35; 
        if (this.isRepaired) gravity = 0.22; 
        
        const isPinnedEnd = !isBroken || this.isDragging || this.isRepaired;
        
        this.anchorNodes[0].x = xStart;
        this.anchorNodes[0].y = yStart;
        
        if (isPinnedEnd) {
            this.anchorNodes[this.nodeCount - 1].x = xEnd;
            this.anchorNodes[this.nodeCount - 1].y = yEnd;
        }

        // Integración Verlet con INYECCIÓN DE VELOCIDAD DE SCROLL
        const limit = isPinnedEnd ? this.nodeCount - 1 : this.nodeCount;
        const scrollImpact = this.isRepaired ? this.scrollVelocity * 0.45 : 0;

        for (let i = 1; i < limit; i++) {
            const n = this.anchorNodes[i];
            const vx = (n.x - n.oldX) * friction;
            const vy = (n.y - n.oldY) * friction;
            n.oldX = n.x;
            n.oldY = n.y;
            
            // Inyectamos la velocidad del scroll opuesta para que el hilo "se quede atrás" (inercia)
            n.x += vx;
            n.y += vy + gravity - scrollImpact; 

            // Pequeño shiver orgánico (vibración de seda)
            if (this.isRepaired) {
                n.x += (Math.random() - 0.5) * 0.15;
                n.y += (Math.random() - 0.5) * 0.15;
            }
        }

        // CATENARIA ELÁSTICA: Longitud de cuerda
        let targetLen = 180;
        if (isPinnedEnd) {
            const distRecta = Math.hypot(xEnd - xStart, yEnd - yStart);
            // Cuando está cosido (repaired), le damos un relaxFactory mayor para que 'panzee'
            const relaxFactor = this.isRepaired ? 1.25 : 1.15; 
            targetLen = distRecta * relaxFactor;
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
    }

    drawAnchorSilk(ctx, isBroken) {
        ctx.save();
        ctx.beginPath();
        // Si está roto, el hilo vibra un poco con un rojo alerta para invitar al click
        ctx.strokeStyle = isBroken && !this.isDragging ? "#d05151" : "#4a7a9e"; 
        ctx.lineWidth = isBroken ? 1.5 : 0.8;
        ctx.globalAlpha = 0.9;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";

        ctx.moveTo(this.anchorNodes[0].x, this.anchorNodes[0].y);
        for (let i = 1; i < this.nodeCount - 1; i++) {
            const p = this.anchorNodes[i];
            const prev = this.anchorNodes[i - 1];
            ctx.quadraticCurveTo(prev.x, prev.y, (p.x + prev.x) / 2, (p.y + prev.y) / 2);
        }
        const last = this.anchorNodes[this.nodeCount - 1];
        ctx.lineTo(last.x, last.y);
        ctx.stroke();

        // Dibujamos un "nudo" brillante en la punta si está colgando para que el usuario sepa que puede agarrarlo
        if (isBroken) {
            ctx.beginPath();
            ctx.arc(last.x, last.y, this.isDragging ? 2 : 4, 0, Math.PI * 2);
            ctx.fillStyle = this.isDragging ? "#4a7a9e" : "#d05151";
            ctx.fill();
        }

        ctx.restore();
    }
}
