/**
 * SEDA: LAND SYSTEM
 * Gestiona las transiciones cinematográficas 3D de tierra.
 */

export class LandTransition {
    constructor(fromText, toText, container, fromElement, toElement) {
        this.fromText = fromText;
        this.toText = toText;
        this.container = container;
        this.fromElement = fromElement;
        this.toElement = toElement;
        this.track = document.createElement('div');
        this.track.className = 'zona-viaje transicion-tierra';
        this.track.style.height = '550vh';

        this.canvas = document.createElement('canvas');
        this.canvas.className = 'effects-top';
        this.canvas.style.position = 'fixed';
        this.canvas.style.top = '0';
        this.canvas.style.left = '0';
        this.canvas.style.width = '100vw';
        this.canvas.style.height = '100vh';
        this.canvas.style.pointerEvents = 'none';
        this.canvas.style.zIndex = '20';
        this.canvas.style.display = 'none';

        this.track.appendChild(this.canvas);
        container.appendChild(this.track);

        this.linesFrom = [];
        this.linesTo = [];
        this.dust = [];
        this.progress = 0;
        this.prevProgress = 0;
        this.isVisible = false;
        this.ctx = this.canvas.getContext('2d');
        this.hasScrolledOnGround = false; 
        this.tornCharacters = new Map();
        
        const combined = (toText + (fromElement ? fromElement.innerText : '')).replace(/\s/g, '');
        this.alphabet = Array.from(new Set(combined.split('')));
        if (this.alphabet.length === 0) this.alphabet = ['#', '.', '/', '\\', '+'];

        this.initLayout();
    }

    initLayout() {
        const viewW = window.innerWidth;
        const PADDING = viewW < 768 ? Math.floor(viewW * 0.08) : 120;
        const MAX_WIDTH = Math.min(580, viewW - (PADDING * 2));
        const FONT_SIZE = viewW < 768 ? 14 : 16;
        const fontString = `${FONT_SIZE}px "Courier New", monospace`;

        const prepFrom = window.Pretext.prepareWithSegments(this.fromText, fontString);
        let cur = { segmentIndex: 0, graphemeIndex: 0 };
        while (true) {
            const line = window.Pretext.layoutNextLine(prepFrom, cur, MAX_WIDTH);
            if (!line) break;
            const lineContent = line.text;
            this.linesFrom.push({ 
                text: lineContent, 
                width: line.width
            });
            cur = line.end;
        }

        const prepTo = window.Pretext.prepareWithSegments(this.toText, fontString);
        cur = { segmentIndex: 0, graphemeIndex: 0 };
        while (true) {
            const line = window.Pretext.layoutNextLine(prepTo, cur, MAX_WIDTH);
            if (!line) break;
            this.linesTo.push({ text: line.text, width: line.width });
            cur = line.end;
        }
    }

    render(isCurrent = true) {
        if (!this.isVisible || !isCurrent) {
            this.canvas.style.display = 'none';
            if (!isCurrent && this.progress >= 0.9) {
                if (this.toElement) {
                    this.toElement.style.visibility = 'visible';
                    this.toElement.style.opacity = '1';
                    this.toElement.style.pointerEvents = 'auto';
                }
            }
            return;
        }
        this.canvas.style.display = 'block';

        const { canvas, ctx, progress } = this;
        const dpi = Math.min(2.0, window.devicePixelRatio || 1);
        const rect = { width: window.innerWidth, height: window.innerHeight };

        if (canvas.width !== rect.width * dpi || canvas.height !== rect.height * dpi) {
            canvas.width = rect.width * dpi;
            canvas.height = rect.height * dpi;
        }

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.save();
        ctx.scale(dpi, dpi);

        const w = rect.width;
        const h = rect.height;
        const centerX = w / 2;
        const centerY = h / 2;
        const vH = window.innerHeight;

        let rotationX = 0;
        let groundY = 0;
        let opacity3D = 1;
        let tiltProgress = 0;
        const deltaProgress = Math.abs(progress - this.prevProgress);
        this.prevProgress = progress;

        const easeInOutCubic = (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

        const rattleFreq = Date.now() * 0.075;
        const rattleBase = (deltaProgress > 0.0001) ? (2 + Math.sin(rattleFreq) * 2) * (1 - progress) : 0;
        const jitterX = (Math.random() - 0.5) * rattleBase + Math.sin(rattleFreq * 0.5) * (rattleBase * 0.3);
        const jitterY = (Math.random() - 0.5) * rattleBase + Math.cos(rattleFreq * 0.5) * (rattleBase * 0.3);

        const dollyFrom = progress * 2200;
        const h_unit = this.linesFrom.length * 32;
        const w_max = this.linesFrom.length > 0 ? Math.max(...this.linesFrom.map(l => l.width)) : 0;
        
        const numRepeats = 8;
        const h_total = h_unit * numRepeats;
        const zArrival = 5800;
        const dollyTo = progress * (zArrival - 500);

        const fromStyle = this.fromElement ? window.getComputedStyle(this.fromElement) : null;
        const fromWeight = fromStyle ? fromStyle.fontWeight : '400';
        const fromSize = fromStyle ? parseFloat(fromStyle.fontSize) : 16;
        this.lastFromWeight = fromWeight;
        this.lastFromSize = fromSize;

        if (this.fromElement) {
            const fromRect = this.fromElement.getBoundingClientRect();
            const easeOutQuart = (t) => 1 - Math.pow(1 - t, 4);
            const handoverThreshold = vH * 0.15;

            if (fromRect.bottom > handoverThreshold) {
                this.fromElement.style.visibility = 'visible';
                opacity3D = 0;
                tiltProgress = 0;
            } else {
                this.fromElement.style.visibility = 'hidden';
                opacity3D = 1;
                const exitDist = 400;
                const rawTilt = Math.max(0, Math.min(1, (handoverThreshold - fromRect.bottom) / exitDist));
                tiltProgress = easeOutQuart(rawTilt);
                rotationX = (85 * tiltProgress) * (Math.PI / 180);
                const initialY = fromRect.top + (fromRect.height / 2) - centerY;
                const targetGroundY = 220;
                groundY = initialY * (1 - tiltProgress) + targetGroundY * tiltProgress;
            }
        } else {
            tiltProgress = 1;
            rotationX = 85 * (Math.PI / 180);
            groundY = 220;
        }

        this.lastFromColor = `rgb(${Math.floor(13 + (139 - 13) * tiltProgress)}, ${Math.floor(9 + (69 - 9) * tiltProgress)}, ${Math.floor(0 + (19 - 0) * tiltProgress)})`;

        ctx.textBaseline = 'middle';
        const toStyle = this.toElement ? window.getComputedStyle(this.toElement) : null;
        const targetColor = toStyle ? toStyle.color : 'rgb(13, 9, 0)';
        const targetFontSize = toStyle ? parseFloat(toStyle.fontSize) : 16;
        const targetWeight = toStyle ? toStyle.fontWeight : '400';
        const lineH = toStyle ? parseFloat(toStyle.lineHeight) : 32;

        const transitionStart = 0.82;
        const handoverEnd = 0.99;
        const handoverRange = handoverEnd - transitionStart;

        let didSaveFrom = false;
        if (this.linesFrom.length > 0) {
            const corners = [
                { x: -w_max / 2, y_rel: -h_total + (h_unit / 2) },
                { x: w_max / 2, y_rel: -h_total + (h_unit / 2) },
                { x: w_max / 2, y_rel: h_unit / 2 + 40 },
                { x: -w_max / 2, y_rel: h_unit / 2 + 40 }
            ];

            const projected = corners.map(p => {
                const y1 = groundY + p.y_rel * Math.cos(rotationX);
                const z1 = -p.y_rel * Math.sin(rotationX);
                const zFinal = z1 + 1000 - dollyFrom;
                if (zFinal <= 1) return null;
                const fovScale = 700 / zFinal;
                return { x: centerX + p.x * fovScale, y: centerY + y1 * fovScale };
            }).filter(p => p !== null);

            if (projected.length === 4) {
                const alphaDist = Math.max(0, 1 - (progress * 1.1));
                ctx.globalAlpha = opacity3D * alphaDist;
                ctx.save();
                didSaveFrom = true;
                ctx.beginPath();
                ctx.moveTo(projected[0].x, projected[0].y);
                ctx.lineTo(projected[1].x, projected[1].y);
                ctx.lineTo(projected[2].x, projected[2].y);
                ctx.lineTo(projected[3].x, projected[3].y);
                ctx.closePath();
                ctx.clip();
            }
        }

        ctx.textAlign = 'center';
        for (let j = numRepeats - 1; j >= 0; j--) {
            const y_offset = -j * h_unit;
            
            const j_z_start = -(-j * h_unit) * Math.sin(rotationX) + 1000 - dollyFrom;
            const j_z_end = -(h_unit - j * h_unit) * Math.sin(rotationX) + 1000 - dollyFrom;
            if (Math.min(j_z_start, j_z_end) > 4800 || Math.max(j_z_start, j_z_end) < -500) continue;

            this.linesFrom.forEach((line, i) => {
                const y_rel = (i - this.linesFrom.length / 2) * 32 + y_offset;
                const y1 = groundY + y_rel * Math.cos(rotationX);
                const z1 = -y_rel * Math.sin(rotationX);
                const zFinal = z1 + 1000 - dollyFrom;
                if (zFinal <= 1 || zFinal > 4800) return;
                const fovScale = 700 / zFinal;
                const x_proj = centerX + jitterX;
                const y_proj = centerY + y1 * fovScale + jitterY;
                let alphaDist = 1.0;
                if (progress > transitionStart) {
                    alphaDist = Math.max(0, 1 - (progress - transitionStart) / (handoverEnd - transitionStart));
                }
                const zMid = z1 + 1000 - dollyFrom;
                const distanceFade = Math.max(0, Math.min(1, (4000 - zMid) / 200));
                ctx.globalAlpha = opacity3D * alphaDist * Math.min(1, zFinal / 200) * (0.8 * distanceFade);
                const padX = 8;
                const padY = 16;
                const lineCorners = [
                    { x: -line.width / 2 - padX, y_rel: y_rel - padY },
                    { x: line.width / 2 + padX, y_rel: y_rel - padY },
                    { x: line.width / 2 + padX, y_rel: y_rel + padY },
                    { x: -line.width / 2 - padX, y_rel: y_rel + padY }
                ];
                const lineProj = lineCorners.map(p => {
                    const py1 = groundY + p.y_rel * Math.cos(rotationX);
                    const pz1 = -p.y_rel * Math.sin(rotationX);
                    const pzFinal = pz1 + 1000 - dollyFrom;
                    if (pzFinal <= 1) return null;
                    const pScale = 700 / pzFinal;
                    return { x: centerX + p.x * pScale + jitterX, y: centerY + py1 * pScale + jitterY };
                }).filter(p => p !== null);
                
                if (lineProj.length === 4 && zFinal < 3000) {
                    ctx.beginPath();
                    ctx.moveTo(lineProj[0].x, lineProj[0].y);
                    ctx.lineTo(lineProj[1].x, lineProj[1].y);
                    ctx.lineTo(lineProj[2].x, lineProj[2].y);
                    ctx.lineTo(lineProj[3].x, lineProj[3].y);
                    ctx.closePath();
                    ctx.fillStyle = '#fdfcf0';
                    ctx.fill();
                }
                const fs = Math.floor(fromSize * fovScale);
                if (fs < 2) return;
                ctx.font = `${fromWeight} ${fs}px "Courier New", monospace`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle'; 
                ctx.fillStyle = this.lastFromColor;
                
                if (fs < 10) {
                    ctx.fillText(line.text, x_proj, y_proj);
                    return;
                }

                let hasHoleOnLine = false;
                for (let k = 0; k < line.text.length; k++) {
                    if (this.tornCharacters.has(`from_${i}_${k}_${j}`)) {
                        hasHoleOnLine = true;
                        break;
                    }
                }

                if (!hasHoleOnLine) {
                    if (zFinal > 1200) {
                        const density = zFinal > 2800 ? 0.12 : 0.4;
                        const targetLen = Math.max(8, Math.floor(line.text.length * density));
                        let sparseStr = "";
                        const alphabet = this.alphabet;
                        for (let k = 0; k < targetLen; k++) {
                             const seed = (i * 7 + k * 13 + j * 17) % alphabet.length;
                             sparseStr += alphabet[seed];
                        }
                        ctx.fillText(sparseStr, x_proj, y_proj, line.width * fovScale);
                    } else {
                        ctx.fillText(line.text, x_proj, y_proj);
                    }
                } else {
                    const charW = (line.width * fovScale) / line.text.length;
                    const startX = x_proj - (line.width * fovScale) / 2 + charW / 2;
                    for (let k = 0; k < line.text.length; k++) {
                        if (!this.tornCharacters.has(`from_${i}_${k}_${j}`)) {
                            ctx.fillText(line.text[k], startX + k * charW, y_proj);
                        }
                    }
                }
            });
        }
        if (didSaveFrom) ctx.restore();

        const isStableOnGround = (tiltProgress >= 0.88 && progress > 0.22);
        if (isStableOnGround) this.hasScrolledOnGround = true; 
        
        this.updateDust(deltaProgress, centerX, groundY, dollyFrom, w_max, tiltProgress, isStableOnGround);
        this.renderDust(ctx, centerX, centerY, groundY, dollyFrom, jitterX, jitterY);

        if (this.toElement) {
            if (progress < transitionStart) {
                this.toElement.style.visibility = 'hidden';
                this.toElement.style.opacity = '0';
                this.toElement.style.pointerEvents = 'none';
            } else if (progress >= handoverEnd) {
                this.toElement.style.visibility = 'visible';
                this.toElement.style.opacity = '1';
                this.toElement.style.pointerEvents = 'auto';
            } else {
                const fadeProgress = (progress - transitionStart) / handoverRange;
                const easedFade = easeInOutCubic(Math.min(1, Math.max(0, fadeProgress)));
                this.toElement.style.visibility = 'visible';
                this.toElement.style.opacity = easedFade;
                this.toElement.style.pointerEvents = 'auto';
            }
        }

        if (progress >= 0.999 || progress <= 0) {
            this.canvas.style.display = 'none';
            return;
        } else {
            this.canvas.style.display = 'block';
        }

        const rawFactor = progress > transitionStart ? (progress - transitionStart) / (1 - transitionStart) : 0;
        const flattenFactor = easeInOutCubic(rawFactor);
        ctx.textAlign = 'left';

        ctx.save();
        let horizonClipY = 0;
        if (this.fromElement) {
            const fromRect = this.fromElement.getBoundingClientRect();
            horizonClipY = Math.max(0, fromRect.bottom);
        } else {
            horizonClipY = centerY + (groundY * 0.5);
        }
        ctx.beginPath();
        ctx.rect(0, horizonClipY, w, h - horizonClipY);
        ctx.clip();

        let didSaveTo = false;
        if (this.linesTo.length > 0) {
            const h_unit_to = lineH;
            const h_total_to = this.linesTo.length * h_unit_to;
            const w_max_to = Math.max(...this.linesTo.map(l => l.width)) + 120;
            const corners_to = [
                { x: -w_max_to / 2, y_rel: -h_total_to / 2 - 40 },
                { x: w_max_to / 2, y_rel: -h_total_to / 2 - 40 },
                { x: w_max_to / 2, y_rel: h_total_to / 2 + 40 },
                { x: -w_max_to / 2, y_rel: h_total_to / 2 + 40 }
            ];
            const projected_to = corners_to.map(p => {
                const zFinal = zArrival - dollyTo;
                if (zFinal <= 1) return null;
                const scale = Math.min(1.0, 700 / zFinal);
                const x3 = centerX + p.x * scale;
                const y3 = centerY + p.y_rel * scale;
                const toRect = this.toElement.getBoundingClientRect();
                const x_anchor = toRect.left + (window.innerWidth < 768 ? window.innerWidth * 0.08 : 0);
                const y_anchor = toRect.top;
                let xf = x_anchor + (w_max_to - 120) / 2 + p.x;
                let yf = y_anchor + (p.y_rel + h_total_to / 2);
                return { x: x3 * (1 - flattenFactor) + xf * flattenFactor + jitterX, y: y3 * (1 - flattenFactor) + yf * flattenFactor + jitterY };
            }).filter(p => p !== null);

            if (projected_to.length === 4) {
                const pHandover = progress > transitionStart ? (progress - transitionStart) / handoverRange : 0;
                const plateAlpha = Math.min(1, progress * 4) * (1 - easeInOutCubic(Math.min(1, pHandover)));
                ctx.globalAlpha = Math.max(0, plateAlpha);
                ctx.save();
                didSaveTo = true;
                ctx.beginPath();
                ctx.moveTo(projected_to[0].x, projected_to[0].y);
                ctx.lineTo(projected_to[1].x, projected_to[1].y);
                ctx.lineTo(projected_to[2].x, projected_to[2].y);
                ctx.lineTo(projected_to[3].x, projected_to[3].y);
                ctx.closePath();
                ctx.clip();
            }
        }

        this.linesTo.forEach((line, i) => {
            const y_rel = (i - this.linesTo.length / 2) * lineH;
            const zFinal = zArrival - dollyTo;
            if (zFinal <= 1) return;
            const scale = Math.min(1.0, 700 / zFinal);
            let x_flat = centerX - line.width / 2;
            let y_flat = centerY + y_rel;
            if (this.toElement) {
                const toRect = this.toElement.getBoundingClientRect();
                x_flat = toRect.left;
                y_flat = toRect.top + i * lineH + lineH / 2;
            }
            const buildingStretch = 1 + (2.0 * Math.pow(1 - progress, 1.5));
            const y_stretched = y_rel * buildingStretch;
            const textBlockHeight = this.linesTo.length * lineH;
            const y_3d_bottom_offset = (textBlockHeight / 2) * (buildingStretch - 1);
            const y_3d_pos = (groundY + y_stretched) - y_3d_bottom_offset;
            let x_flat_center = centerX;
            if (this.toElement) {
                const toRect = this.toElement.getBoundingClientRect();
                x_flat_center = toRect.left + line.width / 2;
            }
            const x_3d = centerX - (line.width * scale) / 2;
            const x_3d_adj = x_3d + (x_flat_center - centerX) * (1 - progress); 
            const y_3d = centerY + y_3d_pos * scale;
            const x_proj = x_3d_adj * (1 - flattenFactor) + x_flat * flattenFactor + jitterX;
            const y_proj = y_3d * (1 - flattenFactor) + y_flat * flattenFactor + jitterY;
            const finalScale = scale * (1 - flattenFactor) + 1.0 * flattenFactor;
            const match = targetColor.match(/\d+/g);
            const r = match ? parseInt(match[0]) : 13;
            const g = match ? parseInt(match[1]) : 9;
            const b = match ? parseInt(match[2]) : 0;
            let canvasAlpha = Math.min(1, Math.pow(Math.max(0, (progress - 0.05) * 1.5), 1.2));
            if (progress > transitionStart) {
                const pHandover = (progress - transitionStart) / handoverEnd;
                canvasAlpha *= (1 - easeInOutCubic(Math.min(1, pHandover)));
            }
            const padX = 8;
            const padY = lineH / 2;
            const lCornersTo = [
                { x: -line.width / 2 - padX, y_rel: -padY },
                { x: line.width / 2 + padX, y_rel: -padY },
                { x: line.width / 2 + padX, y_rel: +padY },
                { x: -line.width / 2 - padX, y_rel: +padY }
            ];
            const lProjTo = lCornersTo.map(p => {
                const zF = zArrival - dollyTo;
                const pScale = Math.min(1.0, 700 / Math.max(1, zF));
                const px3 = centerX + p.x * pScale;
                const py3 = centerY + (y_3d_pos + p.y_rel) * pScale;
                const pxf = x_flat + (line.width / 2) + p.x;
                const pyf = y_flat + p.y_rel;
                return { x: px3 * (1 - flattenFactor) + pxf * flattenFactor, y: py3 * (1 - flattenFactor) + pyf * flattenFactor };
            }).filter(p => p !== null);
            if (lProjTo.length === 4) {
                ctx.save();
                ctx.globalAlpha = Math.min(1, canvasAlpha * 2);
                ctx.beginPath();
                ctx.moveTo(lProjTo[0].x, lProjTo[0].y);
                ctx.lineTo(lProjTo[1].x, lProjTo[1].y);
                ctx.lineTo(lProjTo[2].x, lProjTo[2].y);
                ctx.lineTo(lProjTo[3].x, lProjTo[3].y);
                ctx.closePath();
                ctx.fillStyle = '#fdfcf0';
                ctx.fill();
                ctx.restore();
            }
            ctx.globalAlpha = canvasAlpha;
            ctx.font = `${targetWeight} ${Math.floor(targetFontSize * finalScale)}px "Courier New", monospace`;
            const horizonFade = Math.min(1, (3000 - zFinal) / 500);
            ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${horizonFade})`;
            ctx.fillText(line.text, x_proj, y_proj);
        });
        if (didSaveTo) ctx.restore();
        ctx.restore();
        ctx.restore();
    }

    updateDust(delta, centerX, groundY, dollyFrom, w_max, tiltProgress, isStableOnGround) {
        const rotationX = (85 * tiltProgress) * (Math.PI / 180);
        const h_unit = (this.linesFrom.length || 1) * 32;
        const numRepeats = 8;

        if (isStableOnGround) {
            if (Math.random() > 0.1) { 
                const useTo = (this.progress > 0.45 && this.linesTo.length > 0 && Math.random() > 0.5);
                const pool = useTo ? this.linesTo : this.linesFrom;
                if (pool.length > 0) {
                    const i = Math.floor(Math.random() * pool.length);
                    const j = Math.floor(Math.random() * numRepeats);
                    const lineText = pool[i].text || " ";
                    const charIdx = Math.floor(Math.random() * lineText.length);
                    const holeKey = `${useTo ? 'to' : 'from'}_${i}_${charIdx}_${j}`;
                    
                    if (lineText[charIdx] !== ' ' && !this.tornCharacters.has(holeKey)) {
                        const yPaper = (i - pool.length / 2) * 32 - j * h_unit;
                        const rotS = useTo ? (85 * (1 - this.progress)) * (Math.PI / 180) : rotationX;
                        const pZ = -yPaper * Math.sin(rotS);
                        const zFinal = pZ + 1000 - dollyFrom;

                        if (zFinal > 120 && zFinal < 4600) {
                            const charWidth = (pool[i].width || w_max) / lineText.length;
                            const exactX = (charIdx - lineText.length / 2) * charWidth;
                            this.tornCharacters.set(holeKey, 1.0);
                            this.dust.push({
                                type: 'ROAD_DUST',
                                x: exactX, y: 0, z: pZ,
                                vx: 0.4 + Math.random() * 1.2, ax: 0.15 + Math.random() * 0.25,
                                vy: -1.5 - Math.random() * 2, vz: 0,
                                char: lineText[charIdx], life: 1.2,
                                rot: Math.random() * 6.28, vRot: (Math.random() > 0.5 ? 1 : -1) * (0.1 + Math.random() * 0.2),
                                flutter: Math.random() * 6.28, scaleMult: 1.0, stretchMax: 1.25, stretchDecay: 0.1
                            });
                        }
                    }
                }
            }
            const isMoving = delta > 0.0001;
            if (this.hasScrolledOnGround && isMoving && this.progress < 0.98 && Math.random() > 0.3) {
                const pool = this.linesFrom; 
                const num = Math.min(3, Math.ceil(delta * 1000)); 
                const rotX = (85 * Math.PI / 180); 

                for (let k = 0; k < num; k++) {
                    if (Math.random() > 0.6) continue; 
                    const pZ = (dollyFrom - 450) + (Math.random() - 1.0) * 150;
                    const pX = (Math.random() - 0.5) * (w_max * 0.8);
                    const L = pool.length;
                    const y_rel = -pZ / Math.sin(rotX);
                    const K = Math.round(y_rel / 32 + L / 2);
                    const i = ((K % L) + L) % L;
                    const j = Math.floor((i - K) / L);
                    const line = pool[i];
                    if (!line) continue;
                    const lineText = line.text;
                    const charW = (line.width || w_max) / lineText.length;
                    const charIdx = Math.round(pX / charW + lineText.length / 2);

                    if (charIdx >= 0 && charIdx < lineText.length && lineText[charIdx] !== ' ') {
                        const holeKey = `from_${i}_${charIdx}_${j}`;
                        if (!this.tornCharacters.has(holeKey)) {
                            this.tornCharacters.set(holeKey, 1.0);
                            this.dust.push({
                                type: 'WAK_CLOUD',
                                x: (charIdx - lineText.length / 2) * charW, y: 0, z: pZ,
                                vx: (Math.random() - 0.5) * 6, vy: -4 - Math.random() * 8, vz: (Math.random() - 0.5) * 5,
                                char: lineText[charIdx], life: 1.0,
                                rot: Math.random() * 6.28, vRot: (Math.random() - 0.5) * 0.4,
                                growth: 1.04 + Math.random() * 0.03, flutter: Math.random() * 6.28,
                                scaleMult: 1.0, stretchMax: 1.4, stretchDecay: 0.15
                            });
                        }
                    }
                }
            }
        }

        for (let i = this.dust.length - 1; i >= 0; i--) {
            const p = this.dust[i];
            if (p.type === 'ROAD_DUST') {
                const edgeBoost = (Math.abs(p.x) > w_max * 0.4 || p.life < 0.5) ? 1.5 : 1.0;
                p.vx += (p.ax || 0.1) * edgeBoost;
                p.flutter = (p.flutter || 0) + 0.12;
                p.z += Math.sin(p.flutter) * 1.2;
                p.x += Math.cos(p.flutter * 0.5) * 0.7;
            }
            p.x += (p.vx || 0);
            if (p.type === 'WAK_CLOUD') {
                p.flutter = (p.flutter || 0) + 0.15;
                p.x += Math.sin(p.flutter) * 0.8; 
            }
            p.y += (p.vy || 0);
            p.z += (p.vz || 0);
            p.rot += (p.vRot || 0);
            p.life -= (p.type === 'WAK_CLOUD' ? 0.035 : 0.015);
            if (p.stretchMax && p.scaleMult < p.stretchMax) {
                p.scaleMult += p.stretchDecay || 0.05;
                if (p.scaleMult > p.stretchMax) p.stretchMax = 0; 
            } else if (p.scaleMult > 1.0) {
                p.scaleMult -= 0.02; 
            }
            if (p.type === 'WAK_CLOUD') p.scaleMult *= p.growth;
            const zF = (p.z || 0) + 1000 - dollyFrom;
            if (p.life <= 0 || zF < -300 || zF > 5000) this.dust.splice(i, 1);
        }
        if (this.dust.length > 300) this.dust.splice(0, 50);
        for (const [key, life] of this.tornCharacters.entries()) {
            const nextLife = life - 0.005; 
            if (nextLife <= 0) this.tornCharacters.delete(key);
            else this.tornCharacters.set(key, nextLife);
        }
    }

    renderDust(ctx, centerX, centerY, groundY, dollyFrom, jX, jY) {
        const chars = this.dust;
        ctx.save();
        for (let i = 0; i < chars.length; i++) {
            const p = chars[i];
            const zFinal = (p.z || 0) + 1000 - dollyFrom;
            if (zFinal <= 40 || zFinal > 5000) continue;
            const fov = 700 / zFinal;
            const x_proj = centerX + (p.x || 0) * fov + jX;
            const y_proj = centerY + (groundY + (p.y || 0)) * fov + jY;
            if (isNaN(x_proj) || isNaN(y_proj)) continue;
            const scale = fov * (p.scaleMult || 1.0);
            ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 1.5));
            ctx.save();
            ctx.translate(x_proj, y_proj);
            ctx.rotate(p.rot || 0);
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle'; 
            if (p.type === 'ROAD_DUST' || p.type === 'WAK_CLOUD') {
                const fs_sync = Math.floor((this.lastFromSize || 16) * scale);
                ctx.font = `${this.lastFromWeight || 'bold'} ${fs_sync}px "Courier New", monospace`;
                ctx.fillStyle = this.lastFromColor || '#8B4513'; 
                ctx.fillText(p.char, 0, 0);
            }
            ctx.restore();
        }
        ctx.restore();
    }
}
