// Import the functions you need from the SDKs you need
import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyDe0zu9KDhNRc8KpDsPuH68xboL6M62r5E",
  authDomain: "localchat-6cadd.firebaseapp.com",
  projectId: "localchat-6cadd",
  storageBucket: "localchat-6cadd.firebasestorage.app",
  messagingSenderId: "855627558692",
  appId: "1:855627558692:web:f73f156a6f80c8c33f8db1",
  measurementId: "G-GCS8T557GZ"
};

// Initialize Firebase
export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);