/**
 * SEDA: SILK BRIDGE ENGINE (v6.13)
 * Hilo de conexión estética entre párrafos.
 * (v6.13): INERCIA ORGÁNICA (Cae más lento, más recorrido).
 */

export class SilkBridge {
    constructor(originEl, targetEl, container) {
        this.originEl = originEl;
        this.targetEl = targetEl;
        this.container = container;

        this.canvas = document.createElement('canvas');
        this.canvas.className = 'silk-bridge-canvas';
        this.canvas.style.position = 'fixed';
        this.canvas.style.top = '0';
        this.canvas.style.left = '0';
        this.canvas.style.width = '100vw';
        this.canvas.style.height = '100vh';
        this.canvas.style.pointerEvents = 'none';
        this.canvas.style.background = 'transparent';
        this.canvas.style.zIndex = '9999';
        
        this.ctx = this.canvas.getContext('2d');
        document.body.appendChild(this.canvas);

        this.nodeCount = 20; // v6.13: Volvemos a más nodos para organicidad
        this.nodes = [];
        for (let i = 0; i < this.nodeCount; i++) {
            this.nodes.push({ x: 0, y: 0, oldX: 0, oldY: 0 });
        }

        this.isInitialized = false;
        this.collisionRects = [];
        this.stress = 0;
        this.resize();
        window.addEventListener('resize', () => this.resize());
    }

    setStress(val) {
        this.stress = Math.max(0, val);
    }

    setCollisionRects(rects) {
        this.collisionRects = rects;
    }

    resize() {
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = window.innerWidth * dpr;
        this.canvas.height = window.innerHeight * dpr;
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    getAnchorPoints() {
        const getPoint = (el, isStart) => {
            const range = document.createRange();
            const findTextNode = (node, last = false) => {
                if (node.nodeType === 3 && node.textContent.trim().length > 0) return node;
                const children = Array.from(node.childNodes);
                if (last) children.reverse();
                for (let child of children) {
                    let result = findTextNode(child, last);
                    if (result) return result;
                }
                return null;
            };
            let textNode = null;
            if (!isStart) {
                const staticPart = el.querySelector('.static-part');
                textNode = findTextNode(staticPart || el, true);
            } else {
                textNode = findTextNode(el, false);
            }
            if (textNode) {
                const text = textNode.textContent, len = text.length;
                let offset = isStart ? 0 : Math.max(0, len - 1);
                if (!isStart) { while (offset > 0 && /\s/.test(text[offset])) offset--; }
                else { while (offset < len - 1 && /\s/.test(text[offset])) offset++; }
                try {
                    range.setStart(textNode, offset);
                    range.setEnd(textNode, offset + 1);
                    const rect = range.getBoundingClientRect();
                    if (rect.width !== 0 || rect.height !== 0) {
                        return { x: isStart ? (rect.left + rect.width / 2) : rect.right, y: isStart ? rect.top : (rect.top + rect.height / 2) };
                    }
                } catch (e) {}
            }
            const r = el.getBoundingClientRect();
            return { x: isStart ? (r.left + 20) : r.right, y: isStart ? r.top : (r.top + r.height / 2) };
        };
        const p1 = getPoint(this.originEl, false);
        const targetRect = this.targetEl.getBoundingClientRect();
        const p2 = { x: Math.max(targetRect.left, Math.min(targetRect.right, p1.x)), y: targetRect.top };
        return { start: p1, end: p2 };
    }

    update() {
        const anchors = this.getAnchorPoints();
        const ctx = this.ctx;
        const dpr = window.devicePixelRatio || 1;
        ctx.clearRect(0, 0, this.canvas.width / dpr, this.canvas.height / dpr);

        const friction = 0.85;
        const gravity = 0.05; // v6.13: Recuperamos peso sutil para organicidad
        const iterations = 15;

        if (!this.isInitialized) {
            this.nodes.forEach(n => { n.x = anchors.start.x; n.y = anchors.start.y; n.oldX = n.x; n.oldY = n.y; });
            this.isInitialized = true;
        }

        this.nodes[0].x = anchors.start.x; this.nodes[0].y = anchors.start.y;
        this.nodes[this.nodeCount - 1].x = anchors.end.x; this.nodes[this.nodeCount - 1].y = anchors.end.y;

        for (let i = 1; i < this.nodeCount - 1; i++) {
            const n = this.nodes[i];
            const vx = (n.x - n.oldX) * friction, vy = (n.y - n.oldY) * friction;
            n.oldX = n.x; n.oldY = n.y;
            n.x += vx; n.y += vy + gravity;
        }

        const distRecta = Math.hypot(anchors.end.x - anchors.start.x, anchors.end.y - anchors.start.y);
        const targetLen = distRecta * 1.01; // v6.13: Holgura reintroducida sutilmente
        const segLen = targetLen / (this.nodeCount - 1);

        for (let j = 0; j < iterations; j++) {
            for (let i = 0; i < this.nodeCount - 1; i++) {
                const p1 = this.nodes[i], p2 = this.nodes[i+1];
                const dx = p2.x - p1.x, dy = p2.y - p1.y;
                const dist = Math.hypot(dx, dy);
                const diff = (segLen - dist) / (dist || 1);
                const ox = dx * diff * 0.5, oy = dy * diff * 0.5;
                if (i !== 0) { p1.x -= ox; p1.y -= oy; }
                if (i+1 !== this.nodeCount-1) { p2.x += ox; p2.y += oy; }
            }
            this.resolveCollisions();
        }
        this.draw(ctx);
    }

    resolveCollisions() {
        if (!this.collisionRects || this.collisionRects.length === 0) return;
        for (let i = 1; i < this.nodeCount - 1; i++) {
            const n = this.nodes[i];
            for (const rect of this.collisionRects) {
                if (n.x > rect.left && n.x < rect.right && n.y > rect.top && n.y < rect.bottom) {
                    const dt = Math.abs(n.y - rect.top), db = Math.abs(n.y - rect.bottom);
                    const min = Math.min(dt, db, Math.abs(n.x - rect.left), Math.abs(n.x - rect.right));
                    if (min === dt) n.y = rect.top; else if (min === db) n.y = rect.bottom;
                    n.oldY = n.y - (n.y - n.oldY) * 0.1;
                }
            }
        }
    }

    draw(ctx) {
        ctx.save();
        ctx.fillStyle = "#4a7a9e"; 
        ctx.globalAlpha = 0.9;
        ctx.font = 'bold 10px "Courier New", monospace';
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const dotGap = 2.5 + (this.stress * 0.18); // v6.13: Estiramiento más visible
        let accumulator = 0;
        for (let i = 0; i < this.nodeCount - 1; i++) {
            const p1 = this.nodes[i], p2 = this.nodes[i+1], p3 = this.nodes[Math.min(i+2, this.nodeCount - 1)];
            const mx1 = (p1.x + p2.x) / 2, my1 = (p1.y + p2.y) / 2, mx2 = (p2.x + p3.x) / 2, my2 = (p2.y + p3.y) / 2;
            const dist = Math.hypot(mx2 - mx1, my2 - my1);
            let t = accumulator / (dist || 1);
            while (t < 1.0) {
                const bx = (1-t)*(1-t)*mx1 + 2*(1-t)*t*p2.x + t*t*mx2, by = (1-t)*(1-t)*my1 + 2*(1-t)*t*p2.y + t*t*my2;
                ctx.fillText('.', bx, by);
                t += dotGap / (dist || 1);
            }
            accumulator = (t - 1.0) * dist;
        }
        ctx.restore();
    }
}
