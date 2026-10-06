import { holdSeerrSignIn, seerrSignInAtLoginAtom } from "@/utils/seerrSignIn";
import { store } from "@/utils/store";

describe("holding a Seerr sign-in", () => {
  afterEach(() => {
    store.set(seerrSignInAtLoginAtom, null);
  });

  test("names the user while it runs, and ends with it", () => {
    const release = holdSeerrSignIn("alex");
    expect(store.get(seerrSignInAtLoginAtom)).toEqual({ userId: "alex" });

    release();
    expect(store.get(seerrSignInAtLoginAtom)).toBeNull();
  });

  // A URL sign-in and a submitted form can both be signing in. The first to
  // finish cleared the other's marker, and SeerrAutoLogin started a second
  // Quick Connect while the newer sign-in was still opening the session.
  test("a sign-in that ends while a newer one runs leaves the newer one's", () => {
    const releaseFirst = holdSeerrSignIn("alex");
    const releaseSecond = holdSeerrSignIn("alex");

    releaseFirst();
    expect(store.get(seerrSignInAtLoginAtom)).toEqual({ userId: "alex" });

    releaseSecond();
    expect(store.get(seerrSignInAtLoginAtom)).toBeNull();
  });

  test("a sign-in without a user holds nothing and takes nothing away", () => {
    const releaseNamed = holdSeerrSignIn("alex");
    const releaseUnnamed = holdSeerrSignIn(undefined);
    expect(store.get(seerrSignInAtLoginAtom)).toBeNull();

    const releaseLater = holdSeerrSignIn("sam");
    releaseUnnamed();
    releaseNamed();
    expect(store.get(seerrSignInAtLoginAtom)).toEqual({ userId: "sam" });
    releaseLater();
  });
});
