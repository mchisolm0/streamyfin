import { act, render } from "@testing-library/react-native";
import { Provider } from "jotai";
import { apiAtom, userAtom } from "@/providers/JellyfinProvider";
import { seerrSignInAtLoginAtom } from "@/utils/seerrSignIn";
import { store } from "@/utils/store";
import { SeerrAutoLogin } from "./SeerrAutoLogin";

const mockSignInWithQuickConnect = jest.fn();

jest.mock("@/providers/JellyfinProvider", () => {
  const { atom } = require("jotai");
  return {
    apiAtom: atom(null),
    userAtom: atom(null),
  };
});
jest.mock("@/hooks/useSeerr", () => ({
  SeerrApi: jest.fn(),
  useSeerr: () => ({ seerrUser: undefined, setSeerrUser: jest.fn() }),
}));
jest.mock("@/utils/atoms/settings", () => ({
  useSettings: () => ({
    settings: { seerrServerUrl: "https://seerr.test", autoLoginSeerr: true },
    pluginSettings: { seerrServerUrl: { value: "https://seerr.test" } },
  }),
}));
jest.mock("@/utils/customHeaders", () => ({
  getIntegrationHeaders: () => ({}),
}));
jest.mock("@/utils/log", () => ({
  writeInfoLog: jest.fn(),
  writeToLog: jest.fn(),
}));
jest.mock("@/utils/mmkv", () => ({
  storage: { getString: () => "https://jellyfin.test" },
}));
jest.mock("@/utils/seerrPassword", () => ({
  deleteSeerrPassword: jest.fn(async () => {}),
  getSeerrPassword: jest.fn(async () => undefined),
}));
jest.mock("@/utils/seerrQuickConnect", () => ({
  signInWithQuickConnect: (...args: unknown[]) =>
    mockSignInWithQuickConnect(...args),
}));

// A password sign-in brings the plugin's Seerr address with its refresh, which
// starts this component while that sign-in is still running Quick Connect for
// the same user. Both ran, and opened two Seerr sessions for one user.
describe("signing in to Seerr at launch", () => {
  beforeEach(() => {
    mockSignInWithQuickConnect.mockReset();
    mockSignInWithQuickConnect.mockResolvedValue(undefined);
    store.set(userAtom, { Id: "user", Name: "alex" } as never);
    store.set(apiAtom, {} as never);
  });

  afterEach(() => {
    store.set(seerrSignInAtLoginAtom, null);
    store.set(userAtom, null);
    store.set(apiAtom, null);
  });

  test("waits while a password sign-in signs the same user in", async () => {
    store.set(seerrSignInAtLoginAtom, { userId: "user" });
    await render(
      <Provider store={store}>
        <SeerrAutoLogin />
      </Provider>,
    );
    expect(mockSignInWithQuickConnect).not.toHaveBeenCalled();

    await act(async () => {
      store.set(seerrSignInAtLoginAtom, null);
    });
    expect(mockSignInWithQuickConnect).toHaveBeenCalledTimes(1);
  });

  test("runs at once when no sign-in is in progress", async () => {
    await render(
      <Provider store={store}>
        <SeerrAutoLogin />
      </Provider>,
    );
    expect(mockSignInWithQuickConnect).toHaveBeenCalledTimes(1);
  });
});
