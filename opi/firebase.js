import { initializeApp } from 'firebase/app';
import { getFirestore, doc, setDoc, collection, getDocs } from 'firebase/firestore';

// Estas variables deben ser configuradas en Vercel
const firebaseConfig = {
    apiKey: process.env.FIREBASE_API_KEY,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN,
    projectId: process.env.FIREBASE_PROJECT_ID,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.FIREBASE_APP_ID
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Función para guardar sesiones en Firestore
export async function saveSession(sessionId, message, response) {
    try {
        const sessionRef = doc(db, 'sessions', sessionId);
        await setDoc(sessionRef, {
            messages: [{ user: message, assistant: response }],
            timestamp: new Date().toISOString()
        }, { merge: true });
        console.log("Sesión guardada con éxito.");
    } catch (e) {
        console.error("Error al guardar la sesión: ", e);
    }
}

export { db };
