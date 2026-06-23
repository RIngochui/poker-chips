import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'

const firebaseConfig = {
  apiKey: 'AIzaSyCxPqBGA8-O8e56xUzibnxtI2JJaX0YGC0',
  authDomain: 'poker-chips-d7128.firebaseapp.com',
  projectId: 'poker-chips-d7128',
  storageBucket: 'poker-chips-d7128.firebasestorage.app',
  messagingSenderId: '702258432423',
  appId: '1:702258432423:web:43f9c50e1d74c4778a0e82',
}

export const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)
export const db = getFirestore(app)
