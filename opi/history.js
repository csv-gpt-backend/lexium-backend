import { db } from './firebase.js';
import { collection, getDocs } from 'firebase/firestore';

export default async function handler(req, res) {
    if (req.method === 'GET') {
        try {
            const sessionsCollection = collection(db, 'sessions');
            const sessionDocs = await getDocs(sessionsCollection);
            const sessions = sessionDocs.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            res.status(200).json(sessions);
        } catch (error) {
            console.error('Error al obtener el historial:', error);
            res.status(500).json({ error: 'Error al obtener el historial', details: error.message });
        }
    } else {
        res.status(405).json({ error: 'Método no permitido' });
    }
}
