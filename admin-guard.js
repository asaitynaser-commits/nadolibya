import { auth, db } from "./firebase.js";

import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js";

import {
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/13.1.0/firebase-firestore.js";

let authorizationPromise;

export function requireOwner() {
  if (authorizationPromise) return authorizationPromise;

  authorizationPromise = new Promise((resolve) => {
    let firstCheck = true;

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!firstCheck) return;
      firstCheck = false;
      unsubscribe();

      if (!user) {
        window.location.replace("admin-login.html");
        resolve(null);
        return;
      }

      try {
        const snapshot = await getDoc(
          doc(db, "admins", user.uid)
        );

        const data = snapshot.exists()
          ? snapshot.data()
          : null;

        if (
          !data ||
          data.active !== true ||
          data.role !== "owner"
        ) {
          await signOut(auth);
          window.location.replace("admin-login.html");
          resolve(null);
          return;
        }

        document.body.style.visibility = "visible";
        resolve(user);

      } catch (error) {
        console.error("Authorization error:", error);

        try {
          await signOut(auth);
        } catch (signOutError) {
          console.error(signOutError);
        }

        window.location.replace("admin-login.html");
        resolve(null);
      }
    });
  });

  return authorizationPromise;
}