/**
 * PRETEXT: Sistema de medición y layout de texto en Canvas con segmentación.
 * (Localmente extendido con getCharacterPositions)
 */
window.Pretext = {
    measureCache: new Map(),

    prepareWithSegments(text, fontString) {
        const segments = [];
        let current = "";
        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            current += char;
            if (char === " " || i === text.length - 1) {
                segments.push(current);
                current = "";
            }
        }
        return { segments, fontString };
    },

    layoutNextLine(prepared, start, maxWidth) {
        const { segments, fontString } = prepared;
        if (start.segmentIndex >= segments.length) return null;

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        ctx.font = fontString;

        let lineText = "";
        let currentWidth = 0;
        let i = start.segmentIndex;

        while (i < segments.length) {
            const seg = segments[i];
            const m = ctx.measureText(seg);
            if (currentWidth + m.width > maxWidth && lineText !== "") {
                break;
            }
            lineText += seg;
            currentWidth += m.width;
            i++;
        }

        return {
            text: lineText,
            width: currentWidth,
            end: { segmentIndex: i, graphemeIndex: 0 }
        };
    },

    getCharacterPositions(lineText, startX, startY, fontString) {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        ctx.font = fontString;

        const positions = [];
        let currentX = startX;
        for (let i = 0; i < lineText.length; i++) {
            const char = lineText[i];
            const m = ctx.measureText(char);
            positions.push({
                char,
                x: currentX + m.width / 2,
                y: startY,
                width: m.width
            });
            currentX += m.width;
        }
        return positions;
    }
};
