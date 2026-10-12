// Firebase web app settings (public by design; access is controlled by
// firestore.rules). The directory uses Rapid Response's project, with all of
// its data under ngo/dir/ so it never touches the app's own data. Until the
// rules block is published there, reads are refused and the directory simply
// runs without these features (see attach() in public.js).
export const config = {
  apiKey: "AIzaSyAJBTF9xCIgl27yaf72DPug9nLdG-KddGs",
  authDomain: "rrt-new-backend.firebaseapp.com",
  projectId: "rrt-new-backend",
  storageBucket: "rrt-new-backend.firebasestorage.app",
  messagingSenderId: "854343594593",
  appId: "1:854343594593:web:ff6e8722fbd00607377020"
};
