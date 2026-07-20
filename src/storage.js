import { db } from "./firebase";
import {
  collection, doc, addDoc, updateDoc,
  onSnapshot, query, orderBy, limit, arrayUnion, arrayRemove,
} from "firebase/firestore";

// ---------- personal data (this device only) ----------
export const localGet = (key, fallback) => {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch (e) {
    return fallback;
  }
};

export const localSet = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {}
};

// ---------- shared data (Firestore — visible to the whole group) ----------
export function subscribeFeed(cb) {
  const q = query(collection(db, "feedEntries"), orderBy("date", "desc"), limit(60));
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
}

export async function addFeedEntry(entry) {
  await addDoc(collection(db, "feedEntries"), entry);
}

export async function toggleFeedReaction(id, name, alreadyReacted) {
  const ref = doc(db, "feedEntries", id);
  await updateDoc(ref, { reactions: alreadyReacted ? arrayRemove(name) : arrayUnion(name) });
}

export function subscribeAssigned(cb) {
  const q = query(collection(db, "assignedWorkouts"), orderBy("createdAt", "desc"), limit(100));
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
}

export async function addAssignedWorkout(entry) {
  await addDoc(collection(db, "assignedWorkouts"), entry);
}

export async function markAssignedStatus(id, status) {
  await updateDoc(doc(db, "assignedWorkouts", id), { status });
}
