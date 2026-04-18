/**
 * COMPAS_TENSION
 * Sistema que conecta el ancla 'H' (SilkSystem) con el Kanji '女' (KanjiSystem)
 * mediante un hilo de seda física una vez que ambos sistemas han finalizado.
 */

export class CompasTension {
    constructor() {
        this.nodeCount = 24;
        this.nodes = [];
        this.isInitialized = false;
        this.revealProgress = 0;
        this.isVisible = false;
        
        // Canvas dedicado para evitar colisiones de órdenes de renderizado
        this.canvas = document.createElement('canvas');
        this.canvas.id = 'compas-tension-canvas';
        this.canvas.style.position = 'fixed';
        this.canvas.style.top = '0';
        this.canvas.style.left = '0';
        this.canvas.style.width = '100%';
        this.canvas.style.height = '100%';
        this.canvas.style.pointerEvents = 'none';
        this.canvas.style.zIndex = '25'; // Encima de los demás hilos
        document.body.appendChild(this.canvas);
        this.ctx = this.canvas.getContext('2d');

        this.resize();
        window.addEventListener('resize', () => this.resize());
    }

    resize() {
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = window.innerWidth * dpr;
        this.canvas.height = window.innerHeight * dpr;
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        this.ctx.scale(dpr, dpr);
    }

    setupNodes(x1, y1, x2, y2) {
        this.nodes = [];
        for (let i = 0; i < this.nodeCount; i++) {
            const t = i / (this.nodeCount - 1);
            const x = x1 + (x2 - x1) * t;
            const y = y1 + (y2 - y1) * t;
            this.nodes.push({ x, y, oldX: x, oldY: y });
        }
        this.isInitialized = true;
    }

    update(silkSystem, kanjiSystem) {
        // --- TRAVEL ZONE GUARD ---
        if (!this._travelZones) {
            const found = document.querySelectorAll('.zona-viaje');
            if (found.length > 0) this._travelZones = Array.from(found);
        }
        
        const inTravelZone = this._travelZones?.some(zone => {
            const r = zone.getBoundingClientRect();
            return (r.top < window.innerHeight && r.bottom > 0);
        });

        // Solo actuamos si ambos sistemas están DONE
        const silkDone = silkSystem && silkSystem.state === 'done';
        const kanjiDone = kanjiSystem && kanjiSystem.isDone;

        if (!silkDone || !kanjiDone || inTravelZone) {
            this.isVisible = false;
            if (silkSystem) silkSystem.hideHUDAnchor = false;
            if (kanjiSystem) kanjiSystem.hideHUDAnchor = false;
            this.canvas.style.opacity = '0';
            return;
        }

        this.isVisible = true;
        this.canvas.style.opacity = '1';

        // --- TAKEOVER: Avisamos a los sistemas que nosotros dibujaremos las anclas ---
        silkSystem.hideHUDAnchor = true;
        kanjiSystem.hideHUDAnchor = true;

        // Recuperamos el ancla H y el Kanji para heredar su posición exacta actual
        const hChar = silkSystem.chars.find(c => c.isHUDAnchor);
        const kChar = kanjiSystem.chars.find(c => c.isHUDAnchor);

        if (!hChar || !kChar) return;

        const x1 = hChar.curX, y1 = hChar.curY;
        const x2 = kChar.curX, y2 = kChar.curY;

        if (!this.isInitialized) {
            this.baseSize = kanjiSystem.baseSize || 18;
            this.setupNodes(x1, y1, x2, y2);
        }

        // Animación de aparición
        if (this.revealProgress < 1.0) {
            this.revealProgress += 0.015;
        }

        // --- MOTOR FÍSICO (Copia IDÉNTICA de SilkSystem.updateAnchorPhysics) ---
        const gravity = 0.08; 
        const friction = 0.92; 
        const iterations = 24;
        const relaxFactor = 1.05;
        
        this.nodes[0].x = x1;
        this.nodes[0].y = y1;
        this.nodes[this.nodeCount - 1].x = x2;
        this.nodes[this.nodeCount - 1].y = y2;

        for (let i = 1; i < this.nodeCount - 1; i++) {
            const n = this.nodes[i];
            const vx = (n.x - n.oldX) * friction;
            const vy = (n.y - n.oldY) * friction;
            n.oldX = n.x;
            n.oldY = n.y;
            n.x += vx;
            n.y += vy + gravity;
        }

        const totalDist = Math.hypot(x2 - x1, y2 - y1);
        const targetLen = totalDist * relaxFactor; 
        const segLen = targetLen / (this.nodeCount - 1);

        for (let j = 0; j < iterations; j++) {
            for (let i = 0; i < this.nodeCount - 1; i++) {
                const n1 = this.nodes[i];
                const n2 = this.nodes[i + 1];
                const dx = n2.x - n1.x;
                const dy = n2.y - n1.y;
                const d = Math.hypot(dx, dy);
                if (d === 0) continue;
                const diff = (segLen - d) / d;
                
                const m1 = (i === 0) ? 0 : 0.5;
                const m2 = (i + 1 === this.nodeCount - 1) ? 0 : 0.5;
                
                n1.x -= dx * diff * m1;
                n1.y -= dy * diff * m1;
                n2.x += dx * diff * m2;
                n2.y += dy * diff * m2;
            }
        }

        this.render();
    }

    render() {
        const ctx = this.ctx;
        const dpr = window.devicePixelRatio || 1;
        ctx.clearRect(0, 0, this.canvas.width / dpr, this.canvas.height / dpr);

        if (this.nodes.length < 2) return;

        const alpha = 0.95 * this.revealProgress;
        ctx.globalAlpha = alpha;
        
        // --- RENDERIZADO (Copia IDÉNTICA de SilkSystem.drawAnchorSilk) ---
        ctx.fillStyle = "#4a7a9e"; 
        ctx.font = 'bold 10px "Courier New", monospace';
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        const n = this.nodes.length;
        const dotGap = 2.5;
        let accumulator = 0;

        // v38.0: Máscara de lectura (Filtro central para no tapar el texto)
        const midX = window.innerWidth / 2;
        const maskHalf = 330; // ~660px de zona "limpia"
        const fadeZone = 120; // Degradado de entrada/salida

        for (let i = 0; i < n - 1; i++) {
            const p1 = this.nodes[i];
            const p2 = this.nodes[Math.min(i + 1, n - 1)];
            const p3 = this.nodes[Math.min(i + 2, n - 1)];

            if (i === 0) {
                const startPtX = p1.x; const startPtY = p1.y;
                const endPtX = (p1.x + p2.x) / 2; const endPtY = (p1.y + p2.y) / 2;
                let arcD = Math.hypot(endPtX - startPtX, endPtY - startPtY);
                let tt = accumulator / (arcD || 1);
                while (tt < 1.0) {
                    const bx = (1-tt)*startPtX + tt*endPtX;
                    const by = (1-tt)*startPtY + tt*endPtY;
                    
                    // Cálculo de alpha basado en posición horizontal
                    const distToCenter = Math.abs(bx - midX);
                    let maskAlpha = Math.min(1, Math.max(0, (distToCenter - maskHalf) / fadeZone));
                    ctx.globalAlpha = alpha * maskAlpha;

                    if (ctx.globalAlpha > 0.01) ctx.fillText('.', bx, by);
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
                
                const distToCenter = Math.abs(bx - midX);
                let maskAlpha = Math.min(1, Math.max(0, (distToCenter - maskHalf) / fadeZone));
                ctx.globalAlpha = alpha * maskAlpha;

                if (ctx.globalAlpha > 0.01) ctx.fillText('.', bx, by);
                t += dotGap / (arcDist || 1);
            }
            accumulator = (t - 1.0) * arcDist;
        }

        // DIBUJO DE ANCLAS (Takeover con estilo heredado)
        ctx.globalAlpha = alpha;
        ctx.fillStyle = "#4a7a9e";
        ctx.font = `600 ${this.baseSize * 1.15}px "Courier New", monospace`;
        
        ctx.fillText('H', this.nodes[0].x, this.nodes[0].y);
        ctx.fillText('女', this.nodes[this.nodeCount - 1].x, this.nodes[this.nodeCount - 1].y);
        
        ctx.globalAlpha = 1;
    }
}
