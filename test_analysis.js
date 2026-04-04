
const firmasViaje = {
    tierra: ["HERVÉ JONCOUR partió", "HERVË JONCOUR partió", "A pie, recorriendo caminos secundarios", "ochocientos kilómetros de tierra"],
    mar: ["SEIS DÍAS después", "Seis días después", "barco llamado Adel", "mil seiscientas millas de mar"]
};

function analizarViaje(texto) {
    const esMar = firmasViaje.mar.some(f => texto.includes(f));
    const esTierra = firmasViaje.tierra.some(f => texto.includes(f));
    if (esMar) return { tipo: 'agua' };
    if (esTierra) return { tipo: 'tierra' };
    return { tipo: 'normal' };
}

const fs = require('fs');
const content = fs.readFileSync('c:\\Users\\chris\\Desktop\\seda_pretext\\pretext_sed\\seda.js', 'utf8');
const textMatch = content.match(/const textoNovela = `([\s\S]+?)`;/);
if (textMatch) {
    const textoNovela = textMatch[1];
    const paragraphs = textoNovela.split(/\n\s*\n/).filter(p => p.trim() !== '');
    paragraphs.forEach((p, i) => {
        const type = analizarViaje(p).tipo;
        if (p.includes("CORRÍA El AÑO de 1861. Flaubert estaba terminando Salambó")) {
            console.log(`Paragraph ${i}: [${type}] ${p.substring(0, 50)}...`);
            if (paragraphs[i+1]) {
                console.log(`Next Paragraph ${i+1}: [${analizarViaje(paragraphs[i+1]).tipo}] ${paragraphs[i+1].substring(0, 50)}...`);
            }
        }
    });
}
