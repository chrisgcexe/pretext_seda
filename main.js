/**
 * SEDA: MAIN ORCHESTRATOR
 * Punto de entrada de la aplicación. Coordina los módulos y el engine loop.
 */

import './src/utils/pretext.js'; // Carga window.Pretext

// Apagamos la restauración automática del scroll del navegador
if ('scrollRestoration' in history) {
    history.scrollRestoration = 'manual';
}
import { 
    activeOceans, 
    activeTransitions, 
    textoLeido, 
    isTransitionLocked, 
    frayTransitionStarted, 
    targetFrayProgress, 
    currentFrayProgress, 
    silkCoreP0,
    FRAY_LERP_FACTOR,
    setTransitionLocked,
    setFrayTransitionStarted,
    updateCurrentFrayProgress,
    lockScroll,
    inyectarParrafo
} from './src/managers/NarrativeManager.js';

/**
 * ENGINE LOOP
 */
function setupScrollEngine() {
    function update() {
        const vH = window.innerHeight;

        // 1. Océanos
        activeOceans.forEach(ocean => {
            const rect = ocean.parentTrack.getBoundingClientRect();
            if (rect.top <= vH && rect.bottom >= 0) {
                ocean.isVisible = true;
                const vesselH = ocean.vesselCanvas.offsetHeight;
                let targetY = (vH / 2) - (vesselH / 2) - rect.top;
                targetY = Math.max(0, Math.min(rect.height - vesselH, targetY));
                ocean.targetOffset = targetY;
                ocean.render(textoLeido);
            } else ocean.isVisible = false;
        });

        // 2. Transiciones 3D
        let primaryTrans = null;
        let minCenterDist = Infinity;
        activeTransitions.forEach(trans => {
            const rect = trans.track.getBoundingClientRect();
            const trackCenter = rect.top + rect.height / 2;
            const dist = Math.abs(vH / 2 - trackCenter);

            if (rect.top <= vH && rect.bottom >= 0) {
                trans.isVisible = true;
                trans.progress = Math.max(0, Math.min(1, (vH - rect.top) / (rect.height + vH)));
                if (dist < minCenterDist) { minCenterDist = dist; primaryTrans = trans; }
            } else trans.isVisible = false;
        });
        activeTransitions.forEach(trans => trans.render(trans === primaryTrans));

        // 3. SilkCanvas (Párrafo 1)
        const pInitial = document.querySelector('.p-initial-fray');
        if (pInitial && silkCoreP0) {
            const rect = pInitial.getBoundingClientRect();
            if (rect.top < vH && rect.bottom > -vH) {
                // FIX 4: Solo bloqueamos la transición si NO está reparada
                if (!frayTransitionStarted && rect.top < vH * 0.4 && rect.top > 0 && !silkCoreP0.isRepaired) {
                    setTransitionLocked(true);
                    setFrayTransitionStarted(true);
                }

                // NUEVO FIX: Desbloqueo INMEDIATO apenas se cose el hilo. Cero lag.
                if (silkCoreP0.isRepaired && isTransitionLocked) {
                    setTransitionLocked(false);
                }

                const finalDX = window.innerWidth * 0.05;
                const finalDY = window.innerHeight * 0.15;

                const newProg = currentFrayProgress + (targetFrayProgress - currentFrayProgress) * FRAY_LERP_FACTOR;
                updateCurrentFrayProgress(newProg);
                silkCoreP0.update(newProg, finalDX, finalDY);
            } else if (silkCoreP0.isRepaired) {
                silkCoreP0.ctx.clearRect(0, 0, silkCoreP0.canvas.width, silkCoreP0.canvas.height);
            }
        }

        requestAnimationFrame(update);
    }
    update();
}

/**
 * INITIALIZATION
 */
document.addEventListener('DOMContentLoaded', () => {
    const libro = document.getElementById('libro');
    if (!libro) return;

    libro.innerHTML = '';
    let lastElement = null;

    if (typeof textoNovela !== 'undefined') {
        const fragments = textoNovela.split(/\n\s*\n/).filter(p => p.trim() !== '');
        fragments.forEach((txt, i) => {
            const p = inyectarParrafo(txt.replace(/\n/g, ' ').trim(), libro, lastElement, i);
            if (p) {
                lastElement = p;
            }
        });
    }

    // Doble seguro: Forzamos el viewport al inicio absoluto
    window.scrollTo(0, 0);

    setupScrollEngine();

    window.addEventListener('wheel', lockScroll, { passive: false });
    window.addEventListener('touchmove', lockScroll, { passive: false });

    const leftoverCompass = document.getElementById('narrative-compass');
    if (leftoverCompass) leftoverCompass.remove();

    console.log("SEDA: Modular Engine Active (v2.0)");
});
