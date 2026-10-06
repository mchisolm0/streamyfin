import { atom } from "jotai";
import { store } from "@/utils/store";

// The user a password sign-in is signing in to Seerr. SeerrAutoLogin waits
// while it names the signed-in user: the plugin's Seerr address arrives with
// that sign-in's refresh, and both would otherwise run Quick Connect for the
// same user and race to open the session.
export const seerrSignInAtLoginAtom = atom<{ userId: string } | null>(null);

// Marks a Seerr sign-in for this user and returns what ends it. Each call holds
// a marker of its own and ends only that one: two password sign-ins can
// overlap, and the first to finish would otherwise clear the second's while it
// is still opening the Seerr session.
export const holdSeerrSignIn = (userId: string | null | undefined) => {
  const marker = userId ? { userId } : null;
  store.set(seerrSignInAtLoginAtom, marker);
  return () => {
    if (store.get(seerrSignInAtLoginAtom) === marker) {
      store.set(seerrSignInAtLoginAtom, null);
    }
  };
};
