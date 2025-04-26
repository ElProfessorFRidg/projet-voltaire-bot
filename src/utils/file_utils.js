// Utilitaires pour la gestion des fichiers et des dossiers (Node.js)
import fs from 'fs/promises';
import path from 'path';

// Crée le dossier si besoin et écrit le fichier (texte ou JSON)
export async function ensureDirAndWriteFile(filePath, data, options = {}) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  if (options.json) {
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
  } else {
    await fs.writeFile(filePath, data, 'utf-8');
  }
}

// Lecture d'un fichier JSON (retourne null si absent)
export async function readJsonFile(filePath) {
  try {
    const data = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(data);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

// Écriture d'un fichier JSON
export async function writeJsonFile(filePath, data) {
  await ensureDirAndWriteFile(filePath, data, { json: true });
}

// Gestion des temps de session (lecture/écriture)
export async function readSessionTimes(sessionTimesPath) {
  const data = await readJsonFile(sessionTimesPath);
  return data || {};
}

export async function writeSessionTimes(sessionTimesPath, sessionTimes) {
  await writeJsonFile(sessionTimesPath, sessionTimes);
}

// Gestion de la durée globale (lecture/écriture)
export async function readDuration(durationPath) {
  const data = await readJsonFile(durationPath);
  return (data && typeof data.duration === 'number') ? data.duration : 0;
}

export async function writeDuration(durationPath, duration) {
  await writeJsonFile(durationPath, { duration });
}