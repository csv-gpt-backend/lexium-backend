import { OpenAI } from "openai";
import { db, saveSession } from './firebase.js';
import Busboy from 'busboy';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { getAuth, signInWithCustomToken } from 'firebase/auth';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const conversations = new Map();
const analyzedFiles = new Map();

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  const auth = getAuth();
  // We use a predefined token to authenticate as an admin user.
  // This is a simple authentication method for this demo.
  try {
      if (typeof __initial_auth_token !== 'undefined') {
        await signInWithCustomToken(auth, __initial_auth_token);
      }
  } catch (error) {
      console.error('Error with firebase authentication:', error);
  }

  const sessionId = req.headers['x-session-id'] || 'default-session';
  let currentAnalyzedFiles = analyzedFiles.get(sessionId) || {};

  try {
    if (req.method === 'POST') {
      if (req.headers['content-type'] && req.headers['content-type'].includes('multipart/form-data')) {
        // Handle file uploads
        await new Promise((resolve, reject) => {
          const busboy = Busboy({ headers: req.headers });
          busboy.on('file', (name, file, info) => {
            const tempFilePath = path.join(os.tmpdir(), info.filename);
            const writeStream = fs.createWriteStream(tempFilePath);
            file.pipe(writeStream);
            writeStream.on('close', () => {
              const fileContent = fs.readFileSync(tempFilePath, 'utf-8');
              currentAnalyzedFiles[info.filename] = fileContent;
              fs.unlinkSync(tempFilePath);
              resolve();
            });
            writeStream.on('error', reject);
          });
          busboy.on('finish', () => {
            analyzedFiles.set(sessionId, currentAnalyzedFiles);
            res.status(200).json({ status: 'Archivos analizados' });
          });
          req.pipe(busboy);
        });
      } else if (req.headers['content-type'] && req.headers['content-type'].includes('application/json')) {
        // Handle chat messages
        const { message } = req.body;
        
        const fileData = Object.entries(currentAnalyzedFiles).map(([filename, content]) => 
          `### Contenido de ${filename}\n${content}`
        ).join('\n\n');

        const prompt = `Actúa como un asistente de análisis de datos. Responde a la siguiente pregunta basándote en la información de los archivos proporcionados. Si la pregunta pide cálculos, listados o tablas, genéralas.
          Información de los archivos:\n\n${fileData}\n\nPregunta del usuario: ${message}`;
        
        const response = await openai.chat.completions.create({
          model: "gpt-4o",
          messages: [{ role: "user", content: prompt }],
        });
        
        let responseText = response.choices[0].message.content;

        // Eliminar frases no deseadas
        responseText = responseText.replace(/SEGÚN EL ARCHIVO CSV HE SACADO LA INFORMACIÓ/g, '');
        responseText = responseText.replace(/No puedo realizar\./g, 'No pude encontrar la información para esa consulta.');

        await saveSession(sessionId, message, responseText);

        res.status(200).json({ response: responseText });
      } else {
        res.status(400).json({ error: 'Tipo de contenido no soportado' });
      }
    } else {
      res.status(405).json({ error: 'Método no permitido' });
    }
  } catch (error) {
    console.error('Error en la API:', error);
    res.status(500).json({ error: 'Error interno del servidor', details: error.message });
  }
}
