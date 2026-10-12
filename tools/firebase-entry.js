export { initializeApp } from "firebase/app";
export {
  getAuth, onAuthStateChanged, signOut, GoogleAuthProvider, signInWithPopup,
  sendSignInLinkToEmail, isSignInWithEmailLink, signInWithEmailLink, browserLocalPersistence, setPersistence
} from "firebase/auth";
export {
  getFirestore, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc, collection, query, where,
  orderBy, limit, serverTimestamp, Timestamp, arrayUnion, arrayRemove, deleteField, writeBatch, connectFirestoreEmulator
} from "firebase/firestore/lite";
export { connectAuthEmulator } from "firebase/auth";
