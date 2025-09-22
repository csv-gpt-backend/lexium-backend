// /api/ask.js
import OpenAI from 'openai';
import fs from 'fs/promises';
import path from 'path';
import pdfParse from 'pdf-parse';
import { parse as parseCsv } from 'csv-parse/sync';

// Compatibilidad con open_ai_key y OPENAI_API_KEY
const client = new OpenAI({
  apiKey: process.env.open_ai_key || process.env.OPENAI_API_KEY
});

// Modelo por defecto GPT-5
const MODEL = process.env.OPENAI_MODEL || 'gpt-5.1';

// Cache simple para no recargar archivos en cada request
let CACHE = null;

async function readMaybeLocal(file) {
  try {
    const p = path.join(process.cwd(), file);
    return await fs.readFile(p);
  } catch {
    return null;
  }
}

async function fetchAsBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('No se pudo descargar: ' + url);
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

async function loadSources() {
  if (CACHE) return CACHE;

  const csvFile = process.env.CSV_FILE || 'decimo.csv';
  const csvURL = process.env.CSV_URL || '';

  const pdfFiles = (process.env.PDF_FILES || 'emocionales.pdf,lexium.pdf,evaluaciones.pdf')
    .split(',').map(s => s.trim()).filter(Boolean);

  const pdfURLs = (process.env.PDF_URLS || '')
    .split(',').map(s => s.trim()).filter(Boolean);

  // ===== CSV =====
  let csvBuf = await readMaybeLocal(csvFile);
  if (!csvBuf && csvURL) csvBuf = await fetchAsBuffer(csvURL);

  let csvRaw = '';
  let csvRows = [];
  if (csvBuf) {
    csvRaw = csvBuf.toString('utf8');
    try {
      csvRows = parseCsv(csvRaw, { columns: true, skip_empty_lines: true });
    } catch {
      // Intentar con delimitador ;
      csvRows = parseCsv(csvRaw, {
        columns: true,
        skip_empty_lines: true,
        delimiter: ';'
      });
    }
  }

  // ===== PDFs =====
  const pdfTexts = [];

  // Locales
  for (const f of pdfFiles) {
    const buf = await readMaybeLocal(f);
    if (buf) {
      const data = await pdfParse(buf);
      pdfTexts.push(`# ${f}\n${data.text || ''}`);
    }
  }

  // URLs
  for (const url of pdfURLs) {
    if (!url) continue;
    const buf = await fetchAsBuffer(url);
    const data = await pdfParse(buf);
    pdfTexts.push(`# ${url}\n${data.text || ''}`);
  }

  CACHE = { csvRaw, csvRows, pdfText: pdfTexts.join('\n\n---\n\n') };
  return CACHE;
}

function buildSystemPrompt() {
  return `Eres una analista senior (voz femenina, español Ecuador/México). Reglas duras:
- Responde SIEMPRE en español neutral latino (MX/EC). Sin asteriscos (*).
- NO digas frases como "Según el CSV..." ni "No puedo realizar...".
- Si faltan datos, deduce y explica brevemente.
- Obedece filtros y órdenes de ordenamiento EXACTAMENTE.
- Realiza cálculos psicométricos, promedios, regresiones, progresiones y análisis estadísticos si se piden.
- Cuando el usuario pida listas/tablas, entrégalas en formato Markdown.
- Devuelve SOLO JSON válido con esta estructura:
{
  "texto": "explicación clara y detallada",
  "tablas_markdown": "tablas si aplica, cadena vacía si no"
}`;
}

function buildUserPrompt(question, csvRaw, pdfText) {
  // Si el CSV es muy grande, recortar para evitar exceso de tokens
  let csvSnippet = csvRaw;
  if (csvRaw && csvRaw.length > 250_000) {
    csvSnippet = csvRaw.slice(0, 250_000);
  }

  return `PREGUNTA DEL USUARIO: ${question}

CONTEXTOS:
- CSV (decimo):
${csvSnippet}

- PDFs (emocionales, lexium, evaluaciones):
${pdfText}

FORMATO:
Responde SOLO con un JSON exactamente como:
{
  "texto": "respuesta detallada",
  "tablas_markdown": "si no hay tablas, cadena vacía"
}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  try {
    const body = await req.json?.() || req.body || {};
    const question = (body.question || '').replace(/\*/g, '').trim();
    if (!question) {
      return res.status(400).json({ error: 'Pregunta vacía' });
    }

    const { csvRaw, pdfText } = await loadSources();

    const messages = [
      { role: 'system', content: buildSystemPrompt() },
      { role: 'user', content: buildUserPrompt(question, csvRaw, pdfText) }
    ];

    const completion = await client.chat.completions.create({
      model: MODEL,
      messages,
      temperature: 0.2,
      response_format: { type: 'json_object' }
    });

    const raw = completion.choices?.[0]?.message?.content || '{}';

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = { texto: raw, tablas_markdown: '' };
    }

    const safe = {
      texto: String(parsed.texto || '').replace(/\*/g, ''),
      tablas_markdown: String(parsed.tablas_markdown || '').replace(/\*/g, '')
    };

    res.setHeader('Content-Type', 'application/json');
    res.status(200).end(JSON.stringify(safe));
  } catch (err) {
    console.error('Error en /api/ask:', err);
    res.status(200).json({
      texto: 'Error procesando la consulta. Verifica que los archivos y la API Key estén configurados correctamente.',
      tablas_markdown: ''
    });
  }
}
